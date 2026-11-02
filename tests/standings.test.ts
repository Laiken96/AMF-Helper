import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../jobs/standings";
import {
  FIELD_LABELS,
  PLAYER_IDS,
  applyReport,
  authorizedReport,
  issueInfo,
  parseCount,
  parseFormSections,
  parseReportBody,
  groupWeekRows,
  shortRaw,
  parseSeasonType,
} from "../src/core/standings";
import { StandingsFileSchema } from "../src/core/tips-schema";
import { StandingsHistorySchema } from "../src/core/review-schema";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const standingsText = read("../data/standings.json");
const historyText = read("../data/standings-history.json");
const standings = StandingsFileSchema.parse(JSON.parse(standingsText));
const history = StandingsHistorySchema.parse(JSON.parse(historyText));
const NOW = "2026-11-03T20:00:00Z";

type Values = Partial<Record<keyof typeof FIELD_LABELS, string>>;
const W9: Values = { season: "2026", seasonType: "Regular (2)", week: "9", MS: "79", LM: "76", DH: "75", CZ: "57", JA: "54" };
/** Body wie ihn GitHub aus dem Formular erzeugt. */
const body = (v: Values) =>
  (Object.keys(FIELD_LABELS) as Array<keyof typeof FIELD_LABELS>)
    .map((k) => `### ${FIELD_LABELS[k]}\n\n${v[k] ?? "_No response_"}`)
    .join("\n\n");

