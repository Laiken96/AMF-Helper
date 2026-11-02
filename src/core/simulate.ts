// Simulation der Chance auf Platz 1 (D050): Monte Carlo der restlichen Regular Season. Reine Funktion ohne IO,
// im Browser nutzbar, mit eigenem PRNG für reproduzierbare Ergebnisse.
// Modell: pro Spiel gewinnt der Favorit mit seiner Wahrscheinlichkeit. Gegner geben mit ihrer beobachteten
// Tippquote (pickRate) überhaupt einen Tipp ab und tippen dann mit ihrer Streuquote (upsetRate) den Aussenseiter,
// sonst den Favoriten. Die Streuquote gilt im Mittel der Woche, verteilt nach der Siegchance des Aussenseiters:
// knappe Spiele bekommen öfter einen Aussenseiter Tipp als klare, sichere Favoriten nie. Ohne Streuung hätten alle Gegner pro Woche dieselben Treffer, ein Rückstand liesse sich ohne
// eigene Abweichung nie aufholen und die Simulation würde Abweichungen systematisch bevorzugen.
// Der eigene Spieler tippt als Grundtipp immer den Favoriten (D027) und pro Woche k mal den Aussenseiter, und zwar
// in den knappsten Spielen. Alle k laufen auf denselben Zufallszahlen, damit die Unterschiede zwischen k nicht vom
// Zufall stammen.

/** Kleiner PRNG mulberry32, Ergebnis in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export interface SimPlayer {
  id: string;
  points: number; // aktueller Stand
  pickRate?: number; // Anteil abgegebener Tipps, 0 bis 1, Standard 1
  /** Anteil der abgegebenen Tipps auf den Aussenseiter, 0 bis 1, Standard DEFAULT_UPSET_RATE. Gilt nur für Gegner. */
  upsetRate?: number;
}

/**
 * Standard Streuquote der Gegner: Anteil der Tipps gegen den Favoriten pro Spiel. Annahme in der Grössenordnung
 * von Auswertungen öffentlicher Pick'em Runden (rund 12 bis 15 Prozent der Tipps gegen den Favoriten nach Spread).
 * Mit eigenen Daten (Rangliste gegen Favoritentreffer) lässt sich der Wert pro Spieler ersetzen.
 */
export const DEFAULT_UPSET_RATE = 0.13;
/** Obergrenze der Aussenseiter Wahrscheinlichkeit pro Spiel, ein Münzwurf Spiel tippt ein Gegner höchstens halb halb. */
const MAX_UPSET_PICK = 0.5;

export interface SimInput {
  players: readonly SimPlayer[];
  me: string;
  /** Verbleibende Wochen inklusive der Wochen mit bekannten Quoten. */
  remainingWeeks: number;
  /** Bekannte Wochen am Anfang der Restsaison: Siegwahrscheinlichkeit des Favoriten pro Spiel (ab 0.5). */
  knownWeeks?: ReadonlyArray<readonly number[]>;
  /** Typische Favoritenwahrscheinlichkeiten aus den bisherigen Wochen für Wochen ohne Quote. */
  probPool?: readonly number[];
  /** Spiele pro Woche ohne Quote, Standard Mittel der bekannten Wochen oder 16. */
  gamesPerWeek?: number;
  /** Zu prüfende Abweichungen pro Woche, Standard 0 bis 3. */
  ks?: readonly number[];
  runs?: number; // Standard 5000
  seed?: number; // Standard 1
}

export interface SimResult {
  k: number;
  winChance: number; // Anteil Platz 1, geteilter Platz 1 zählt anteilig
  meanPoints: number; // mittlerer eigener Endstand
}

export interface SimOutput {
  runs: number;
  results: SimResult[];
}

/** Ersatzverteilung, wenn noch keine Woche mit Quote vorliegt. Grob eine typische NFL Woche. */
export const DEFAULT_PROB_POOL = [0.52, 0.55, 0.58, 0.6, 0.62, 0.65, 0.67, 0.7, 0.72, 0.75, 0.78, 0.8, 0.83, 0.86, 0.9];

