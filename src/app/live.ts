// Liveticker (Sprint 6): der Browser holt laufende Spiele direkt bei ESPN (D017, CORS erlaubt).
// Eigene lockere Schemas nur für die Live Felder. Polling nur bei laufendem Spiel und sichtbarem Tab.
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { mapStatus, scoreboardUrl } from "../core/espn";
import { summaryUrl } from "../core/injuries";
import type { Game, GameStatus } from "../core/schema";
import type { WeekRef } from "./data";
import { LIVE_TIMEOUT_MS, timeoutSignal } from "./net";
import { parseLiveSummary, type LiveSummary } from "./live-summary";

export const LIVE_INTERVAL_MS = 20_000;
/** Obergrenze für die Wartezeit nach wiederholten Fehlern. */
export const LIVE_MAX_BACKOFF_MS = 5 * 60_000;
/** So lange nach Kickoff gilt ein nicht finales Spiel als möglicherweise laufend. */
const LIVE_WINDOW_MS = 6 * 60 * 60 * 1000;

const Score = z.union([z.string(), z.number()]).nullish();

const LiveStatusSchema = z.looseObject({
  displayClock: z.string().nullish(),
  period: z.number().nullish(),
  type: z.looseObject({
    state: z.enum(["pre", "in", "post"]),
    name: z.string().nullish(),
    completed: z.boolean().nullish(),
    shortDetail: z.string().nullish(),
    detail: z.string().nullish(),
  }),
});

const LiveSituationSchema = z.looseObject({
  possession: z.string().nullish(),
  downDistanceText: z.string().nullish(),
  shortDownDistanceText: z.string().nullish(),
  possessionText: z.string().nullish(),
  isRedZone: z.boolean().nullish(),
  yardLine: z.number().nullish(),
  distance: z.number().nullish(),
  lastPlay: z.looseObject({ text: z.string().nullish() }).nullish(),
});

/** Bilanz und Punkte je Viertel: nur lose gelesen, fehlerhafte Einträge fallen weg. */
const RecordSchema = z.looseObject({ type: z.string().nullish(), summary: z.string().nullish() });
const LineSchema = z.looseObject({ value: Score, displayValue: Score });

const LiveEventSchema = z.looseObject({
  id: z.string(),
  status: LiveStatusSchema.nullish(),
  competitions: z
    .array(
      z.looseObject({
        status: LiveStatusSchema.nullish(),
        competitors: z.array(
          z.looseObject({
            homeAway: z.enum(["home", "away"]),
            score: Score,
            team: z.looseObject({ id: z.string() }),
            records: z.array(z.unknown()).nullish(),
            linescores: z.array(z.unknown()).nullish(),
          }),
        ),
        situation: LiveSituationSchema.nullish(),
        broadcast: z.string().nullish(),
        broadcasts: z.array(z.looseObject({ names: z.array(z.string()).nullish() })).nullish(),
      }),
    )
    .min(1),
});

const LiveScoreboardSchema = z.looseObject({ events: z.array(z.unknown()) });

export interface LiveGame {
  id: string;
  /**
   * Phase für die Anzeige: "in" läuft, "post" final, sonst "pre". Verschobene und abgesagte Spiele
   * sind weder laufend noch final und stehen hier auf "pre", den Grund nennt status.
   */
  state: "pre" | "in" | "post";
  /** Status wie in der Wochendatei, über mapStatus aus src/core/espn.ts. */
  status: GameStatus;
  period: number | null;
  clock: string | null;
  detail: string | null;
  homeScore: number | null;
  awayScore: number | null;
  possessionTeamId: string | null;
  downDistance: string | null;
  redZone: boolean;
  lastPlay: string | null;
  /** Zusatz für den Ticker (D054), fehlt bei älteren Quellen. */
  extra?: LiveExtra;
}

export interface LiveExtra {
  awayRecord: string | null;
  homeRecord: string | null;
  /** Punkte je Viertel, Index 0 ist Q1. */
  awayLines: (number | null)[];
  homeLines: (number | null)[];
  /** Feldposition wie "SEA 31". */
  fieldText: string | null;
  /** Abstand zur Torlinie des Heimteams, 0 bis 100. */
  yardLine: number | null;
  /** Yards bis zum nächsten First Down. */
  distance: number | null;
  broadcast: string | null;
}

