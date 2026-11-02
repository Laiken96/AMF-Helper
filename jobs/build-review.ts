// Datenjob Wochenbilanz (D032): schreibt data/reviews/<saison>-<typ>-<woche>.json und data/reviews/index.json.
// Für jede Tippdatei, deren Review fehlt oder nicht complete ist. Die aktuelle Woche kommt aus der Wochendatei,
// jede andere Woche wird per ESPN nachgeladen. Wochen ohne begonnenes Spiel werden übersprungen.
// Bei Fehler in einer Woche bleibt deren Review unverändert, die übrigen Wochen laufen weiter, Exit Code 1.
// Abgleich Rangliste gegen App Tipps (D050): für das eigene Kürzel aus data/standings.json (me) mit dem Verlauf
// data/standings-history.json. Kommt die Meldung nach der kompletten Bilanz, ergänzt der nächste Lauf nur dieses Feld.
// Aufruf: npm run job:review [-- --season 2026 --type 2 --week 8]. Mit Woche nur diese, immer frisch von ESPN.
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { parseScoreboard, scoreboardUrl } from "../src/core/espn";
import { CurrentFileSchema, WeekFileSchema, weekFilePath, type Game } from "../src/core/schema";
import { TipsFileSchema, tipsFilePath, type TipsFile } from "../src/core/tips-schema";
import {
  REVIEW_INDEX_PATH,
  ReviewFileSchema,
  ReviewIndexSchema,
  reviewFilePath,
  StandingsHistorySchema,
  type ReviewFile,
  type StandingsHistory,
} from "../src/core/review-schema";
import { buildReview, buildReviewIndex, rankingCheck, sameReviewContent, withRankingCheck } from "../src/core/review";
import { StandingsFileSchema } from "../src/core/standings";
import { OpinionsFileSchema, opinionsFilePath, type OpinionsFile } from "../src/core/extra-schema";
import { DATA_DIR, fetchJson, type MainDeps } from "./fetch-schedule";
import { parseCliArgs, toJson, writeFiles } from "./schedule-lib";
import { describeError, readJsonStrict } from "./watch";

export type { MainDeps };

const nowUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const FILE_RE = /^(\d{4})-(\d)-(\d{2})\.json$/;

interface WeekKey {
  season: number;
  seasonType: number;
  week: number;
}

