import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NewsFileSchema } from "../src/core/extra-schema";
import { TeamsFileSchema } from "../src/core/schema";
import {
  NEWS_FEEDS,
  NEWS_MAX_ITEMS,
  decodeEntities,
  detectTeams,
  mergeNews,
  normalizeUrl,
  parsePubDate,
  parseRss,
  plainText,
  teamMatchers,
  toNewsItems,
  type NewsItem,
} from "../src/core/news";
import { main, newsId } from "../jobs/news";
import type { FetchFn } from "../jobs/fetch-schedule";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const espnXml = fixture("rss-espn-2026-11-02.xml");
const cbsXml = fixture("rss-cbs-2026-11-02.xml");
const pftXml = fixture("rss-pft-2026-11-02.xml");
const teamsText = readFileSync(new URL("../data/teams.json", import.meta.url), "utf8");
const teams = TeamsFileSchema.parse(JSON.parse(teamsText)).teams;
const matchers = teamMatchers(teams);
const NOW = "2026-11-02T12:00:00Z";

describe("RSS Parser", () => {
  it("liest alle drei echten Feeds", () => {
    for (const xml of [espnXml, cbsXml, pftXml]) {
      const items = parseRss(xml);
      expect(items.length).toBeGreaterThan(10);
      for (const it of items) {
        expect(it.title).not.toMatch(/<|&amp;|CDATA/);
        expect(it.link).toMatch(/^https?:\/\//);
        expect(parsePubDate(it.pubDate)).not.toBeNull();
      }
    }
  });

  it("Anriss ohne HTML und ohne Volltext", () => {
    const pft = parseRss(pftXml);
    for (const it of pft) {
      expect(it.description ?? "").not.toMatch(/<[a-z]/i);
      expect((it.description ?? "").length).toBeLessThan(2000);
    }
    expect(plainText("<p>Hallo&nbsp;<b>Welt</b></p> &lt;i&gt;x&lt;/i&gt;")).toBe("Hallo Welt x");
    expect(decodeEntities("We&#039;re &amp; &#x27;ok&#x27;")).toBe("We're & 'ok'");
  });

  it("kaputter Feed wirft, Items ohne Titel oder Link fallen weg", () => {
    expect(() => parseRss("<html><body>Fehler</body></html>")).toThrow("Kein RSS");
    expect(() => parseRss("")).toThrow();
    const xml = `<rss><channel><item><title>Ohne Link</title></item><item><link>https://x.com/a</link></item>
      <item><title>Gut</title><link>https://x.com/b</link><pubDate>kein Datum</pubDate></item></channel></rss>`;
    const items = parseRss(xml);
    expect(items).toHaveLength(1);
    expect(toNewsItems("espn", items, matchers, newsId)).toEqual([]);
  });

  it("Zeitzonen wie EST", () => {
    expect(parsePubDate("Mon, 2 Nov 2026 01:54:06 EST")).toBe("2026-11-02T06:54:06Z");
    expect(parsePubDate("Mon, 02 Nov 2026 07:08:25 -0500")).toBe("2026-11-02T12:08:25Z");
  });
});

describe("URL und Teams", () => {
  it("normalisiert URLs für Dedupe", () => {
    expect(normalizeUrl("http://www.ESPN.com/nfl/story/_/id/1/x/?utm_source=rss#top")).toBe("https://espn.com/nfl/story/_/id/1/x");
    expect(normalizeUrl("ftp://x.com/a")).toBeNull();
    expect(normalizeUrl("kein link")).toBeNull();
  });

  it("erkennt Namen, Spitznamen und Städte", () => {
    const id = (abbr: string) => teams.find((t) => t.abbr === abbr)!.id;
    expect(detectTeams("Five things as Broncos stun Chiefs", matchers).sort()).toEqual([id("DEN"), id("KC")].sort());
    expect(detectTeams("Kansas City falls at home", matchers)).toEqual([id("KC")]);
    expect(detectTeams("Niners and Bucs trade talk", matchers).sort()).toEqual([id("SF"), id("TB")].sort());
    expect(detectTeams("Philadelphia Eagles lose", matchers)).toEqual([id("PHI")]);
  });

  it("mehrdeutige Städte und kleingeschriebene Wörter zählen nicht", () => {
    expect(detectTeams("New York weather delays flights", matchers)).toEqual([]);
    expect(detectTeams("Los Angeles hosts the draft", matchers)).toEqual([]);
    expect(detectTeams("He paid the bills and flew jets", matchers)).toEqual([]);
  });

  it("echte ESPN Meldung zu Lamar Jackson hat die Ravens", () => {
    const items = toNewsItems("espn", parseRss(espnXml), matchers, newsId);
    const lamar = items.find((i) => /Lamar/.test(i.title));
    expect(lamar?.teamIds).toContain("33");
  });
});

describe("Zusammenführen", () => {
  const item = (n: number, at: string, url = `https://x.com/${n}`): NewsItem => ({
    id: newsId(url),
    source: "espn",
    url,
    title: `Titel ${n}`,
    summary: null,
    publishedAt: at,
    teamIds: [],
  });

  it("doppelte Meldungen erscheinen einmal, frühestes Datum bleibt", () => {
    const a = item(1, "2026-11-02T10:00:00Z");
    const dup = { ...item(1, "2026-11-02T11:00:00Z"), title: "Titel neu", source: "cbs" as const };
    const f = mergeNews([a], [dup, item(2, "2026-11-02T09:00:00Z")], NOW);
    expect(f.items).toHaveLength(2);
    expect(f.items[0]).toMatchObject({ title: "Titel neu", publishedAt: "2026-11-02T10:00:00Z", source: "espn" });
  });

  it("gleiche Meldung mit anderer Query ist ein Duplikat", () => {
    const raw = [
      { title: "A", link: "https://www.espn.com/nfl/story/_/id/1/a?src=rss", description: null, pubDate: "Mon, 02 Nov 2026 07:00:00 GMT" },
      { title: "A", link: "https://espn.com/nfl/story/_/id/1/a/", description: null, pubDate: "Mon, 02 Nov 2026 07:00:00 GMT" },
    ];
    const f = mergeNews([], toNewsItems("espn", raw, matchers, newsId), NOW);
    expect(f.items).toHaveLength(1);
  });

  it("höchstens 150, absteigend nach Datum", () => {
    const many = Array.from({ length: 200 }, (_, i) => item(i, new Date(Date.parse(NOW) - i * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z")));
    const f = mergeNews([], many, NOW);
    expect(f.items).toHaveLength(NEWS_MAX_ITEMS);
    expect(f.items[0]!.title).toBe("Titel 0");
    expect(NewsFileSchema.parse(f)).toBeTruthy();
  });

  it("lange Titel und Anrisse werden gekürzt", () => {
    const raw = [{ title: "x ".repeat(400), link: "https://x.com/l", description: "y ".repeat(400), pubDate: "Mon, 02 Nov 2026 07:00:00 GMT" }];
    const [it] = toNewsItems("cbs", raw, matchers, newsId);
    expect(it!.title.length).toBeLessThanOrEqual(300);
    expect(it!.summary!.length).toBeLessThanOrEqual(400);
  });
});

describe("news main", () => {
  let dir: string;
  let errors: string[];
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nfl-news-"));
    await writeFile(join(dir, "teams.json"), teamsText);
    errors = [];
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const byUrl = (map: Record<string, () => Response>): FetchFn => async (url) => {
    const f = map[url];
    if (!f) throw new TypeError("fetch failed");
    return f();
  };
  const ok = {
    [NEWS_FEEDS[0]!.url]: () => new Response(espnXml),
    [NEWS_FEEDS[1]!.url]: () => new Response(cbsXml),
    [NEWS_FEEDS[2]!.url]: () => new Response(pftXml),
  };
  const deps = (fetch: FetchFn, now = NOW) => ({ fetch, dataDir: dir, now: () => now, log: () => {}, error: (m: string) => errors.push(m) });
  const read = async () => NewsFileSchema.parse(JSON.parse(await readFile(join(dir, "news.json"), "utf8")));

  it("schreibt gültige Datei aus allen Quellen, zweiter Lauf schreibt nicht", async () => {
    expect(await main([], deps(byUrl(ok)))).toBe(0);
    const f = await read();
    expect(new Set(f.items.map((i) => i.source))).toEqual(new Set(["espn", "cbs", "pft"]));
    expect(new Set(f.items.map((i) => i.id)).size).toBe(f.items.length);
    const before = await readFile(join(dir, "news.json"), "utf8");
    expect(await main([], deps(byUrl(ok), "2026-11-02T13:00:00Z"))).toBe(0);
    expect(await readFile(join(dir, "news.json"), "utf8")).toBe(before);
  });

  it("kaputter Feed blockiert die anderen nicht, alte Einträge der Quelle bleiben", async () => {
    expect(await main([], deps(byUrl(ok)))).toBe(0);
    const cbsBefore = (await read()).items.filter((i) => i.source === "cbs").length;
    const broken = { ...ok, [NEWS_FEEDS[1]!.url]: () => new Response("<html>Wartung</html>") };
    expect(await main([], deps(byUrl(broken)))).toBe(0);
    expect(errors.join("\n")).toMatch(/cbs fehlgeschlagen/);
    expect((await read()).items.filter((i) => i.source === "cbs").length).toBe(cbsBefore);
  });

  it("HTTP Fehler und Netzfehler einer Quelle", async () => {
    const partial = { [NEWS_FEEDS[0]!.url]: () => new Response("boom", { status: 503 }), [NEWS_FEEDS[2]!.url]: ok[NEWS_FEEDS[2]!.url]! };
    expect(await main([], deps(byUrl(partial)))).toBe(0);
    expect(new Set((await read()).items.map((i) => i.source))).toEqual(new Set(["pft"]));
    expect(errors).toHaveLength(2);
  });

  it("Bot Abwehr mit HTTP 202 und leerem Körper zählt als Fehler der Quelle", async () => {
    const waf = { ...ok, [NEWS_FEEDS[0]!.url]: () => new Response("", { status: 202, headers: { "x-amzn-waf-action": "challenge" } }) };
    expect(await main([], deps(byUrl(waf)))).toBe(0);
    expect(errors.join("\n")).toMatch(/espn fehlgeschlagen.*HTTP 202.*WAF challenge/);
  });

  it("alle Quellen kaputt: Exit 1, Datei unverändert", async () => {
    expect(await main([], deps(byUrl(ok)))).toBe(0);
    const before = await readFile(join(dir, "news.json"), "utf8");
    expect(await main([], deps(byUrl({})))).toBe(1);
    expect(await readFile(join(dir, "news.json"), "utf8")).toBe(before);
  });

  it("fehlende teams.json: Exit 1", async () => {
    await rm(join(dir, "teams.json"));
    expect(await main([], deps(byUrl(ok)))).toBe(1);
  });
});