function overallRecord(records: readonly unknown[] | null | undefined): string | null {
  const list = (records ?? []).flatMap((r) => {
    const p = RecordSchema.safeParse(r);
    return p.success ? [p.data] : [];
  });
  return clean((list.find((r) => r.type === "total") ?? list[0])?.summary);
}

function lineScores(lines: readonly unknown[] | null | undefined): (number | null)[] {
  return (lines ?? []).map((l) => {
    const p = LineSchema.safeParse(l);
    return p.success ? (toScore(p.data.value) ?? toScore(p.data.displayValue)) : null;
  });
}

const toScore = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const clean = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

const STATE_OF: Record<GameStatus, LiveGame["state"]> = {
  scheduled: "pre",
  in_progress: "in",
  final: "post",
  postponed: "pre",
  canceled: "pre",
};

/** Wandelt eine Scoreboard Antwort in Live Daten pro Event ID. Ungültige Events werden übersprungen. */
export function parseLiveScoreboard(raw: unknown): Map<string, LiveGame> {
  const out = new Map<string, LiveGame>();
  const board = LiveScoreboardSchema.safeParse(raw);
  if (!board.success) throw new Error("Scoreboard hat ein unerwartetes Format");
  for (const item of board.data.events) {
    const parsed = LiveEventSchema.safeParse(item);
    if (!parsed.success) continue;
    const ev = parsed.data;
    const comp = ev.competitions[0]!;
    const status = comp.status ?? ev.status;
    if (!status) continue;
    const home = comp.competitors.find((c) => c.homeAway === "home");
    const away = comp.competitors.find((c) => c.homeAway === "away");
    const sit = comp.situation;
    // Ohne Namen zählt der state allein, ein beendetes Spiel bleibt dann final statt verschoben.
    const gameStatus = status.type.name
      ? mapStatus({ ...status, type: { ...status.type, name: status.type.name } })
      : status.type.state === "post"
        ? "final"
        : mapStatus({ ...status, type: { ...status.type, name: "" } });
    out.set(ev.id, {
      id: ev.id,
      state: STATE_OF[gameStatus],
      status: gameStatus,
      period: status.period ?? null,
      clock: clean(status.displayClock),
      detail: clean(status.type.shortDetail) ?? clean(status.type.detail),
      homeScore: toScore(home?.score),
      awayScore: toScore(away?.score),
      possessionTeamId: clean(sit?.possession),
      downDistance: clean(sit?.downDistanceText) ?? clean(sit?.shortDownDistanceText),
      redZone: sit?.isRedZone === true,
      lastPlay: clean(sit?.lastPlay?.text),
      extra: {
        awayRecord: overallRecord(away?.records),
        homeRecord: overallRecord(home?.records),
        awayLines: lineScores(away?.linescores),
        homeLines: lineScores(home?.linescores),
        fieldText: clean(sit?.possessionText),
        yardLine: typeof sit?.yardLine === "number" ? sit.yardLine : null,
        distance: typeof sit?.distance === "number" ? sit.distance : null,
        broadcast: clean(comp.broadcast) ?? clean((comp.broadcasts ?? []).flatMap((b) => b.names ?? []).join(", ")),
      },
    });
  }
  return out;
}

/** "Q3 4:12", Verlängerung als "OT". */
export function periodText(live: LiveGame): string {
  if (live.state !== "in") return live.detail ?? "";
  const p = live.period;
  const q = p === null || p <= 0 ? "" : p > 4 ? (p === 5 ? "OT" : `OT${p - 4}`) : `Q${p}`;
  const clock = live.clock && live.clock !== "0:00" ? live.clock : null;
  if (!clock && live.detail) return live.detail;
  return [q, clock].filter(Boolean).join(" ");
}

/** Kann das Spiel gerade laufen? Live Daten haben Vorrang vor der Wochendatei. */
export function maybeLive(game: Game, live: LiveGame | undefined, now: number): boolean {
  if (game.status === "canceled" || game.status === "postponed") return false;
  if (live?.status === "canceled" || live?.status === "postponed") return false;
  const kickoff = Date.parse(game.kickoffUtc);
  if (live) {
    // Auch ein laufendes Spiel endet spätestens nach dem Fenster, falls ESPN danach dauerhaft ausfällt.
    if (live.state === "in") return now - kickoff < LIVE_WINDOW_MS;
    if (live.state === "post") return false;
  } else if (game.status === "in_progress") {
    return true;
  }
  if (game.status === "final") return false;
  return kickoff <= now && now - kickoff < LIVE_WINDOW_MS;
}