describe("Issue Body Parser", () => {
  it("liest alle Felder des Formulars", () => {
    const r = parseReportBody(body(W9));
    expect(r).toEqual({
      ok: true,
      report: {
        season: 2026,
        seasonType: 2,
        week: 9,
        players: [
          { id: "MS", points: 79 },
          { id: "LM", points: 76 },
          { id: "DH", points: 75 },
          { id: "CZ", points: 57 },
          { id: "JA", points: 54 },
        ],
      },
    });
  });

  it("robust gegen Leerzeichen, CRLF und Tausendertrennzeichen", () => {
    const messy = `###   Saison  \r\n\r\n 2'026 \r\n\r\n### Woche\r\n\r\n  9\r\n\r\n### MS\r\n\r\n 79\r\n\r\n### LM\r\n\r\n76 \r\n\r\n### DH\r\n\r\n\t75\r\n\r\n### CZ\r\n\r\n57\r\n\r\n### JA\r\n\r\n 54 `;
    const r = parseReportBody(messy);
    expect(r.ok && r.report.season).toBe(2026);
    expect(r.ok && r.report.seasonType).toBe(2);
    expect(r.ok && r.report.players.map((p) => p.points)).toEqual([79, 76, 75, 57, 54]);
  });

  it("Punkte über 300 werden abgelehnt", () => {
    const r = parseReportBody(body({ ...W9, JA: "1'000" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(["JA: 1000 Punkte ist mehr als 300, Tippfehler?"]);
    expect(parseReportBody(body({ ...W9, JA: "300" })).ok).toBe(true);
  });

  it("Rohwert im Fehler auf eine Zeile gekürzt, ohne Backticks", () => {
    const raw = "viele\n\n```js\nalert(1)\n``` und noch sehr viel mehr Text dahinter";
    const r = parseReportBody(body({ ...W9, JA: raw }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const shown = /JA: keine gültige Zahl \("(.*)"\)$/.exec(r.errors[0]!)?.[1];
      expect(shown).toBe(shortRaw(raw));
      expect(shown!.length).toBeLessThanOrEqual(40);
      expect(shown).not.toMatch(/[\n`]/);
      expect(shown!.startsWith("viele js alert(1) und")).toBe(true);
    }
  });

  it("parseCount lehnt kaputte Werte ab", () => {
    for (const v of ["", "_No response_", "-3", "12a", "1.5", "1,2345", "zwölf", "3 4", "1e3", "0x10", undefined]) {
      expect(parseCount(v), String(v)).toBeNull();
    }
    expect(parseCount("0")).toBe(0);
    expect(parseCount(" 1'234 ")).toBe(1234);
  });

  it("fehlende und kaputte Felder ergeben alle Gründe", () => {
    const r = parseReportBody(body({ ...W9, week: undefined, JA: "viele", MS: "-1" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(3);
      expect(r.errors.join(" ")).toContain("Woche: keine gültige Zahl (leer)");
      expect(r.errors.join(" ")).toContain('JA: keine gültige Zahl ("viele")');
    }
  });

  it("leerer oder fremder Body, unplausible Saison und Woche", () => {
    expect(parseReportBody("").ok).toBe(false);
    expect(parseReportBody("Hallo, hier die Punkte: 79 76 75").ok).toBe(false);
    const r = parseReportBody(body({ ...W9, season: "26", week: "40" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(["Saison 26 ist unplausibel", "Woche 40 muss zwischen 1 und 23 liegen"]);
  });

  it("erster Abschnitt mit gleichem Label gilt", () => {
    expect(parseFormSections("### JA\n\n1\n\n### JA\n\n2").get("JA")).toBe("1");
  });
});

describe("Template und Workflow", () => {
  const template = read("../.github/ISSUE_TEMPLATE/rangliste.yml");
  const workflow = read("../.github/workflows/standings.yml");

  it("Template Labels und ids passen zum Parser", () => {
    const labels = [...template.matchAll(/^\s+label: (.+)$/gm)].map((m) => m[1]!.trim());
    expect(labels).toEqual(Object.values(FIELD_LABELS));
    const ids = [...template.matchAll(/^\s+id: (.+)$/gm)].map((m) => m[1]!.trim());
    expect(ids).toEqual(["season", "type", "week", ...PLAYER_IDS.map((p) => p.toLowerCase())]);
    expect(template).toMatch(/- Regular \(2\)\n\s+- Postseason \(3\)\n\s+default: 0/);
    expect(template).toMatch(/labels:\s*\n\s*- rangliste/);
    expect(template).toContain('value: "2026"');
  });

  it("Template enthält nur die Kürzel aus data/standings.json", () => {
    expect([...PLAYER_IDS].sort()).toEqual(standings.players.map((p) => p.id).sort());
  });

  it("Workflow setzt Body und Titel nie per Ausdruck ein und prüft den Owner", () => {
    expect(workflow).not.toMatch(/github\.event\.issue\.(body|title)/);
    expect(workflow).toContain("github.event.issue.author_association == 'OWNER'");
    expect(workflow).toContain("github.event.sender.login == github.repository_owner");
    expect(workflow).toContain('gh api "repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER" --jq .state');
    expect(workflow).toContain("contains(github.event.issue.labels.*.name, 'rangliste')");
    expect(workflow).toContain("ISSUE_NUMBER: ${{ github.event.issue.number }}");
    expect(workflow).toMatch(/issues: write/);
    expect(workflow).toMatch(/contents: write/);
  });
});

describe("Owner Prüfung", () => {
  const event = (assoc: string, labels: unknown[] = [{ name: "rangliste" }], sender = "Laiken96") => ({
    action: "opened",
    sender: { login: sender },
    repository: { owner: { login: "Laiken96" } },
    issue: { number: 7, state: "open", body: body(W9), author_association: assoc, labels },
  });

  it("nur OWNER mit Label rangliste", () => {
    expect(authorizedReport(issueInfo(event("OWNER"))!)).toBeNull();
    for (const a of ["COLLABORATOR", "MEMBER", "CONTRIBUTOR", "NONE", "owner"]) {
      expect(authorizedReport(issueInfo(event(a))!)).toContain("nicht der Repo Owner");
    }
    expect(authorizedReport(issueInfo(event("OWNER", [{ name: "bug" }]))!)).toContain("Label rangliste fehlt");
    expect(authorizedReport(issueInfo(event("OWNER", ["rangliste"]))!)).toBeNull();
    expect(authorizedReport(issueInfo(event("OWNER", undefined, "fremd"))!)).toContain("Auslöser fremd ist nicht der Repo Owner");
    const { sender: _s, ...noSender } = event("OWNER");
    expect(authorizedReport(issueInfo(noSender)!)).toContain("Auslöser unbekannt");
  });

  it("Event ohne Issue", () => {
    expect(issueInfo({})).toBeNull();
    expect(issueInfo(null)).toBeNull();
    expect(issueInfo({ issue: { body: null } })?.body).toBe("");
  });
});

describe("applyReport", () => {
  const report = (v: Values = W9) => {
    const r = parseReportBody(body(v));
    if (!r.ok) throw new Error(r.errors.join());
    return r.report;
  };

  it("übernimmt Punkte, asOfWeek, updatedAt, me bleibt JA", () => {
    const r = applyReport(report(), standings, history, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.standings).toMatchObject({ asOfWeek: 9, updatedAt: NOW, me: "JA" });
    expect(r.standings.players[0]).toEqual({ id: "MS", points: 79 });
    expect(r.history.entries).toHaveLength(2);
    expect(r.history.entries[1]).toMatchObject({ season: 2026, week: 9, reportedAt: NOW });
  });

  it("sortiert nach Punkten absteigend", () => {
    const r = applyReport(report({ ...W9, JA: "90" }), standings, history, NOW);
    expect(r.ok && r.standings.players.map((p) => p.id)).toEqual(["JA", "MS", "LM", "DH", "CZ"]);
  });

  it("frühere Woche bleibt abgelehnt mit Hinweis zur Korrektur", () => {
    const r = applyReport(report({ ...W9, week: "7" }), standings, history, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toBe("Week 7 liegt vor der zuletzt gemeldeten Week 8. Korrekturen gehen nur für die letzte Woche: Week 8 nochmals mit allen Werten melden");
  });

  it("gleiche Woche ersetzt den letzten Eintrag, Prüfung gegen den Eintrag davor", () => {
    const first = applyReport(report(), standings, history, NOW);
    if (!first.ok) throw new Error();
    // Korrektur von Week 9 darf unter dem falschen Wert liegen, nicht aber unter Week 8.
    const fix = applyReport(report({ ...W9, MS: "72" }), first.standings, first.history, "2026-11-04T08:00:00Z");
    expect(fix.ok && fix.replaced).toBe(true);
    if (!fix.ok) return;
    expect(fix.history.entries.map((e) => e.week)).toEqual([8, 9]);
    expect(fix.history.entries[1]).toMatchObject({ reportedAt: "2026-11-04T08:00:00Z" });
    expect(fix.standings.players.find((p) => p.id === "MS")?.points).toBe(72);
    const bad = applyReport(report({ ...W9, MS: "70" }), first.standings, first.history, NOW);
    expect(bad.ok).toBe(false);
  });

  it("Tippfehler wird korrigiert, 450 scheitert schon an der Obergrenze", () => {
    expect(parseReportBody(body({ ...W9, JA: "450" })).ok).toBe(false);
    const typo = applyReport(report({ ...W9, JA: "154" }), standings, history, NOW);
    if (!typo.ok) throw new Error();
    // Week 10 mit echtem Wert scheitert am Tippfehler, der Hinweis nennt die Korrektur.
    const w10 = applyReport(report({ ...W9, week: "10", JA: "60" }), typo.standings, typo.history, NOW);
    expect(w10.ok).toBe(false);
    if (!w10.ok) expect(w10.errors[0]).toBe("JA: 60 Punkte ist weniger als 154 in Week 9. Ist Week 9 falsch, zuerst Week 9 nochmals korrekt melden");
    const fixed = applyReport(report({ ...W9, JA: "54" }), typo.standings, typo.history, NOW);
    expect(fixed.ok).toBe(true);
    if (!fixed.ok) return;
    expect(fixed.history.entries.at(-1)?.players.find((p) => p.id === "JA")?.points).toBe(54);
    expect(applyReport(report({ ...W9, week: "10", JA: "60" }), fixed.standings, fixed.history, NOW).ok).toBe(true);
  });

  it("identische Meldung ist Erfolg ohne Änderung", () => {
    const first = applyReport(report(), standings, history, NOW);
    if (!first.ok) throw new Error();
    const again = applyReport(report(), first.standings, first.history, "2026-11-05T00:00:00Z");
    expect(again).toMatchObject({ ok: true, unchanged: true });
    if (again.ok) expect(again.history).toBe(first.history);
  });

  it("Postseason folgt auf Regular Season, Regular danach ist früher", () => {
    const post = applyReport(report({ ...W9, seasonType: "Postseason (3)", week: "1" }), standings, history, NOW);
    expect(post.ok).toBe(true);
    if (!post.ok) return;
    expect(post.history.entries.at(-1)).toMatchObject({ seasonType: 3, week: 1 });
    const reg = applyReport(report({ ...W9, week: "18" }), post.standings, post.history, NOW);
    expect(reg.ok).toBe(false);
    if (!reg.ok) expect(reg.errors[0]).toContain("liegt vor der zuletzt gemeldeten Postseason Week 1");
  });

  it("Punkte nie kleiner als in der Vorwoche", () => {
    const r = applyReport(report({ ...W9, CZ: "50", JA: "45" }), standings, history, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(["CZ: 50 Punkte ist weniger als 51 in Week 8. Ist Week 8 falsch, zuerst Week 8 nochmals korrekt melden"]);
  });

  it("neue Saison beginnt ohne Vergleich, ältere Saison wird abgelehnt", () => {
    expect(applyReport(report({ ...W9, season: "2027", week: "1", JA: "0", MS: "0" }), standings, history, NOW).ok).toBe(true);
    expect(applyReport(report({ ...W9, season: "2025", week: "18" }), standings, history, NOW).ok).toBe(false);
  });

  it("Kürzel müssen zu standings.json passen", () => {
    const other = { ...standings, players: [...standings.players.slice(0, 4), { id: "XY", points: 1 }] };
    const r = applyReport(report(), other, history, NOW);
    expect(r.ok).toBe(false);
  });

  it("groupWeekRows: genau week minus 1 im selben Saisontyp, Week 1 Regular ab 0", () => {
    const r = applyReport(report(), standings, history, NOW);
    if (!r.ok) throw new Error();
    expect(groupWeekRows(r.history, 2026, 2, 9)?.map((x) => [x.id, x.week, x.total])).toEqual([
      ["MS", 8, 79],
      ["LM", 7, 76],
      ["DH", 7, 75],
      ["CZ", 6, 57],
      ["JA", 9, 54],
    ]);
    expect(groupWeekRows(r.history, 2026, 2, 8)?.[0]).toEqual({ id: "MS", total: 71, week: null });
    expect(groupWeekRows(r.history, 2026, 2, 10)).toBeNull();
    expect(groupWeekRows(r.history, 2026, 3, 9)).toBeNull();
    const gap = applyReport(report({ ...W9, week: "11" }), r.standings, r.history, NOW);
    if (!gap.ok) throw new Error();
    expect(groupWeekRows(gap.history, 2026, 2, 11)?.[0]?.week).toBeNull();
    const one = { schemaVersion: 1 as const, entries: [{ season: 2027, seasonType: 2, week: 1, reportedAt: NOW, players: [{ id: "JA", points: 9 }] }] };
    expect(groupWeekRows(one, 2027, 2, 1)).toEqual([{ id: "JA", total: 9, week: 9 }]);
    expect(groupWeekRows({ ...one, entries: [{ ...one.entries[0]!, seasonType: 3 }] }, 2027, 3, 1)?.[0]?.week).toBeNull();
  });

  it("alte Einträge ohne seasonType gelten als Regular Season", () => {
    const old = StandingsHistorySchema.parse({ schemaVersion: 1, entries: [{ season: 2026, week: 8, reportedAt: NOW, players: [] }] });
    expect(old.entries[0]?.seasonType).toBe(2);
  });
});

describe("parseSeasonType", () => {
  it("Dropdown Werte, leer ist Regular, Unsinn abgelehnt", () => {
    expect(parseSeasonType("Regular (2)")).toBe(2);
    expect(parseSeasonType(" Postseason (3) ")).toBe(3);
    expect(parseSeasonType("3")).toBe(3);
    expect(parseSeasonType("_No response_")).toBe(2);
    expect(parseSeasonType(undefined)).toBe(2);
    expect(parseSeasonType("Preseason (1)")).toBeNull();
    expect(parseSeasonType("Regular (3)")).toBeNull();
    expect(parseReportBody(body({ ...W9, seasonType: "Pro Bowl" })).ok).toBe(false);
  });
});

describe("standings main", () => {
  let dir: string;
  let errors: string[];
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nfl-standings-"));
    await writeFile(join(dir, "standings.json"), standingsText);
    await writeFile(join(dir, "standings-history.json"), historyText);
    errors = [];
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const run = async (issue: Record<string, unknown>) => {
    const eventPath = join(dir, "event.json");
    const commentFile = join(dir, "comment.md");
    await writeFile(
      eventPath,
      JSON.stringify({ action: "opened", sender: { login: "Laiken96" }, repository: { owner: { login: "Laiken96" } }, issue }),
    );
    const code = await main([], {
      dataDir: dir,
      now: () => NOW,
      env: { GITHUB_EVENT_PATH: eventPath, COMMENT_FILE: commentFile },
      log: () => {},
      error: (m) => errors.push(m),
    });
    const comment = await readFile(commentFile, "utf8").catch(() => null);
    return { code, comment };
  };
  const files = async () => [await readFile(join(dir, "standings.json"), "utf8"), await readFile(join(dir, "standings-history.json"), "utf8")];
  const ownerIssue = (b: string) => ({ number: 3, state: "open", body: b, author_association: "OWNER", labels: [{ name: "rangliste" }] });

  it("Owner Meldung wird übernommen und kommentiert", async () => {
    const { code, comment } = await run(ownerIssue(body(W9)));
    expect(code).toBe(0);
    expect(comment).toContain("Rangliste 2026 Week 9 übernommen: MS 79, LM 76, DH 75, CZ 57, JA 54");
    const [s, h] = await files();
    expect(StandingsFileSchema.parse(JSON.parse(s!))).toMatchObject({ asOfWeek: 9, me: "JA", updatedAt: NOW });
    expect(StandingsHistorySchema.parse(JSON.parse(h!)).entries).toHaveLength(2);
  });

  it("identische Meldung: Exit 0, Dateien unverändert, kein Fehlerkommentar", async () => {
    await run(ownerIssue(body(W9)));
    const before = await files();
    const { code, comment } = await run(ownerIssue(body(W9)));
    expect(code).toBe(0);
    expect(comment).toBe("Rangliste 2026 Week 9 ist schon so übernommen, keine Änderung.\n");
    expect(await files()).toEqual(before);
  });

  it("Korrektur derselben Woche wird als korrigiert kommentiert", async () => {
    await run(ownerIssue(body({ ...W9, JA: "154" })));
    const { code, comment } = await run(ownerIssue(body(W9)));
    expect(code).toBe(0);
    expect(comment).toContain("Rangliste 2026 Week 9 korrigiert");
  });

  it("fremder Autor: Exit 1, nichts geschrieben, kein Kommentar", async () => {
    const { code, comment } = await run({ ...ownerIssue(body(W9)), author_association: "NONE" });
    expect(code).toBe(1);
    expect(comment).toBeNull();
    expect(await files()).toEqual([standingsText, historyText]);
    expect(errors[0]).toContain("nicht der Repo Owner");
  });

  it("kaputte Eingabe: Exit 1, Kommentar mit Grund, Dateien unverändert", async () => {
    const { code, comment } = await run(ownerIssue(body({ ...W9, JA: "_No response_" })));
    expect(code).toBe(1);
    expect(comment).toContain("Issue bleibt offen");
    expect(comment).toContain("dieselbe Woche nochmals mit allen Werten meldet");
    expect(comment).toContain("JA: keine gültige Zahl (leer)");
    expect(await files()).toEqual([standingsText, historyText]);
  });

  it("schrumpfende Punkte: Kommentar mit Grund", async () => {
    const { code, comment } = await run(ownerIssue(body({ ...W9, MS: "70" })));
    expect(code).toBe(1);
    expect(comment).toContain("MS: 70 Punkte ist weniger als 71 in Week 8");
  });

  it("ohne Event Datei oder mit Argument: Exit 1", async () => {
    expect(await main([], { dataDir: dir, env: {}, error: (m) => errors.push(m) })).toBe(1);
    expect(await main(["--x"], { dataDir: dir, env: { GITHUB_EVENT_PATH: "x" }, error: (m) => errors.push(m) })).toBe(1);
  });
});
