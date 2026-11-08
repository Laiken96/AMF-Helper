// Meldungen für Web Push (D029, D030) und Datenvertrag data/push-log.json.
// Reine Logik ohne Netz, Schreiber ist jobs/push.ts. Texte kurz für den Sperrbildschirm am Handy.
import { z } from "zod";
import type { PushPayload } from "./push-config";
import type { Game, Team } from "./schema";
import type { TipsFile } from "./tips-schema";
import type { InjuriesFile, InjuryChange, KeyRole } from "./injuries";
import type { ReviewFile } from "./review-schema";
import { groupBySlot } from "./time";

export const PUSH_LOG_SCHEMA_VERSION = 1 as const;
export const TITLE_MAX = 40;
export const BODY_MAX = 180;
export const SLOT_WINDOW_MIN = 2; // lieber spät als gar nicht
export const TIPS_READY_TTL_S = 6 * 3600;
export const MIN_TTL_S = 60;
export const SLOT_WINDOW_MAX = 60;
export const PUSH_LOG_MAX_ENTRIES = 500;
export const REVIEW_READY_TTL_S = 24 * 3600;

export const PushLogEntrySchema = z.object({
  key: z.string().min(1), // z. B. "tips-ready:2026-2-9" oder "slot:2026-11-08T19:00+01:00"
  sentAt: z.string().datetime(),
  title: z.string().max(TITLE_MAX),
  body: z.string().max(BODY_MAX),
});
export type PushLogEntry = z.infer<typeof PushLogEntrySchema>;

export const PushLogFileSchema = z.object({
  schemaVersion: z.literal(PUSH_LOG_SCHEMA_VERSION),
  entries: z.array(PushLogEntrySchema),
});
export type PushLogFile = z.infer<typeof PushLogFileSchema>;

export const EMPTY_PUSH_LOG: PushLogFile = { schemaVersion: PUSH_LOG_SCHEMA_VERSION, entries: [] };

export interface DueMessage {
  key: string;
  payload: PushPayload;
  ttlSeconds: number; // so lange hält der Push Dienst die Meldung, Slot Meldungen bis zum Kickoff
}

export function tipsReadyKey(season: number, seasonType: number, week: number): string {
  return `tips-ready:${season}-${seasonType}-${week}`;
}

export function reviewReadyKey(season: number, seasonType: number, week: number): string {
  return `review-ready:${season}-${seasonType}-${week}`;
}

export function slotKeyOf(slotKey: string): string {
  return `slot:${slotKey}`;
}

/** Kürzel eines ESPN Status, z. B. Out zu O. null heisst kein Eintrag, also fit. */
export function statusCode(status: string | null): string {
  if (status === null) return "fit";
  const known: Record<string, string> = {
    Out: "O",
    Questionable: "Q",
    Doubtful: "D",
    Probable: "P",
    "Injured Reserve": "IR",
    Suspension: "SUS",
    "Physically Unable to Perform": "PUP",
    Active: "fit",
  };
  return known[status] ?? status.slice(0, 3);
}

/** "Lamar Jackson" wird zu "L.Jackson". */
export function shortName(displayName: string): string {
  const i = displayName.indexOf(" ");
  if (i <= 0) return displayName;
  return `${displayName[0]}.${displayName.slice(i + 1)}`;
}

/** Fügt Teile an, solange der Text in max passt. Was nicht passt, erscheint als "+N". */
export function fitParts(head: string, items: readonly string[], max: number, sep = ", "): string {
  let text = head;
  for (let i = 0; i < items.length; i++) {
    const next = `${text}${i === 0 ? "" : sep}${items[i]}`;
    const rest = items.length - i - 1;
    const tail = rest > 0 ? ` +${rest}` : "";
    if (next.length + tail.length > max) {
      const left = items.length - i;
      const more = ` +${left}`;
      return (text + more).length <= max ? text + more : text.slice(0, max);
    }
    text = next;
  }
  return text.length <= max ? text : text.slice(0, max);
}

function abbrOf(teams: ReadonlyMap<string, Team>, id: string | null): string {
  if (id === null) return "?";
  return teams.get(id)?.abbr ?? id;
}

function gameLabel(teams: ReadonlyMap<string, Team>, g: Pick<Game, "awayId" | "homeId">): string {
  return `${abbrOf(teams, g.awayId)}@${abbrOf(teams, g.homeId)}`;
}