/** Wartezeit bis zum nächsten Abruf: 20 s, nach Fehlern 20, 40, 80 s und so weiter bis höchstens 5 Minuten. */
export function liveDelay(failures: number): number {
  if (failures <= 1) return LIVE_INTERVAL_MS;
  return Math.min(LIVE_INTERVAL_MS * 2 ** (failures - 1), LIVE_MAX_BACKOFF_MS);
}

/** Sichtbarkeit des Tabs. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

/** Zeit, alle 20 Sekunden neu, damit ein Kickoff ohne Neuladen das Polling startet. */
function useTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export interface LiveState {
  games: Map<string, LiveGame>;
  /** Zeitpunkt der letzten erfolgreichen Abfrage. */
  updatedAt: number | null;
  /** Letzte Abfrage fehlgeschlagen, angezeigt wird der letzte Stand. */
  error: boolean;
  /** Es läuft gerade mindestens ein Spiel oder ein Kickoff ist vorbei und noch nicht final. */
  active: boolean;
}

/**
 * Live Stand aller Spiele der Woche. Fragt ESPN alle 20 Sekunden ab, aber nur solange ein Spiel laufen kann
 * und der Tab sichtbar ist. Sonst kein Polling. Fehler behalten den letzten Stand, nach Fehlern wird die
 * Wartezeit verdoppelt (höchstens 5 Minuten), nach einem Erfolg gilt wieder 20 s. Zeitlimit 10 s pro Abruf.
 */