/** Beobachtete Tippquote aus abgegebenen Tipps und möglichen Spielen, begrenzt auf 0 bis 1. */
export function observedPickRate(tipped: number, possible: number): number {
  if (possible <= 0) return 1;
  return Math.min(1, Math.max(0, tipped / possible));
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const favProb = (p: number) => Math.min(1, Math.max(0.5, Math.max(p, 1 - p)));

export function simulateFirstPlace(input: SimInput): SimOutput {
  const runs = Math.max(1, Math.floor(input.runs ?? 5000));
  const ks = [...(input.ks ?? [0, 1, 2, 3])];
  const rand = mulberry32(input.seed ?? 1);
  const meIdx = input.players.findIndex((p) => p.id === input.me);
  if (meIdx < 0) throw new Error(`Kürzel ${input.me} fehlt in der Simulation`);
  const n = input.players.length;
  const start = input.players.map((p) => p.points);
  const rates = input.players.map((p) => clamp01(p.pickRate ?? 1));
  const upsets = input.players.map((p) => clamp01(p.upsetRate ?? DEFAULT_UPSET_RATE));
  const remaining = Math.max(0, Math.floor(input.remainingWeeks));
  const known = (input.knownWeeks ?? []).slice(0, remaining).map((w) => [...w].map(favProb).sort((a, b) => a - b));
  const pool = (input.probPool && input.probPool.length > 0 ? input.probPool : DEFAULT_PROB_POOL).map(favProb);
  const knownMean = known.length > 0 ? Math.round(known.reduce((s, w) => s + w.length, 0) / known.length) : 16;
  const perWeek = Math.max(1, Math.floor(input.gamesPerWeek ?? knownMean));
  const maxK = Math.max(0, ...ks);

  const wins = new Float64Array(ks.length);
  const mySum = new Float64Array(ks.length);
  const totals = new Float64Array(n);
  const myByK = new Float64Array(ks.length);
  const week = new Float64Array(Math.max(perWeek, ...known.map((w) => w.length), 1));
  const favWon = new Uint8Array(week.length);
  const tipped = new Uint8Array(week.length);
  const dogWeight = new Float64Array(week.length);
  const delta = new Float64Array(maxK + 1);

  for (let run = 0; run < runs; run++) {
    for (let i = 0; i < n; i++) totals[i] = start[i]!;
    myByK.fill(start[meIdx]!);
    for (let w = 0; w < remaining; w++) {
      // Wahrscheinlichkeiten der Woche, aufsteigend, damit die knappsten Spiele vorne liegen.
      let len: number;
      const kw = known[w];
      if (kw) {
        len = kw.length;
        for (let g = 0; g < len; g++) week[g] = kw[g]!;
      } else {
        len = perWeek;
        for (let g = 0; g < len; g++) week[g] = pool[Math.floor(rand() * pool.length)]!;
        week.subarray(0, len).sort();
      }
      let favWins = 0;
      for (let g = 0; g < len; g++) {
        const won = rand() < week[g]! ? 1 : 0;
        favWon[g] = won;
        favWins += won;
      }
      // Gewicht für Aussenseiter Tipps: proportional zur Siegchance des Aussenseiters, im Wochenmittel 1.
      let dogSum = 0;
      for (let g = 0; g < len; g++) dogSum += 1 - week[g]!;
      const dogMean = dogSum / len;
      for (let g = 0; g < len; g++) dogWeight[g] = dogMean > 0 ? (1 - week[g]!) / dogMean : 0;
      // Gegner: Tipp mit Tippquote, davon mit Streuquote auf den Aussenseiter, sonst auf den Favoriten.
      for (let i = 0; i < n; i++) {
        if (i === meIdx) continue;
        const r = rates[i]!;
        const u = upsets[i]!;
        if (r >= 1 && u <= 0) {
          totals[i]! += favWins;
          continue;
        }
        let pts = 0;
        for (let g = 0; g < len; g++) {
          if (r < 1 && rand() >= r) continue;
          const onFav = u <= 0 || rand() >= Math.min(MAX_UPSET_PICK, u * dogWeight[g]!);
          if (onFav === (favWon[g] === 1)) pts++;
        }
        totals[i]! += pts;
      }
      // Eigener Spieler: für k Abweichungen den Effekt in den k knappsten Spielen aufsummieren.
      const myRate = rates[meIdx]!;
      for (let g = 0; g < len; g++) tipped[g] = myRate >= 1 || rand() < myRate ? 1 : 0;
      let base = 0;
      for (let g = 0; g < len; g++) if (tipped[g] && favWon[g]) base++;
      delta[0] = 0;
      for (let j = 0; j < Math.min(maxK, len); j++) {
        const d = tipped[j] ? (favWon[j] ? -1 : 1) : 0;
        delta[j + 1] = delta[j]! + d;
      }
      for (let j = Math.min(maxK, len) + 1; j <= maxK; j++) delta[j] = delta[j - 1]!;
      for (let x = 0; x < ks.length; x++) myByK[x]! += base + delta[Math.max(0, ks[x]!)]!;
    }
    let best = -Infinity;
    for (let i = 0; i < n; i++) if (i !== meIdx && totals[i]! > best) best = totals[i]!;
    let tiedAtBest = 0;
    for (let i = 0; i < n; i++) if (i !== meIdx && totals[i] === best) tiedAtBest++;
    for (let x = 0; x < ks.length; x++) {
      const mine = myByK[x]!;
      mySum[x]! += mine;
      if (n === 1 || mine > best) wins[x]! += 1;
      else if (mine === best) wins[x]! += 1 / (tiedAtBest + 1);
    }
  }
  return {
    runs,
    results: ks.map((k, x) => ({
      k,
      winChance: Math.round((wins[x]! / runs) * 10_000) / 10_000,
      meanPoints: Math.round((mySum[x]! / runs) * 100) / 100,
    })),
  };
}
