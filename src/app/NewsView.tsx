import { useEffect, useMemo, useState } from "react";
import type { NewsFile } from "../core/extra-schema";
import type { Team, TeamsFile, WeekFile } from "../core/schema";
import type { TipsFile } from "../core/tips-schema";
import { formatKickoffZurich } from "../core/time";
import { loadNews, loadTipsData } from "./data";
import { useNow } from "./GameHero";
import { PageHeader, Segmented, fallbackTeam, fetchedFormat } from "./ui";

type NewsItem = NewsFile["items"][number];

export const SOURCE_NAME: Record<NewsItem["source"], string> = { espn: "ESPN", cbs: "CBS Sports", pft: "PFT" };

/** "vor 12 min", "vor 3 h", ältere mit Datum. */
export function ageText(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} min`;
  if (min < 24 * 60) return `vor ${Math.floor(min / 60)} h`;
  return formatKickoffZurich(iso);
}

/** Teams der aktuellen Woche mit offenem Tipp. Ohne Tippdatei alle Teams mit Kickoff in der Zukunft. */
export function myTeamIds(week: WeekFile | null, tips: TipsFile | null, now: number): Set<string> {
  const ids = new Set<string>();
  if (!week) return ids;
  for (const g of week.games) {
    if (Date.parse(g.kickoffUtc) <= now) continue;
    if (g.status === "canceled" || g.status === "postponed") continue;
    if (tips) {
      const t = tips.tips.find((x) => x.gameId === g.id);
      if (!t || t.locked || t.level === "nicht_erfasst") continue;
    }
    ids.add(g.homeId);
    ids.add(g.awayId);
  }
  return ids;
}

interface NewsData {
  news: NewsFile | null;
  teams: TeamsFile | null;
  week: WeekFile | null;
  tips: TipsFile | null;
}

type Filter = { kind: "alle" } | { kind: "meine" } | { kind: "team"; id: string };

export function NewsView() {
  const [data, setData] = useState<NewsData | null>(null);
  const now = useNow();

  useEffect(() => {
    let active = true;
    // Die Wochendaten sind nur für den Filter Meine Spiele nötig, Fehler dort blockieren die News nie
    void (async () => {
      const tipsData = await loadTipsData().catch(() => null);
      const news = tipsData ? tipsData.news : await loadNews();
      if (!active) return;
      setData({ news, teams: tipsData?.teams ?? null, week: tipsData?.week ?? null, tips: tipsData?.tips ?? null });
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!data) return <p className="notice">News werden geladen …</p>;
  if (!data.news || data.news.items.length === 0) {
    return (
      <>
        <PageHeader kicker="News" title="Schlagzeilen" />
        <p className="notice">Noch keine News vorhanden. Sie erscheinen nach dem nächsten Datenlauf.</p>
      </>
    );
  }
  return <NewsList data={data} news={data.news} now={now} />;
}

function NewsList({ data, news, now }: { data: NewsData; news: NewsFile; now: number }) {
  const [filter, setFilter] = useState<Filter>({ kind: "alle" });
  const teamById = useMemo(() => new Map((data.teams?.teams ?? []).map((t) => [t.id, t])), [data.teams]);
  const team = (id: string): Team => teamById.get(id) ?? fallbackTeam(id);
  const mine = useMemo(() => myTeamIds(data.week, data.tips, now), [data.week, data.tips, now]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const item of news.items) for (const id of item.teamIds) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [news]);
  const teamOptions = [...counts.keys()].map(team).sort((a, b) => a.abbr.localeCompare(b.abbr));
  const mineItems = news.items.filter((i) => i.teamIds.some((id) => mine.has(id)));

  const visible =
    filter.kind === "alle"
      ? news.items
      : filter.kind === "meine"
        ? mineItems
        : news.items.filter((i) => i.teamIds.includes(filter.id));

  return (
    <>
      <PageHeader
        kicker="News"
        title="Schlagzeilen"
        meta={`ESPN, CBS Sports und PFT · Stand ${fetchedFormat.format(new Date(news.updatedAt))}`}
      />
      <div className="news-controls">
        <Segmented
          label="News filtern"
          value={filter.kind === "team" ? "team" : filter.kind}
          onChange={(v) => v !== "team" && setFilter({ kind: v })}
          options={[
            { value: "alle", label: `Alle ${news.items.length}` },
            { value: "meine", label: `Meine Spiele ${mineItems.length}` },
          ]}
        />
        {teamOptions.length > 0 && (
          <label className="week-picker news-team">
            Team
            <select
              value={filter.kind === "team" ? filter.id : ""}
              onChange={(e) => setFilter(e.target.value ? { kind: "team", id: e.target.value } : { kind: "alle" })}
            >
              <option value="">Alle Teams</option>
              {teamOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.abbr} {t.shortName} ({counts.get(t.id)})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {filter.kind === "meine" && mine.size === 0 && (
        <p className="notice">Diese Woche gibt es keine Spiele mit offenem Tipp.</p>
      )}
      {visible.length === 0 && !(filter.kind === "meine" && mine.size === 0) && (
        <p className="notice">Keine News für diese Auswahl.</p>
      )}
      <ul className="news-list">
        {visible.map((item) => (
          <li key={item.id} className="news-item">
            <a className="news-link" href={item.url} target="_blank" rel="noopener noreferrer">
              <span className="news-meta">
                {SOURCE_NAME[item.source]} · {ageText(item.publishedAt, now)}
              </span>
              <span className="news-title">{item.title}</span>
              {item.summary && <span className="news-summary">{item.summary}</span>}
              <span className="sr-only"> (öffnet in neuem Tab)</span>
            </a>
            {item.teamIds.length > 0 && (
              <div className="news-teams">
                {item.teamIds.map((id) => {
                  const t = team(id);
                  const active = filter.kind === "team" && filter.id === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={active ? "chip active" : "chip"}
                      aria-pressed={active}
                      aria-label={`Nur News zu ${t.name}`}
                      onClick={() => setFilter(active ? { kind: "alle" } : { kind: "team", id })}
                    >
                      {t.abbr}
                    </button>
                  );
                })}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