/**
 * "Tippliste bereit": Anzahl offener Spiele, Vorschlag der App und Tiebreaker. Gesperrte Spiele (Tipp oder
 * Kickoff vorbei, Spiel nicht mehr geplant) zählen nicht. Null ohne Quote oder ohne offenes Spiel.
 */
export function tipsReadyMessage(
  tips: TipsFile,
  games: readonly Game[],
  teams: ReadonlyMap<string, Team>,
  now?: string,
): DueMessage | null {
  if (!tips.tips.some((t) => t.odds !== null)) return null;
  const byId = new Map(games.map((g) => [g.id, g]));
  const isOpen = (t: TipsFile["tips"][number]) => {
    if (t.locked) return false;
    const g = byId.get(t.gameId);
    if (g && g.status !== "scheduled") return false;
    return now === undefined || Date.parse(now) < Date.parse(g?.kickoffUtc ?? t.kickoffUtc);
  };
  const open = tips.tips.filter(isOpen);
  if (open.length === 0) return null;
  const openIds = new Set(open.map((t) => t.gameId));
  const n = open.length;
  // Offene Spiele tragen seit D052 nie eine Abweichung, der Vorschlag ist immer der Favorit.
  const head = `${n} ${n === 1 ? "Spiel" : "Spiele"}, Vorschlag Favorit.`;
  const tbs = tips.tiebreakers
    .filter((tb) => openIds.has(tb.gameId))
    .map((tb) => {
      const g = byId.get(tb.gameId);
      const label = g ? gameLabel(teams, g) : tb.gameId;
      return `${tb.slot === "thursday" ? "TNF" : "MNF"} ${label} ${tb.awayPoints}:${tb.homePoints}`;
    });
  const body = tbs.length > 0 ? fitParts(`${head} TB `, tbs, BODY_MAX) : `${head} Kein TB`;
  return {
    key: tipsReadyKey(tips.season, tips.seasonType, tips.week),
    ttlSeconds: TIPS_READY_TTL_S,
    payload: {
      title: `Tippliste W${tips.week} bereit`,
      body,
      url: "#tipps",
      tag: `tips-ready-${tips.season}-${tips.seasonType}-${tips.week}`,
    },
  };
}

/**
 * Text einer Ausfall Änderung, z. B. "BAL L.Jackson QB Q>O". Verschwindet ein Spieler von der Liste (kind weg),
 * heisst das nicht sicher fit, daher "Q>nicht gelistet".
 */
export function formatChange(c: InjuryChange): string {
  const who = `${c.teamAbbr} ${shortName(c.name)}${c.pos ? ` ${c.pos}` : ""}`;
  if (c.kind === "weg" || c.to === null) return `${who} ${statusCode(c.from)}>nicht gelistet`;
  return `${who} ${statusCode(c.from)}>${statusCode(c.to)}`;
}

/** Status, deren Wegfall von der Liste nichts aussagt (Kaderwechsel statt Rückkehr), D057. */
const SILENT_REMOVAL = new Set(["Out", "Injured Reserve"]);

/** Höchstens so viele Punkte pro Spiel in der Slot Meldung (D057). */
export const SLOT_ITEMS_PER_GAME = 2;

/** Schwere des neuen Status für die Reihenfolge bei gleichem Gewicht. */
function severity(status: string | null): number {
  if (status === null) return 0;
  if (status === "Questionable") return 1;
  if (status === "Doubtful") return 2;
  return 3; // Out, Injured Reserve, Suspension, PUP und Unbekanntes
}

/**
 * Gewicht einer Ausfall Änderung für die Slot Meldung (D057), null heisst weglassen. Start QB (QB mit
 * Passing Leader Rolle) 4, übrige Leader Rollen (passing, rushing, receiving) 3, QB ohne Leader Rolle 1.
 * Weggelassen werden Spieler, die von Out oder IR aus von der Liste verschwinden, und QBs ohne Leader Rolle,
 * die neu als Out gelistet sind (Ersatz QBs auf der Inaktivliste).
 */
export function changeWeight(c: InjuryChange, roles: readonly KeyRole[]): number | null {
  if (c.to === null && c.from !== null && SILENT_REMOVAL.has(c.from)) return null;
  const leader = roles.some((r) => r !== "qb");
  if (!leader && c.kind === "neu" && c.to === "Out") return null;
  if (roles.includes("passing") && (roles.includes("qb") || c.pos === "QB")) return 4;
  if (leader) return 3;
  return 1;
}