async function listWeeks(dataDir: string, sub: string): Promise<WeekKey[]> {
  let names: string[];
  try {
    names = await readdir(join(dataDir, sub));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return names.flatMap((n) => {
    const m = FILE_RE.exec(n);
    return m ? [{ season: Number(m[1]), seasonType: Number(m[2]), week: Number(m[3]) }] : [];
  });
}

/** Führt den Job aus und liefert den Exit Code. Schreibt nur bei inhaltlicher Änderung. */
export async function main(argv: readonly string[], deps: MainDeps = {}): Promise<number> {
  const dataDir = deps.dataDir ?? DATA_DIR;
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const now = (deps.now ?? nowUtc)();

  let args;
  try {
    args = parseCliArgs(argv);
  } catch (err) {
    error(`Ungültige Argumente. ${describeError(err)}`);
    return 1;
  }
  const given = [args.season, args.seasonType, args.week].filter((v) => v !== undefined).length;
  if (given !== 0 && given !== 3) {
    error("Ungültige Argumente. --season, --type und --week nur gemeinsam.");
    return 1;
  }
  const explicit = given === 3;

  let current: WeekKey | null = null;
  try {
    const raw = await readJsonStrict(join(dataDir, "current.json"));
    if (raw !== undefined) current = CurrentFileSchema.parse(raw);
  } catch (err) {
    log(`data/current.json ungültig, alle Wochen kommen von ESPN. ${describeError(err)}`);
  }
  const isCurrent = (k: WeekKey) =>
    current !== null && current.season === k.season && current.seasonType === k.seasonType && current.week === k.week;

  // Rangliste ist optional. Fehlt sie oder ist sie ungültig, entsteht die Bilanz ohne Abgleich.
  let ranking: { me: string; history: StandingsHistory } | null = null;
  try {
    const sRaw = await readJsonStrict(join(dataDir, "standings.json"));
    const hRaw = await readJsonStrict(join(dataDir, "standings-history.json"));
    if (sRaw !== undefined && hRaw !== undefined) {
      ranking = { me: StandingsFileSchema.parse(sRaw).me, history: StandingsHistorySchema.parse(hRaw) };
    }
  } catch (err) {
    log(`Rangliste ungültig, Bilanz ohne Abgleich. ${describeError(err)}`);
  }
  const checkFor = (r: ReviewFile) => (ranking ? rankingCheck(r, ranking.history, ranking.me) : null);

  const weeks = explicit ? [args as WeekKey] : await listWeeks(dataDir, "tips");
  let exit = 0;
  for (const k of weeks) {
    const label = `${k.season}-${k.seasonType}-${k.week}`;
    const path = reviewFilePath(k.season, k.seasonType, k.week);
    const keep = `data/${path} bleibt unverändert.`;
    try {
      const tipsRaw = await readJsonStrict(join(dataDir, tipsFilePath(k.season, k.seasonType, k.week)));
      if (tipsRaw === undefined) {
        error(`Keine Tippdatei für ${label}. ${keep}`);
        exit = 1;
        continue;
      }
      const tips: TipsFile = TipsFileSchema.parse(tipsRaw);

      const prevRaw = await readJsonStrict(join(dataDir, path));
      const prev: ReviewFile | null = prevRaw === undefined ? null : ReviewFileSchema.parse(prevRaw);
      if (prev?.complete && !explicit) {
        const check = checkFor(prev);
        if (JSON.stringify(check ?? null) === JSON.stringify(prev.rankingCheck ?? null)) continue;
        await writeFiles(dataDir, [{ path, content: toJson(withRankingCheck({ ...prev, updatedAt: now }, check)) }]);
        log(`${label}: Abgleich Rangliste ${check ? `gemeldet ${check.reported}, App ${check.appPoints}, Differenz ${check.gap}` : "entfernt"}`);
        log(`  geschrieben data/${path}`);
        continue;
      }

      const firstKickoff = Math.min(...tips.tips.map((t) => Date.parse(t.kickoffUtc)));
      if (!(firstKickoff <= Date.parse(now))) {
        log(`${label}: noch kein Spiel begonnen, keine Bilanz`);
        continue;
      }

      let games: Game[];
      const weekRaw = isCurrent(k) && !explicit ? await readJsonStrict(join(dataDir, weekFilePath(k.season, k.seasonType, k.week))) : undefined;
      if (weekRaw !== undefined) {
        games = WeekFileSchema.parse(weekRaw).games;
      } else {
        const url = scoreboardUrl(k);
        log(`Hole ${url}`);
        const parsed = parseScoreboard(await fetchJson(url, deps.fetch), { fetchedAt: now });
        if (!parsed.ok) throw new Error(`Schemafehler\n${parsed.error}`);
        const w = parsed.week;
        if (w.season !== k.season || w.seasonType !== k.seasonType || w.week !== k.week) {
          throw new Error(`ESPN lieferte ${w.season}-${w.seasonType}-${w.week} statt ${label}`);
        }
        games = w.games;
      }

      // Meinungsdatei ist optional. Ist sie ungültig, kommt die Bilanz ohne Vergleich.
      let opinions: OpinionsFile | null = null;
      try {
        const opRaw = await readJsonStrict(join(dataDir, opinionsFilePath(k.season, k.seasonType, k.week)));
        if (opRaw !== undefined) opinions = OpinionsFileSchema.parse(opRaw);
      } catch (err) {
        log(`${label}: Meinungsdatei ungültig, Bilanz ohne KI Vergleich. ${describeError(err)}`);
      }

      const built = buildReview(tips, games, now, opinions);
      const next = withRankingCheck(built, checkFor(built));
      log(
        `${label}: ${next.points} von ${next.tipped} Punkte, Abweichungen netto ${next.deviationNet}, ` +
          `${next.complete ? "komplett" : "Zwischenstand"}`,
      );
      if (next.rankingCheck) {
        const c = next.rankingCheck;
        log(`  Abgleich Rangliste ${c.playerId}: gemeldet ${c.reported}, App ${c.appPoints}, Differenz ${c.gap}`);
      }
      if (next.opinionCompare) {
        const c = next.opinionCompare;
        log(`  KI Vergleich: ${c.scored} gewertet, Markt ${c.marketHits}, KI ${c.aiHits}, ${c.disagreements.length} abweichend`);
      }
      if (prev && sameReviewContent(prev, next)) {
        log(`  unverändert data/${path}`);
        continue;
      }
      await writeFiles(dataDir, [{ path, content: toJson(next) }]);
      log(`  geschrieben data/${path}`);
    } catch (err) {
      error(`Bilanz ${label} fehlgeschlagen. ${keep} ${describeError(err)}`);
      exit = 1;
    }
  }

  // Index aus allen vorhandenen Reviews, damit er auch nach einem Teilfehler stimmt.
  const paths = (await listWeeks(dataDir, "reviews")).map((k) => reviewFilePath(k.season, k.seasonType, k.week));
  const index = buildReviewIndex(paths);
  let prevIndex: unknown;
  try {
    prevIndex = await readJsonStrict(join(dataDir, REVIEW_INDEX_PATH));
  } catch {
    prevIndex = undefined;
  }
  const prevOk = ReviewIndexSchema.safeParse(prevIndex);
  if (!prevOk.success || JSON.stringify(prevOk.data) !== JSON.stringify(index)) {
    await writeFiles(dataDir, [{ path: REVIEW_INDEX_PATH, content: toJson(index) }]);
    log(`  geschrieben data/${REVIEW_INDEX_PATH} (${index.length} Wochen)`);
  }
  return exit;
}

const isDirectRun = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error("Unerwarteter Fehler, Bilanz bleibt unverändert.", err);
      process.exitCode = 1;
    },
  );
}
