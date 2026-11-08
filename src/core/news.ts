// News aus RSS und der ESPN JSON Schnittstelle (Sprint 5 bis 8, D042, D057). Reine Logik ohne Node APIs.
// Schreiber ist jobs/news.ts. Eigener kleiner Parser statt Paket: CBS und PFT sind einfaches RSS 2.0, gebraucht
// werden nur item, title, link, description und pubDate. Volltexte (content:encoded) werden verworfen.
// ESPN blockiert den RSS Feed seit November 2026 (HTTP 202 mit WAF Challenge), daher die JSON Schnittstelle.
import { z } from "zod";
import { EXTRA_SCHEMA_VERSION, NewsFileSchema, type NewsFile } from "./extra-schema";
import type { Team } from "./schema";

export type NewsSource = NewsFile["items"][number]["source"];
export type NewsItem = NewsFile["items"][number];

export const NEWS_MAX_ITEMS = 150;
export const TITLE_MAX = 300;
export const SUMMARY_MAX = 400;
export const NEWS_FILE_PATH = "news.json";

export type FeedFormat = "rss" | "espn-json";

export const ESPN_NEWS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50";

export const NEWS_FEEDS: ReadonlyArray<{ source: NewsSource; url: string; format: FeedFormat }> = [
  { source: "espn", url: ESPN_NEWS_URL, format: "espn-json" },
  { source: "cbs", url: "https://www.cbssports.com/rss/headlines/nfl/", format: "rss" },
  { source: "pft", url: "https://profootballtalk.nbcsports.com/feed/", format: "rss" },
];

export interface RawFeedItem {
  title: string;
  link: string;
  description: string | null;
  pubDate: string | null;
  /** Teams aus der Quelle selbst (ESPN Kategorien). Fehlt das Feld, gilt die Erkennung aus dem Text. */
  teamIds?: string[];
}

/** Werbeartikel der Wettanbieter (D057), gilt für alle Quellen. */
export function isPromo(title: string): boolean {
  return /\b(?:promo|bonus)\s+codes?\b/i.test(title);
}

/** Ab so vielen Teams in den ESPN Kategorien ist ein Artikel eine Ligaübersicht, dann zählt der Text. */
export const ESPN_CATEGORY_TEAMS_MAX = 4;

const EspnNewsSchema = z.looseObject({
  articles: z.array(
    z.looseObject({
      headline: z.string().optional(),
      description: z.string().optional(),
      published: z.string().optional(),
      links: z.looseObject({ web: z.looseObject({ href: z.string() }).optional() }).optional(),
      categories: z
        .array(z.looseObject({ type: z.string().optional(), uid: z.string().optional(), teamId: z.number().optional() }))
        .optional()
        .default([]),
    }),
  ),
});

/**
 * Liest die Antwort der ESPN News Schnittstelle. Wirft bei unbekannter Struktur. Artikel ohne Titel oder Link
 * fallen weg. Teams kommen aus den Kategorien vom Typ team der NFL (uid mit l:28), College Teams fallen weg.
 */
export function parseEspnNews(raw: unknown): RawFeedItem[] {
  const r = EspnNewsSchema.safeParse(raw);
  if (!r.success) throw new Error(`Unbekannte Struktur der ESPN News\n${z.prettifyError(r.error)}`);
  const out: RawFeedItem[] = [];
  for (const a of r.data.articles) {
    const title = plainText(a.headline ?? "");
    const link = a.links?.web?.href?.trim() ?? "";
    if (!title || !link) continue;
    const teamIds = [
      ...new Set(
        a.categories
          .filter((c) => c.type === "team" && c.teamId !== undefined && /~l:28~/.test(c.uid ?? ""))
          .map((c) => String(c.teamId)),
      ),
    ];
    // ESPN beginnt Anrisse von Agenturmeldungen oft mit einem Strich, der ohne Ortsmarke stehen bleibt.
    const desc = a.description === undefined ? "" : plainText(a.description).replace(/^[\u2014\u2013-]\s*/, "");
    // Videos tragen oft den Titel als Anriss, der bringt nichts.
    out.push({ title, link, description: desc && desc !== title ? desc : null, pubDate: a.published ?? null, teamIds });
  }
  return out;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  hellip: "...",
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
};