/** Gewicht der Linienbewegung, nach den Leader Rollen und vor QBs ohne Leader Rolle. */
const LINE_WEIGHT = 2;

/** Rollen je Spiel und Athlet aus aktuellem Stand und Grundstand. */
function rolesIndex(injuries: InjuriesFile | null): Map<string, KeyRole[]> {
  const out = new Map<string, KeyRole[]>();
  for (const state of [injuries?.current, injuries?.baseline]) {
    for (const g of state?.games ?? []) {
      for (const p of g.players) {
        const key = `${g.gameId}:${p.athleteId}`;
        const prev = out.get(key) ?? [];
        out.set(key, [...new Set([...prev, ...p.roles])]);
      }
    }
  }
  return out;
}

/** Ab dieser Bewegung des Spreads in Punkten erscheint die Linie in der Slot Meldung (D050). */
export const LINE_MOVE_MIN = 2.5;

/** Spread mit Vorzeichen, z. B. -3, +2.5 oder 0. */
export function formatSpread(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * Linienbewegung seit der ersten erfassten Quote (D050). Gemeldet bei Favoritenwechsel oder ab 2.5 Punkten
 * Bewegung. Der Spread steht aus Sicht des aktuellen Favoriten, bei Pick em aus Sicht des Heimteams.
 * Beispiel "Linie JAX -3 > -8.5". Ohne erste oder aktuelle Quote null.
 */
export function lineMoveItem(
  tip: Pick<TipsFile["tips"][number], "odds" | "firstOdds">,
  game: Pick<Game, "homeId" | "awayId">,
  teams: ReadonlyMap<string, Team>,
): string | null {
  const first = tip.firstOdds;
  const cur = tip.odds;
  if (!first || !cur) return null;
  const a = first.spreadHome;
  const b = cur.spreadHome;
  const favoriteSwitch = a !== 0 && b !== 0 && Math.sign(a) !== Math.sign(b);
  if (!favoriteSwitch && Math.abs(b - a) < LINE_MOVE_MIN) return null;
  const home = b <= 0;
  const team = abbrOf(teams, home ? game.homeId : game.awayId);
  const view = (spreadHome: number) => (home ? spreadHome : -spreadHome);
  return `Linie ${team} ${formatSpread(view(a))} > ${formatSpread(view(b))}`;
}

export interface SlotInput {
  games: readonly Game[];
  tips: TipsFile | null;
  injuries: InjuriesFile | null;
  teams: ReadonlyMap<string, Team>;
  now: string;
}

/** Minuten bis zum Kickoff als Dezimalzahl, negativ nach dem Kickoff. */
export function minutesUntil(kickoffUtc: string, now: string): number {
  return (Date.parse(kickoffUtc) - Date.parse(now)) / 60_000;
}

export function inSlotWindow(kickoffUtc: string, now: string): boolean {
  const m = minutesUntil(kickoffUtc, now);
  return m >= SLOT_WINDOW_MIN && m <= SLOT_WINDOW_MAX;
}

/**
 * "Tippschluss in X min" für jeden Slot, dessen Kickoff 2 bis 60 Minuten entfernt ist. Inhalt nach D057:
 * Paarungen, Ausfälle nach Gewicht (changeWeight) und Linienbewegungen, keine Tipps. Pro Spiel höchstens
 * SLOT_ITEMS_PER_GAME Punkte, über alle Spiele absteigend nach Gewicht, bei Gleichstand der schwerere Status,
 * danach Reihenfolge der Spiele. Was nicht in BODY_MAX passt, erscheint als "+N".
 */
export function slotMessages(input: SlotInput): DueMessage[] {
  const { teams, now } = input;
  const open = input.games.filter((g) => g.status === "scheduled");
  const tipsById = new Map((input.tips?.tips ?? []).map((t) => [t.gameId, t]));
  const hasBaseline = input.injuries?.baseline != null;
  const roles = rolesIndex(input.injuries);
  const out: DueMessage[] = [];
  for (const slot of groupBySlot(open)) {
    if (!inSlotWindow(slot.kickoffUtc, now)) continue;
    const head = slot.games.length <= 4 ? slot.games.map((g) => gameLabel(teams, g)).join(" ") : `${slot.games.length} Spiele`;
    interface Point {
      text: string;
      weight: number;
      sev: number;
      order: number;
    }
    const points: Point[] = [];
    slot.games.forEach((g, gi) => {
      const own: Point[] = [];
      const t = tipsById.get(g.id);
      const line = t ? lineMoveItem(t, g, teams) : null;
      if (line) own.push({ text: line, weight: LINE_WEIGHT, sev: 0, order: gi * 1000 });
      if (hasBaseline) {
        (input.injuries?.changes ?? [])
          .filter((c) => c.gameId === g.id)
          .forEach((c, ci) => {
            const w = changeWeight(c, roles.get(`${c.gameId}:${c.athleteId}`) ?? []);
            if (w !== null) own.push({ text: formatChange(c), weight: w, sev: severity(c.to), order: gi * 1000 + ci + 1 });
          });
      }
      const byWeight = (a: Point, b: Point) => b.weight - a.weight || b.sev - a.sev || a.order - b.order;
      points.push(...own.sort(byWeight).slice(0, SLOT_ITEMS_PER_GAME));
    });
    points.sort((a, b) => b.weight - a.weight || b.sev - a.sev || a.order - b.order);
    const items = points.map((p) => p.text);
    const body = items.length > 0 ? fitParts(`${head}. `, items, BODY_MAX) : `${head}. Keine Änderung`;
    const minutes = Math.floor(minutesUntil(slot.kickoffUtc, now));
    out.push({
      key: slotKeyOf(slot.slotKey),
      ttlSeconds: Math.max(MIN_TTL_S, Math.floor(minutesUntil(slot.kickoffUtc, now) * 60)),
      payload: { title: `Tippschluss in ${minutes} min`, body: body.slice(0, BODY_MAX), url: "#tipps", tag: `slot-${slot.slotKey}` },
    });
  }
  return out;
}

/**
 * "Bilanz bereit" für eine komplette Woche (D032, seit D058 ohne Aufruf zur Meldung). Null, solange noch ein Spiel offen ist. Ohne den Teil zu
 * Abweichungen (D057), die eigene Wahl liegt nur auf dem Gerät und erscheint in der App.
 */
export function reviewReadyMessage(review: ReviewFile): DueMessage | null {
  if (!review.complete) return null;
  const tbs = review.tiebreakers.map((tb) => `${tb.slot === "thursday" ? "TNF" : "MNF"} ${tb.diff ?? "?"}`);
  const tb = tbs.length > 0 ? tbs.join(", ") : "keine";
  const body = `App Punkte ${review.points} von ${review.tipped}, Tiebreaker Abweichung ${tb}`;
  return {
    key: reviewReadyKey(review.season, review.seasonType, review.week),
    ttlSeconds: REVIEW_READY_TTL_S,
    payload: {
      title: `Bilanz W${review.week} bereit`,
      body: body.slice(0, BODY_MAX),
      url: "#bilanz",
      tag: `review-ready-${review.season}-${review.seasonType}-${review.week}`,
    },
  };
}

export interface DueInput extends SlotInput {
  log: PushLogFile;
  /** Reviews absteigend wie data/reviews/index.json. Nur die neueste komplette Woche wird gemeldet. */
  reviews?: readonly ReviewFile[];
}

/** Alle fälligen Meldungen, die noch nicht im Log stehen. Tippliste vor Slots, Bilanz zuletzt. */
export function dueMessages(input: DueInput): DueMessage[] {
  const sent = new Set(input.log.entries.map((e) => e.key));
  const all: DueMessage[] = [];
  if (input.tips) {
    const ready = tipsReadyMessage(input.tips, input.games, input.teams, input.now);
    if (ready) all.push(ready);
  }
  all.push(...slotMessages(input));
  // Nur die neueste komplette Woche, damit ein leeres push-log keine Flut alter Bilanzen auslöst.
  const latest = (input.reviews ?? []).find((r) => r.complete);
  const review = latest ? reviewReadyMessage(latest) : null;
  if (review) all.push(review);
  return all.filter((m) => !sent.has(m.key));
}

/** Hängt gesendete Meldungen an und behält nur die neuesten Einträge. */
export function appendLog(log: PushLogFile, sent: ReadonlyArray<{ message: DueMessage; sentAt: string }>): PushLogFile {
  const entries = [
    ...log.entries,
    ...sent.map((s) => ({ key: s.message.key, sentAt: s.sentAt, title: s.message.payload.title, body: s.message.payload.body })),
  ];
  return PushLogFileSchema.parse({
    schemaVersion: PUSH_LOG_SCHEMA_VERSION,
    entries: entries.slice(Math.max(0, entries.length - PUSH_LOG_MAX_ENTRIES)),
  });
}
