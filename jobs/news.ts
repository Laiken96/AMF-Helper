// Datenjob News (D042, D057): liest die ESPN News Schnittstelle (JSON) und die RSS Feeds von CBS und PFT und
// schreibt data/news.json. Nur Titel, Anriss ohne HTML, Link, Datum und Teams, ohne Werbeartikel. Fehlt eine
// Quelle, bleiben ihre bisherigen Einträge erhalten, die anderen laufen weiter und das Log zeigt eine Warnung
// (in GitHub Actions als Annotation). Exit 1 nur, wenn alle Quellen scheitern oder Pflichtdaten fehlen.
// Aufruf: npm run job:news
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { NewsFileSchema, type NewsFile } from "../src/core/extra-schema";
import { TeamsFileSchema } from "../src/core/schema";
import {
  NEWS_FEEDS,
  NEWS_FILE_PATH,
  mergeNews,
  parseEspnNews,
  parseRss,
  sameNewsContent,
  teamMatchers,
  toNewsItems,
  type FeedFormat,
  type NewsItem,
  type RawFeedItem,
} from "../src/core/news";
import { DATA_DIR, type MainDeps } from "./fetch-schedule";
import { FETCH_TIMEOUT_MS, USER_AGENT, toJson, writeFiles } from "./schedule-lib";
import { describeError, readJsonStrict } from "./watch";

export type { MainDeps };

const nowUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/** Stabile ID aus der normalisierten URL. */
export function newsId(normalizedUrl: string): string {
  return createHash("sha256").update(normalizedUrl).digest("hex").slice(0, 16);
}

const ACCEPT: Record<FeedFormat, string> = {
  rss: "application/rss+xml, application/xml, text/xml",
  "espn-json": "application/json",
};

async function fetchText(url: string, format: FeedFormat, fetchFn: NonNullable<MainDeps["fetch"]>): Promise<string> {
  const res = await fetchFn(url, {
    headers: { "User-Agent": USER_AGENT, Accept: ACCEPT[format] },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  // 202 mit leerem Körper ist eine Bot Abwehr (z. B. AWS WAF Challenge bei ESPN), kein Feed.
  if (res.status !== 200) {
    const waf = res.headers.get("x-amzn-waf-action");
    throw new Error(`HTTP ${res.status} ${res.statusText}${waf ? ` (WAF ${waf})` : ""}`);
  }
  return res.text();
}

/** Lädt eine Quelle und liefert ihre Rohdaten im gemeinsamen Format. */
async function loadFeed(url: string, format: FeedFormat, fetchFn: NonNullable<MainDeps["fetch"]>): Promise<RawFeedItem[]> {
  const text = await fetchText(url, format, fetchFn);
  if (format === "rss") return parseRss(text);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Antwort ist kein JSON (${text.length} Zeichen)`);
  }
  return parseEspnNews(json);
}

export async function main(argv: readonly string[], deps: MainDeps = {}): Promise<number> {
  const dataDir = deps.dataDir ?? DATA_DIR;
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const now = (deps.now ?? nowUtc)();
  const fetchFn = deps.fetch ?? fetch;
  const keep = `data/${NEWS_FILE_PATH} bleibt unverändert.`;

  if (argv.length > 0) {
    error(`Unbekanntes Argument: ${argv.join(" ")}`);
    return 1;
  }

  let matchers;
  try {
    matchers = teamMatchers(TeamsFileSchema.parse(await readJsonStrict(join(dataDir, "teams.json"))).teams);
  } catch (err) {
    error(`data/teams.json fehlt oder ist ungültig. ${keep} ${describeError(err)}`);
    return 1;
  }

  // Eine kaputte bestehende Datei wird ersetzt, News sind kein gesperrter Zustand.
  let existing: NewsFile | null = null;
  try {
    const raw = await readJsonStrict(join(dataDir, NEWS_FILE_PATH));
    if (raw !== undefined) existing = NewsFileSchema.parse(raw);
  } catch (err) {
    log(`Bestehende data/${NEWS_FILE_PATH} ungültig, wird neu aufgebaut. ${describeError(err)}`);
  }

  const fresh: NewsItem[] = [];
  let failed = 0;
  for (const feed of NEWS_FEEDS) {
    try {
      const items = toNewsItems(feed.source, await loadFeed(feed.url, feed.format, fetchFn), matchers, newsId);
      if (items.length === 0) throw new Error("Quelle ohne gültige Einträge");
      log(`${feed.source}: ${items.length} Einträge`);
      fresh.push(...items);
    } catch (err) {
      failed++;
      // ::warning:: erscheint in GitHub Actions als Annotation in der Übersicht des Laufs.
      error(`::warning::Warnung: Quelle ${feed.source} fehlgeschlagen, ihre bisherigen Einträge bleiben. ${describeError(err).replace(/\n/g, " ")}`);
    }
  }
  if (failed === NEWS_FEEDS.length) {
    error(`Alle Quellen fehlgeschlagen. ${keep}`);
    return 1;
  }

  const next = mergeNews(existing?.items ?? [], fresh, now);
  if (existing && sameNewsContent(existing, next)) {
    log(`  unverändert data/${NEWS_FILE_PATH} (${next.items.length} Einträge)`);
    return 0;
  }
  await writeFiles(dataDir, [{ path: NEWS_FILE_PATH, content: toJson(next) }]);
  log(`  geschrieben data/${NEWS_FILE_PATH} (${next.items.length} Einträge)`);
  return 0;
}

const isDirectRun = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error("Unerwarteter Fehler im News Job, news.json bleibt unverändert.", err);
      process.exitCode = 1;
    },
  );
}
