// Saisonauswertung in der Bilanz (D050): App gegen reinen Favoritentipp, Abweichungen netto gegen Erwartung,
// Trefferquote je Wahrscheinlichkeitsband, Brier Score und Tiebreaker. Ohne Gruppentabelle und ohne Simulation
// (D058). Die eigene, auf dem Gerät gespeicherte Wahl fliesst in alle Werte ein (D057).
import { useMemo, type ReactNode } from "react";
import { PROB_BANDS, buildSeasonSummary, fpiPickProbLookup, type SeasonSummary } from "../core/season";
import { useKeptLoad } from "./data";
import { useLayoutValue } from "./layout";
import { applySeasonChoices, useChoicesFor, usePlayer } from "./player";
import { loadSeasonData, seasonWeekHref, type SeasonData } from "./season-data";
import { LoadErrorNotice, PageHeader, weekLabel, PageSplitMark } from "./ui";

/** Ab so vielen gewerteten Spielen gelten Saisonzahlen als aussagekräftig. */
export const MIN_SEASON_GAMES = 40;
/** Ab so vielen gewerteten Abweichungen lässt sich Glück von Strategie trennen. */
export const MIN_DEVIATIONS = 10;
/** Ab so vielen Spielen pro Band ist die Trefferquote eines Bands lesbar. */
export const MIN_BAND_GAMES = 10;

