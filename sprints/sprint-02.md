# Sprint 2 Tippliste

## Ziel
Ab Donnerstag 19:00 zeigt die Seite für jedes Spiel der aktuellen Woche einen Tipp mit Siegwahrscheinlichkeit aus der ESPN Quote, Lage, markierten Abweichungen und einen Resultatvorschlag für das Tiebreaker Spiel.

## Kontext
CLAUDE.md, DECISIONS.md: D010, D021, D022, D023, D024, D006. Datenvertrag fix in src/core/tips-schema.ts.

## Regeln
- pHome = Phi(-spreadHome / 13.5), Phi ist die Standardnormalverteilung
- Tipp = Team mit Wahrscheinlichkeit ab 0.5, bei exakt 0.5 das Heimteam
- Lage: klar ab 0.75, favorit 0.60 bis unter 0.75, unklar unter 0.60, offen ohne Quote
- maxDeviations nach D021 aus data/standings.json: Rückstand auf Platz 1 gleich 0 ergibt 0, bis 2 ergibt 1, mehr ergibt 2, ab Week 15 und Rückstand über 2 ergibt 3
- Abweichung: aus den Spielen mit Lage unklar (nicht gesperrt) die mit der kleinsten Favoritenwahrscheinlichkeit, höchstens maxDeviations. Bei Abweichung wird der Aussenseiter getippt
- Tiebreaker Spiel: erstes Spiel der Woche nach Kickoff (Annahme aus dem Chat Loop, ungeprüft). Favorit = (overUnder + |spread|)/2, Aussenseiter = (overUnder minus |spread|)/2, beide gerundet. Ohne Over/Under 23 zu 20 für den Favoriten
- Gesperrte Tipps (Kickoff vorbei) werden nie neu berechnet. firstPickTeamId wird beim ersten Lauf gesetzt und nie überschrieben
- Eingetragen Häkchen pro Spiel nur lokal im Browser (localStorage), Ausfall tolerant

## Umfang
- src/core/espn.ts: Quote aus competitions[0].odds[0] lesen (provider.name, spread, overUnder, homeTeamOdds.favorite) und als spreadHome normieren. Keine Änderung am WeekFile Schema, Quoten gehen über eine eigene Funktion parseOdds
- src/core/tips.ts: reine Funktionen für Wahrscheinlichkeit, Lage, maxDeviations, Abweichungen, Tiebreaker, Zusammenführen mit bestehender Tippdatei (Sperre, Grundtipp)
- jobs/build-tips.ts: liest Scoreboard der aktuellen Woche, bestehende Tippdatei und standings.json, schreibt data/tips/<pfad>.json. Gleiche Schutzregeln wie D019
- data.yml: build-tips nach dem Spielplan Job
- App: Ansicht Tipps als Startseite, Spielplan als zweite Ansicht. Tabelle wie im Chat Loop: Zeit, Tipp fett, Gegner mit (H) für Heimteam, Prozent, Lage, Zielscheibe bei Abweichung, Hinweis bei Änderung seit Grundtipp, Schloss bei gesperrt, Häkchen eingetragen. Oben Tiebreaker Vorschlag und Rangliste mit erlaubten Abweichungen

NICHT anfassen: Push, Ausfälle, Gruppentipps erfassen, Liveticker, News.

## Abnahmekriterien
- typecheck, test, build grün
- Tests: Wahrscheinlichkeit bei Spread 0, -3, -10, Vorzeichen Heim und Auswärts, fehlende Quote, maxDeviations an allen Grenzen, Abweichung wählt richtige Spiele und nie gesperrte, Tiebreaker mit und ohne Over/Under, Sperre verhindert Neuberechnung, Grundtipp bleibt, leere Woche
- Job läuft gegen ESPN Week 9 und erzeugt gültige Datei
- Playwright Screenshot der Tippliste in 390 px ohne Konsolenfehler
- REGRESSION.md um Sprint 2 Schritte ergänzt

## Abschluss
1. git commit und push
2. CLAUDE.md aktualisieren
3. Neue Entscheide in DECISIONS.md nachtragen
4. Neue Testschritte in REGRESSION.md nachtragen
5. Kontext leeren
