// Liveticker (Sprint 6): der Browser holt laufende Spiele direkt bei ESPN (D017, CORS erlaubt).
// Eigene lockere Schemas nur für die Live Felder. Polling nur bei laufendem Spiel und sichtbarem Tab.
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { scoreboardUrl } from "../core/espn";
import { summaryUrl } from "../core/injuries";
import type { Game } from "../core/schema";
import type { WeekRef } from "./data";

export const LIVE_INTERVAL_MS = 20_000;
/** So lange nach Kickoff gilt ein nicht finales Spiel als möglicherweise laufend. */
const LIVE_WINDOW_MS = 6 * 60 * 60 * 1000;

const Score = z.union([z.string(), z.number()]).nullish();

const LiveStatusSchema = z.looseObject({
  displayClock: z.string().nullish(),
  period: z.number().nullish(),
  type: z.looseObject({
    state: z.enum(["pre", "in", "post"]),
    name: z.string().nullish(),
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
  lastPlay: z.looseObject({ text: z.string().nullish() }).nullish(),
});

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
          }),
        ),
        situation: LiveSituationSchema.nullish(),
      }),
    )
    .min(1),
});

const LiveScoreboardSchema = z.looseObject({ events: z.array(z.unknown()) });

export interface LiveGame {
  id: string;
  state: "pre" | "in" | "post";
  period: number | null;
  clock: string | null;
  detail: string | null;
  homeScore: number | null;
  awayScore: number | null;
  possessionTeamId: string | null;
  downDistance: string | null;
  redZone: boolean;
  lastPlay: string | null;
}

const toScore = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const clean = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

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
    out.set(ev.id, {
      id: ev.id,
      state: status.type.state,
      period: status.period ?? null,
      clock: clean(status.displayClock),
      detail: clean(status.type.shortDetail) ?? clean(status.type.detail),
      homeScore: toScore(home?.score),
      awayScore: toScore(away?.score),
      possessionTeamId: clean(sit?.possession),
      downDistance: clean(sit?.downDistanceText) ?? clean(sit?.shortDownDistanceText),
      redZone: sit?.isRedZone === true,
      lastPlay: clean(sit?.lastPlay?.text),
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
  if (live) {
    if (live.state === "in") return true;
    if (live.state === "post") return false;
  } else if (game.status === "in_progress") {
    return true;
  }
  if (game.status === "final") return false;
  const kickoff = Date.parse(game.kickoffUtc);
  return kickoff <= now && now - kickoff < LIVE_WINDOW_MS;
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
 * und der Tab sichtbar ist. Sonst kein Polling. Fehler behalten den letzten Stand.
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
    const url = scoreboardUrl({ season: ref.season, seasonType: ref.seasonType, week: ref.week });
    const tick = async () => {
      ctrl = new AbortController();
      try {
        const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const map = parseLiveScoreboard(await res.json());
        if (!cancelled) setState({ games: map, updatedAt: Date.now(), error: false });
      } catch {
        if (!cancelled) setState((s) => (s.error ? s : { ...s, error: true }));
      }
      if (!cancelled) timer = window.setTimeout(tick, LIVE_INTERVAL_MS);
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
    const tick = async () => {
      ctrl = new AbortController();
      try {
        const res = await fetch(summaryUrl(eventId), { signal: ctrl.signal, cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const plays = parseLastPlays(await res.json());
        if (!cancelled) setState({ plays, error: false, updatedAt: Date.now() });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, error: true }));
      }
      if (!cancelled && running) timer = window.setTimeout(tick, LIVE_INTERVAL_MS);
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