const num = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 2 });
const dec3 = new Intl.NumberFormat("de-CH", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const pct = (x: number) => `${Math.round(x * 100)} %`;
const signed = (x: number) => (x > 0 ? `+${num.format(x)}` : num.format(x));

const BAND_LABEL: Record<(typeof PROB_BANDS)[number]["id"], string> = {
  "50-60": "50 bis 60 %",
  "60-70": "60 bis 70 %",
  "70-80": "70 bis 80 %",
  "80+": "ab 80 %",
};

/** Saisondaten mit der eigenen Wahl pro Woche. changed zählt Spiele mit eigener Wahl. */
function useOwnSeason(raw: SeasonData | null, player: string): { data: SeasonData | null; changed: number } {
  const choicesByWeek = useChoicesFor(player, raw?.weeks ?? []);
  return useMemo(() => {
    if (!raw || choicesByWeek.size === 0) return { data: raw, changed: 0 };
    const own = applySeasonChoices(raw.reviews, raw.tips, choicesByWeek);
    if (own.changed === 0) return { data: raw, changed: 0 };
    const summary = buildSeasonSummary({
      season: raw.season,
      reviews: own.reviews,
      tips: own.tips,
      fpiPickProb: raw.fpi.length > 0 ? fpiPickProbLookup(raw.fpi) : undefined,
    });
    return { data: { ...raw, reviews: own.reviews, tips: own.tips, summary }, changed: own.changed };
  }, [raw, choicesByWeek]);
}

export function SeasonView({ toggle }: { toggle: ReactNode }) {
  const { data: raw, error, pending } = useKeptLoad("saison", loadSeasonData);
  const wide = useLayoutValue() === "wide";
  const player = usePlayer(raw?.standings ?? null);
  const { data, changed } = useOwnSeason(raw, player);
  if (error) return <LoadErrorNotice message={error} />;
  if (!data) {
    if (pending) return <p className="notice">Daten werden geladen …</p>;
    return (
      <>
        <PageHeader kicker="Bilanz" title="Saison" />
        {toggle}
        <p className="notice">Noch keine Saisondaten vorhanden.</p>
      </>
    );
  }
  const header = (
    <PageHeader
      kicker="Bilanz"
      title={`Saison ${data.season}`}
      meta={`${data.summary.weeks} ${data.summary.weeks === 1 ? "Woche" : "Wochen"} mit Bilanz · ${data.summary.games} ${data.summary.games === 1 ? "Spiel" : "Spiele"} mit App Tipp gewertet`}
    />
  );
  const metrics = (
    <>
      {changed > 0 && (
        <p className="notice own-note">
          <strong>inkl. deiner Abweichungen.</strong> {changed} {changed === 1 ? "Spiel zählt" : "Spiele zählen"} mit deiner
          eigenen Wahl, gespeichert auf diesem Gerät.
        </p>
      )}
      <SeasonMetrics data={data} />
    </>
  );
  const list = <WeekList summary={data.summary} />;
  if (wide) {
    return (
      <div className="duo-split season-split">
        <PageSplitMark />
        <div className="pane pane-metrics" aria-label="Kennzahlen der Saison" role="region">
          {metrics}
        </div>
        <div className="fold" aria-hidden="true" />
        <div className="pane pane-list">
          {header}
          {toggle}
          {list}
        </div>
      </div>
    );
  }
  return (
    <>
      {header}
      {toggle}
      {metrics}
      {list}
    </>
  );
}

function SeasonMetrics({ data }: { data: SeasonData }) {
  const s = data.summary;
  return (
    <>
      {s.games < MIN_SEASON_GAMES && (
        <p className="notice notice-pending">
          <strong>Noch wenig Daten.</strong> Bisher {s.games} {s.games === 1 ? "Spiel" : "Spiele"} mit App Tipp
          gewertet. Die Saisonzahlen sind erst ab {MIN_SEASON_GAMES} Spielen aussagekräftig.
        </p>
      )}
      <div className="tiles">
        <section className="box" aria-label="App gegen Favoritentipp">
          <h2>App gegen Favorit</h2>
          <p className="big-number">
            {s.appPoints} <span className="of">von {s.games}</span>
          </p>
          <p className="box-meta">
            Nur Favoriten getippt: {s.favoritePoints}. Differenz {signed(s.appMinusFavorite)}
          </p>
        </section>
        <DeviationBox summary={s} />
      </div>
      <BandSection summary={s} />
      <BrierSection summary={s} />
      <section className="slot">
        <h2>Tiebreaker</h2>
        <p className="season-text">
          {s.tiebreaker.meanDiff === null
            ? "Noch kein Tiebreaker ausgewertet."
            : `Im Mittel ${num.format(s.tiebreaker.meanDiff)} Punkte daneben (Summe beider Teams, ${s.tiebreaker.count} ${s.tiebreaker.count === 1 ? "Spiel" : "Spiele"}).`}
        </p>
      </section>
    </>
  );
}

/** Abweichungen: Ergebnis gegen Erwartung aus den Quoten, damit Glück und Strategie getrennt lesbar sind. */
function DeviationBox({ summary: s }: { summary: SeasonSummary }) {
  const d = s.deviations;
  return (
    <section className="box" aria-label="Abweichungen der Saison">
      <h2>Abweichungen</h2>
      {d.count === 0 ? (
        <p>Noch keine Abweichung getippt.</p>
      ) : (
        <>
          <p className="box-big">{signed(d.net)}</p>
          <p className="box-meta">
            {d.scored} von {d.count} gewertet, {d.hits} Treffer
          </p>
          {d.expectedNet !== null && d.luck !== null && (
            <p className="box-meta">
              {`Erwartet laut Quoten ${signed(d.expectedNet)}, eine Abweichung kostet im Mittel Punkte. Der Rest (${signed(d.luck)}) ist ${d.luck >= 0 ? "Glück" : "Pech"}.`}
            </p>
          )}
          {d.scored < MIN_DEVIATIONS && (
            <p className="box-meta">Erst ab {MIN_DEVIATIONS} gewerteten Abweichungen aussagekräftig.</p>
          )}
        </>
      )}
    </section>
  );
}

function BandSection({ summary: s }: { summary: SeasonSummary }) {
  const rows = s.bands;
  const total = rows.reduce((a, r) => a + r.games, 0);
  return (
    <section className="slot">
      <h2>Favoriten nach Siegchance</h2>
      {total === 0 ? (
        <p className="season-text">Noch kein Spiel mit Quote entschieden.</p>
      ) : (
        <>
          <ul className="band-list">
            {rows.map((r) => (
              <li key={r.band} className="band-row">
                <span className="band-name">{BAND_LABEL[r.band]}</span>
                <span className="band-bar" aria-hidden="true">
                  {r.hitRate !== null && <span className="band-fill" style={{ width: `${r.hitRate * 100}%` }} />}
                  {r.expectedRate !== null && <span className="band-mark" style={{ left: `${r.expectedRate * 100}%` }} />}
                </span>
                <span className="band-text">
                  {r.games === 0 || r.hitRate === null || r.expectedRate === null
                    ? "keine Spiele"
                    : `${pct(r.hitRate)} statt ${pct(r.expectedRate)}, ${r.games} ${r.games === 1 ? "Spiel" : "Spiele"}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="push-hint">
            Balken: wie oft der Favorit gewann. Strich: wie oft er laut Quote gewinnen sollte. Pro Band erst ab{" "}
            {MIN_BAND_GAMES} Spielen aussagekräftig.
          </p>
        </>
      )}
    </section>
  );
}

function BrierSection({ summary: s }: { summary: SeasonSummary }) {
  const b = s.brier;
  const items: { name: string; value: number; n: number; note?: string }[] = [];
  if (b.market.value !== null) items.push({ name: "Markt (Quoten)", value: b.market.value, n: b.market.n });
  if (b.ai.value !== null)
    items.push({
      name: "KI Zweitmeinung",
      value: b.ai.value,
      n: b.ai.n,
      note: b.marketOnOpinions.value !== null ? `Markt auf denselben Spielen ${dec3.format(b.marketOnOpinions.value)}` : undefined,
    });
  if (b.fpi.value !== null)
    items.push({
      name: "ESPN FPI",
      value: b.fpi.value,
      n: b.fpi.n,
      note: b.marketOnFpi.value !== null ? `Markt auf denselben Spielen ${dec3.format(b.marketOnFpi.value)}` : undefined,
    });
  items.sort((x, y) => x.value - y.value);
  return (
    <section className="slot">
      <h2>Besser kalibriert</h2>
      {items.length === 0 ? (
        <p className="season-text">Noch kein Spiel mit Quote entschieden.</p>
      ) : (
        <>
          <ol className="brier-list">
            {items.map((it, i) => (
              <li key={it.name}>
                <span className="brier-name">
                  <span className="brier-rank">{i + 1}.</span> {it.name}
                </span>
                <span className="brier-value">{dec3.format(it.value)}</span>
                <span className="brier-meta">
                  {it.n} {it.n === 1 ? "Spiel" : "Spiele"}
                  {it.note ? `, ${it.note}` : ""}
                </span>
              </li>
            ))}
          </ol>
          <p className="push-hint">
            Brier Score: kleiner ist besser, 0.250 entspricht einem Münzwurf. Erst ab {MIN_SEASON_GAMES} Spielen pro
            Quelle aussagekräftig.
          </p>
        </>
      )}
    </section>
  );
}

function WeekList({ summary }: { summary: SeasonSummary }) {
  if (summary.weekRows.length === 0) return <p className="notice notice-pending">Noch keine Woche mit Bilanz.</p>;
  const rows = [...summary.weekRows].reverse();
  return (
    <section className="slot">
      <h2>Wochen</h2>
      <table className="group-table season-weeks">
        <thead>
          <tr>
            <th scope="col">Woche</th>
            <th scope="col">App</th>
            <th scope="col">Favorit</th>
            <th scope="col">Netto</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ref = { season: summary.season, seasonType: r.seasonType, week: r.week };
            return (
              <tr key={`${r.seasonType}-${r.week}`}>
                <th scope="row">
                  <a href={seasonWeekHref(ref)}>{weekLabel(ref)}</a>
                  {!r.complete && <span className="season-open"> offen</span>}
                </th>
                <td>{r.appPoints}</td>
                <td>{r.favoritePoints}</td>
                <td>{signed(r.deviationNet)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="push-hint">App: richtige App Tipps. Favorit: Punkte, wenn nur Favoriten getippt wären.</p>
    </section>
  );
}