export function useLiveScores(ref: WeekRef | null, games: readonly Game[] | null): LiveState {
  const [state, setState] = useState<Omit<LiveState, "active">>({ games: new Map(), updatedAt: null, error: false });
  const visible = usePageVisible();
  const now = useTick(LIVE_INTERVAL_MS);
  const active = useMemo(
    () => (games ?? []).some((g) => maybeLive(g, state.games.get(g.id), now)),
    [games, state.games, now],
  );
  const refKey = ref ? `${ref.season}-${ref.seasonType}-${ref.week}` : null;

  useEffect(() => {
    if (!ref || !active || !visible) return;
    let cancelled = false;
    let timer: number | undefined;
    let ctrl: AbortController | null = null;
    let failures = 0;
    const url = scoreboardUrl({ season: ref.season, seasonType: ref.seasonType, week: ref.week });
    const tick = async () => {
      ctrl = new AbortController();
      try {
        const res = await fetch(url, { signal: timeoutSignal(LIVE_TIMEOUT_MS, ctrl.signal), cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const map = parseLiveScoreboard(await res.json());
        failures = 0;
        if (!cancelled) setState({ games: map, updatedAt: Date.now(), error: false });
      } catch {
        failures += 1;
        if (!cancelled) setState((s) => (s.error ? s : { ...s, error: true }));
      }
      if (!cancelled) timer = window.setTimeout(tick, liveDelay(failures));
    };
    void tick();
    return () => {
      cancelled = true;
      ctrl?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
    // ref wird über refKey verglichen, damit ein neues Objekt gleicher Woche das Polling nicht neu startet
  }, [refKey, active, visible]);

  return { ...state, active };
}

// ---------- Summary: letzte Spielzüge ----------

const PlaySchema = z.looseObject({
  id: z.string().nullish(),
  text: z.string().nullish(),
  scoringPlay: z.boolean().nullish(),
  clock: z.looseObject({ displayValue: z.string().nullish() }).nullish(),
  period: z.looseObject({ number: z.number().nullish() }).nullish(),
  type: z.looseObject({ text: z.string().nullish() }).nullish(),
  start: z.looseObject({ team: z.looseObject({ id: z.string().nullish() }).nullish() }).nullish(),
});

const DriveSchema = z.looseObject({
  team: z.looseObject({ id: z.string().nullish(), abbreviation: z.string().nullish() }).nullish(),
  plays: z.array(z.unknown()).nullish(),
});

const SummarySchema = z.looseObject({
  drives: z.looseObject({ previous: z.array(z.unknown()).nullish(), current: z.unknown().nullish() }).nullish(),
});

export interface LivePlay {
  id: string;
  text: string;
  period: number | null;
  clock: string | null;
  teamId: string | null;
  scoring: boolean;
}

/** Die letzten Spielzüge aus dem Summary, neueste zuerst. */
export function parseLastPlays(raw: unknown, limit = 10): LivePlay[] {
  const summary = SummarySchema.safeParse(raw);
  if (!summary.success) throw new Error("Summary hat ein unerwartetes Format");
  const drives = [...(summary.data.drives?.previous ?? [])];
  if (summary.data.drives?.current) drives.push(summary.data.drives.current);
  const seen = new Set<string>();
  const plays: LivePlay[] = [];
  for (const d of drives) {
    const drive = DriveSchema.safeParse(d);
    if (!drive.success) continue;
    for (const p of drive.data.plays ?? []) {
      const play = PlaySchema.safeParse(p);
      if (!play.success) continue;
      const text = clean(play.data.text);
      if (!text) continue;
      const id = play.data.id ?? `${plays.length}-${text}`;
      if (seen.has(id)) continue;
      seen.add(id);
      plays.push({
        id,
        text,
        period: play.data.period?.number ?? null,
        clock: clean(play.data.clock?.displayValue),
        teamId: clean(play.data.start?.team?.id) ?? clean(drive.data.team?.id),
        scoring: play.data.scoringPlay === true,
      });
    }
  }
  return plays.slice(-limit).reverse();
}

export interface PlaysState {
  plays: LivePlay[] | null;
  error: boolean;
  updatedAt: number | null;
}

/** Spielzüge eines Spiels für die Detailansicht. Polling nur solange das Spiel läuft und der Tab sichtbar ist. */
export function useLastPlays(eventId: string | null, running: boolean): PlaysState {
  const [state, setState] = useState<PlaysState>({ plays: null, error: false, updatedAt: null });
  const visible = usePageVisible();

  useEffect(() => {
    setState({ plays: null, error: false, updatedAt: null });
  }, [eventId]);

  useEffect(() => {
    if (!eventId || !visible) return;
    let cancelled = false;
    let timer: number | undefined;
    let ctrl: AbortController | null = null;
    let failures = 0;
    const tick = async () => {
      ctrl = new AbortController();
      try {
        const res = await fetch(summaryUrl(eventId), {
          signal: timeoutSignal(LIVE_TIMEOUT_MS, ctrl.signal),
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const plays = parseLastPlays(await res.json());
        failures = 0;
        if (!cancelled) setState({ plays, error: false, updatedAt: Date.now() });
      } catch {
        failures += 1;
        if (!cancelled) setState((s) => ({ ...s, error: true }));
      }
      if (!cancelled && running) timer = window.setTimeout(tick, liveDelay(failures));
    };
    void tick();
    return () => {
      cancelled = true;
      ctrl?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [eventId, running, visible]);

  return state;
}

// ---------- Summary für den Ticker (D054) ----------

export interface SummaryState {
  summary: LiveSummary | null;
  error: boolean;
  updatedAt: number | null;
}

/**
 * Summary der gezeigten laufenden Spiele, je Spiel alle 20 Sekunden, nur bei sichtbarem Tab. Backoff und
 * Zeitlimit wie beim Scoreboard. Spiele, die nicht mehr gezeigt werden, behalten ihren letzten Stand.
 */
export function useLiveSummaries(eventIds: readonly string[]): Map<string, SummaryState> {
  const [states, setStates] = useState<Map<string, SummaryState>>(() => new Map());
  const visible = usePageVisible();
  const key = [...new Set(eventIds)].sort().join(",");

  useEffect(() => {
    if (!visible || !key) return;
    const stops: (() => void)[] = [];
    for (const id of key.split(",")) {
      let cancelled = false;
      let timer: number | undefined;
      let ctrl: AbortController | null = null;
      let failures = 0;
      const tick = async () => {
        ctrl = new AbortController();
        try {
          const res = await fetch(summaryUrl(id), { signal: timeoutSignal(LIVE_TIMEOUT_MS, ctrl.signal), cache: "no-store" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const summary = parseLiveSummary(await res.json());
          failures = 0;
          if (!cancelled) setStates((m) => new Map(m).set(id, { summary, error: false, updatedAt: Date.now() }));
        } catch {
          failures += 1;
          if (!cancelled)
            setStates((m) => {
              const prev = m.get(id);
              if (prev?.error) return m;
              return new Map(m).set(id, { summary: prev?.summary ?? null, error: true, updatedAt: prev?.updatedAt ?? null });
            });
        }
        if (!cancelled) timer = window.setTimeout(tick, liveDelay(failures));
      };
      void tick();
      stops.push(() => {
        cancelled = true;
        ctrl?.abort();
        if (timer !== undefined) window.clearTimeout(timer);
      });
    }
    return () => stops.forEach((stop) => stop());
  }, [key, visible]);

  return states;
}

// ---------- Summary einmal laden: geplante und beendete Spiele (D056) ----------

/** Phase, für die eine Summary geladen wurde. Ein Spiel vor dem Kickoff und nach dem Ende liefert andere Daten. */
export type SummaryPhase = "pre" | "post";

const summaryCache = new Map<string, LiveSummary>();
const summaryInflight = new Map<string, Promise<LiveSummary>>();

/** Leert den Speicher, nur für Tests. */
export function clearGameSummaryCache(): void {
  summaryCache.clear();
  summaryInflight.clear();
}

/** Bereits geladene Summary oder undefined. */
export function cachedGameSummary(eventId: string, phase: SummaryPhase): LiveSummary | undefined {
  return summaryCache.get(`${eventId}:${phase}`);
}

/**
 * Lädt die Summary eines Spiels genau einmal pro Sitzung und Phase (kein Polling). Gleichzeitige Anfragen teilen
 * sich einen Abruf. Zeitlimit wie beim Liveticker, Fehler werden nicht gespeichert, ein späterer Aufruf versucht es neu.
 */
export function loadGameSummary(
  eventId: string,
  phase: SummaryPhase,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
  signal?: AbortSignal,
): Promise<LiveSummary> {
  const key = `${eventId}:${phase}`;
  const hit = summaryCache.get(key);
  if (hit) return Promise.resolve(hit);
  const running = summaryInflight.get(key);
  if (running) return running;
  const p = (async () => {
    try {
      const res = await fetchImpl(summaryUrl(eventId), { signal: timeoutSignal(LIVE_TIMEOUT_MS, signal), cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const summary = parseLiveSummary(await res.json());
      summaryCache.set(key, summary);
      return summary;
    } finally {
      summaryInflight.delete(key);
    }
  })();
  summaryInflight.set(key, p);
  return p;
}

export interface GameSummaryState {
  summary: LiveSummary | null;
  /** Abruf läuft noch. */
  loading: boolean;
  /** Abruf gescheitert, die Ansicht bleibt still ohne die Zusatzdaten. */
  error: boolean;
}

/** Summary eines gezeigten Spiels, einmal geladen und im Speicher gehalten. Ohne eventId nichts. */
export function useGameSummary(eventId: string | null, phase: SummaryPhase): GameSummaryState {
  const key = eventId ? `${eventId}:${phase}` : null;
  const [state, setState] = useState<{ key: string | null; summary: LiveSummary | null; error: boolean }>(() => ({
    key,
    summary: eventId ? (cachedGameSummary(eventId, phase) ?? null) : null,
    error: false,
  }));

  useEffect(() => {
    if (!eventId || !key) return;
    const hit = cachedGameSummary(eventId, phase);
    if (hit) {
      setState({ key, summary: hit, error: false });
      return;
    }
    let active = true;
    setState({ key, summary: null, error: false });
    loadGameSummary(eventId, phase)
      .then((summary) => {
        if (active) setState({ key, summary, error: false });
      })
      .catch(() => {
        if (active) setState({ key, summary: null, error: true });
      });
    return () => {
      active = false;
    };
  }, [eventId, phase, key]);

  if (!key) return { summary: null, loading: false, error: false };
  if (state.key !== key) {
    const hit = eventId ? cachedGameSummary(eventId, phase) : undefined;
    return { summary: hit ?? null, loading: !hit, error: false };
  }
  return { summary: state.summary, loading: state.summary === null && !state.error, error: state.error };
}
