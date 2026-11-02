// Meldungen für Web Push (D029, D030) und Datenvertrag data/push-log.json.
// Reine Logik ohne Netz, Schreiber ist jobs/push.ts. Texte kurz für den Sperrbildschirm am Handy.
import { z } from "zod";
import type { PushPayload } from "./push-config";
import type { Game, Team } from "./schema";
import type { TipsFile } from "./tips-schema";
import type { InjuriesFile, InjuryChange } from "./injuries";
import { groupBySlot } from "./time";

export const PUSH_LOG_SCHEMA_VERSION = 1 as const;
export const TITLE_MAX = 40;
export const BODY_MAX = 180;
export const SLOT_WINDOW_MIN = 2; // lieber spät als gar nicht
export const TIPS_READY_TTL_S = 6 * 3600;
export const MIN_TTL_S = 60;
export const SLOT_WINDOW_MAX = 60;
export const PUSH_LOG_MAX_ENTRIES = 500;

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

/** "Tippliste bereit": Anzahl Spiele, Abweichungen und beide Tiebreaker. Null ohne Quote. */
export function tipsReadyMessage(tips: TipsFile, games: readonly Game[], teams: ReadonlyMap<string, Team>): DueMessage | null {
  if (!tips.tips.some((t) => t.odds !== null)) return null;
  const byId = new Map(games.map((g) => [g.id, g]));
  const n = tips.tips.length;
  const devs = tips.tips.filter((t) => t.deviation).map((t) => abbrOf(teams, t.pickTeamId));
  let head = `${n} ${n === 1 ? "Spiel" : "Spiele"}, ${devs.length} Abw.`;
  if (devs.length > 0) head = `${head.slice(0, -1)}: ${devs.join(" ")}.`;
  const tbs = tips.tiebreakers.map((tb) => {
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

export function formatChange(c: InjuryChange): string {
  return `${c.teamAbbr} ${shortName(c.name)}${c.pos ? ` ${c.pos}` : ""} ${statusCode(c.from)}>${statusCode(c.to)}`;
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

/** "Tippschluss in X min" für jeden Slot, dessen Kickoff 2 bis 60 Minuten entfernt ist. */
export function slotMessages(input: SlotInput): DueMessage[] {
  const { teams, now } = input;
  const open = input.games.filter((g) => g.status === "scheduled");
  const tipsById = new Map((input.tips?.tips ?? []).map((t) => [t.gameId, t]));
  const hasBaseline = input.injuries?.baseline != null;
  const out: DueMessage[] = [];
  for (const slot of groupBySlot(open)) {
    if (!inSlotWindow(slot.kickoffUtc, now)) continue;
    const ids = new Set(slot.games.map((g) => g.id));
    const head = slot.games.length <= 4 ? slot.games.map((g) => gameLabel(teams, g)).join(" ") : `${slot.games.length} Spiele`;
    const injuryItems = hasBaseline
      ? (input.injuries?.changes ?? []).filter((c) => ids.has(c.gameId)).map(formatChange)
      : [];
    const tipItems = slot.games.flatMap((g) => {
      const t = tipsById.get(g.id);
      if (!t || !t.changedSinceFirst) return [];
      return [`Tipp ${abbrOf(teams, t.firstPickTeamId)}>${abbrOf(teams, t.pickTeamId)}`];
    });
    const items = [...tipItems, ...injuryItems];
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

export interface DueInput extends SlotInput {
  log: PushLogFile;
}

/** Alle fälligen Meldungen, die noch nicht im Log stehen. Tippliste vor Slots. */
export function dueMessages(input: DueInput): DueMessage[] {
  const sent = new Set(input.log.entries.map((e) => e.key));
  const all: DueMessage[] = [];
  if (input.tips) {
    const ready = tipsReadyMessage(input.tips, input.games, input.teams);
    if (ready) all.push(ready);
  }
  all.push(...slotMessages(input));
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