/** Dekodiert numerische und die üblichen benannten HTML Entities. Unbekannte bleiben stehen. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Entfernt CDATA Hüllen, ohne den Inhalt anzufassen. */
function unwrapCdata(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

/** Text ohne HTML Tags und Entities, Leerraum zusammengefasst. */
export function plainText(text: string): string {
  const noCdata = unwrapCdata(text);
  // Erst dekodieren, damit kodiertes HTML wie &lt;p&gt; auch entfernt wird, danach Tags weg.
  const decoded = decodeEntities(noCdata);
  const noTags = decoded
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(noTags).replace(/\s+/g, " ").trim();
}

function tagContent(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = re.exec(block);
  return m ? m[1]! : null;
}

/**
 * Liest die Items eines RSS 2.0 Feeds. Wirft, wenn das Dokument kein RSS ist.
 * Items ohne Titel oder Link fallen weg.
 */
export function parseRss(xml: string): RawFeedItem[] {
  if (!/<rss[\s>]/i.test(xml) || !/<channel[\s>]/i.test(xml)) throw new Error("Kein RSS Dokument");
  // Volltexte und Medien zuerst entfernen, sie können beliebiges HTML enthalten.
  const cleaned = xml.replace(/<content:encoded[\s\S]*?<\/content:encoded>/gi, "");
  const out: RawFeedItem[] = [];
  for (const m of cleaned.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const block = m[1]!;
    const title = plainText(tagContent(block, "title") ?? "");
    const link = plainText(tagContent(block, "link") ?? "");
    if (!title || !link) continue;
    const desc = tagContent(block, "description");
    const pub = tagContent(block, "pubDate");
    out.push({
      title,
      link,
      description: desc === null ? null : plainText(desc) || null,
      pubDate: pub === null ? null : plainText(pub) || null,
    });
  }
  return out;
}

const TZ_OFFSETS: Record<string, string> = {
  EST: "-0500",
  EDT: "-0400",
  CST: "-0600",
  CDT: "-0500",
  MST: "-0700",
  MDT: "-0600",
  PST: "-0800",
  PDT: "-0700",
  GMT: "+0000",
  UTC: "+0000",
  Z: "+0000",
};

/** RFC 822 Datum zu ISO 8601 UTC ohne Millisekunden, null wenn nicht lesbar. */
export function parsePubDate(value: string | null): string | null {
  if (!value) return null;
  const withOffset = value.trim().replace(/\s([A-Z]{1,3})$/, (m, tz: string) => (TZ_OFFSETS[tz] ? ` ${TZ_OFFSETS[tz]}` : m));
  const ms = Date.parse(withOffset);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Query Parameter, die eine Meldung kennzeichnen (ESPN Recap ?gameId=) und deshalb in der URL bleiben. */
const ID_PARAMS = ["gameId"] as const;

/**
 * Normalisierte URL für Dedupe und ID: https, Host klein ohne www, ohne Fragment und abschliessenden
 * Schrägstrich. Von der Query bleiben nur Parameter, die die Meldung kennzeichnen (ID_PARAMS). null bei ungültiger URL.
 */
export function normalizeUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  const keep = ID_PARAMS.filter((k) => u.searchParams.has(k)).map((k) => `${k}=${encodeURIComponent(u.searchParams.get(k)!)}`);
  return `https://${host}${path}${keep.length > 0 ? `?${keep.join("&")}` : ""}`;
}

/** Kürzt auf max Zeichen an einer Wortgrenze und hängt "..." an. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 3);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}...`;
}

/** Spitznamen, die in Schlagzeilen oft statt des Teamnamens stehen. */
export const TEAM_ALIASES: Record<string, readonly string[]> = {
  "25": ["Niners"],
  "27": ["Bucs"],
  "30": ["Jags"],
  "17": ["Pats"],
};

export interface TeamMatcher {
  teamId: string;
  pattern: RegExp;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Suchmuster pro Team aus vollem Namen ("Kansas City Chiefs"), Teamname ("Chiefs") und Spitznamen.
 * Eine Stadt allein zählt nie, sie ist oft ein Personenname ("Dallas Goedert", "Malik Washington").
 */
export function teamMatchers(teams: readonly Team[]): TeamMatcher[] {
  return teams.map((t) => {
    const terms = new Set<string>([t.name, t.shortName, ...(TEAM_ALIASES[t.id] ?? [])]);
    const alt = [...terms].sort((a, b) => b.length - a.length).map(escapeRe).join("|");
    // Gross und Kleinschreibung zählt, damit "bills" oder "jets" als Wort nicht anschlagen.
    return { teamId: t.id, pattern: new RegExp(`(?<![\\w'])(?:${alt})(?![\\w])`) };
  });
}

/** ESPN Team IDs, die in Titel oder Anriss vorkommen, in der Reihenfolge der Teamliste. */
export function detectTeams(text: string, matchers: readonly TeamMatcher[]): string[] {
  return matchers.filter((m) => m.pattern.test(text)).map((m) => m.teamId);
}

/**
 * Wandelt die Items eines Feeds in Einträge des Datenvertrags. Ungültige Items und Werbeartikel fallen weg.
 * Bringt die Quelle Teams mit (1 bis ESPN_CATEGORY_TEAMS_MAX bekannte Teams), gelten diese, sonst der Text.
 */
export function toNewsItems(
  source: NewsSource,
  raw: readonly RawFeedItem[],
  matchers: readonly TeamMatcher[],
  idOf: (normalizedUrl: string) => string,
): NewsItem[] {
  const out: NewsItem[] = [];
  const known = new Set(matchers.map((m) => m.teamId));
  for (const r of raw) {
    if (isPromo(r.title)) continue;
    const url = normalizeUrl(r.link);
    const publishedAt = parsePubDate(r.pubDate);
    if (url === null || publishedAt === null) continue;
    const title = truncate(r.title, TITLE_MAX);
    const summary = r.description ? truncate(r.description, SUMMARY_MAX) : null;
    out.push({
      id: idOf(url),
      source,
      url,
      title,
      summary,
      publishedAt,
      teamIds: teamsOf(r, known, matchers),
    });
  }
  return out;
}

function teamsOf(r: RawFeedItem, known: ReadonlySet<string>, matchers: readonly TeamMatcher[]): string[] {
  const own = (r.teamIds ?? []).filter((id) => known.has(id));
  if (own.length > 0 && own.length <= ESPN_CATEGORY_TEAMS_MAX) {
    // Reihenfolge der Teamliste wie bei der Texterkennung.
    return matchers.filter((m) => own.includes(m.teamId)).map((m) => m.teamId);
  }
  return detectTeams(`${r.title} ${r.description ?? ""}`, matchers);
}

/**
 * Führt bestehende und neue Einträge zusammen: Dedupe über die ID (normalisierte URL), neuere Fassung
 * gewinnt, Erstveröffentlichung bleibt. Absteigend nach publishedAt, höchstens 150. Werbeartikel aus früheren
 * Läufen fallen dabei weg.
 */
export function mergeNews(existing: readonly NewsItem[], fresh: readonly NewsItem[], now: string): NewsFile {
  const byId = new Map<string, NewsItem>();
  for (const it of existing) if (!isPromo(it.title)) byId.set(it.id, it);
  for (const it of fresh) {
    const prev = byId.get(it.id);
    // Gleiche Meldung aus zweitem Feed oder neuem Abruf: Inhalt aktualisieren, frühestes Datum behalten.
    if (prev) {
      const publishedAt = prev.publishedAt < it.publishedAt ? prev.publishedAt : it.publishedAt;
      byId.set(it.id, { ...it, source: prev.source, publishedAt });
    } else {
      byId.set(it.id, it);
    }
  }
  const items = [...byId.values()]
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : a.id < b.id ? -1 : 1))
    .slice(0, NEWS_MAX_ITEMS);
  return NewsFileSchema.parse({ schemaVersion: EXTRA_SCHEMA_VERSION, updatedAt: now, items });
}

export function sameNewsContent(a: NewsFile, b: NewsFile): boolean {
  return JSON.stringify(a.items) === JSON.stringify(b.items);
}
