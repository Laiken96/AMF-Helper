# Sprint 1 Gerüst und Spielplan

## Ziel
Die GitHub Pages URL zeigt alle Spiele der aktuellen NFL Woche mit Teams und korrekter Kickoff Zeit in Europe/Zurich.

## Kontext
Lies CLAUDE.md, PROJEKT.md und DECISIONS.md. Relevant: D017 Stack, D002 Datenquellen, D006 Zeit und Wochenlogik, D016 Tippschluss als Einstellung.

## Umfang
- Vite, React, TypeScript App, Build als statische Seite mit base Pfad für GitHub Pages
- src/core/schema.ts: zod Schemas und Typen für data/ (Datenvertrag, schema_version 1)
- src/core/espn.ts: Adapter ESPN Scoreboard zu eigenem Modell, mit zod validiert
- src/core/time.ts: Umrechnung UTC zu Europe/Zurich, Gruppierung nach Kickoff Slot
- jobs/fetch-schedule.ts: holt Scoreboard und Teams, schreibt data/teams.json, data/weeks/<season>-<type>-<week>.json, data/current.json, data/settings.json (lock_mode per_kickoff). Bei Fehler bleibt der letzte gültige Stand, Exit Code ungleich 0
- .github/workflows/data.yml: Cron und manueller Start, Job ausführen, data/ committen
- .github/workflows/pages.yml: Tests, Build und Deployment auf GitHub Pages bei Push auf main
- Seite Woche: Spiele gruppiert nach Kickoff Slot, Zeiten Europe/Zurich, Stand der Daten sichtbar, Fehler und Leerzustand sauber

NICHT anfassen: Quoten, Tipps, Push, Liveticker, News, PWA.

## Abnahmekriterien
- npm run build, npm run typecheck und npm test grün
- Tests für: Adapter mit echtem ESPN Fixture, Adapter mit kaputtem JSON, Zeitumrechnung über den Wechsel US Sommerzeit, Sonntagnachtspiel bleibt in seiner NFL Woche, Woche mit Bye Teams, leere Woche
- npm run job:schedule erzeugt gültige Dateien unter data/, die das App Schema besteht
- GitHub Pages URL zeigt die aktuelle Woche, Zeiten stimmen mit der ESPN App überein (manuell 3 Spiele vergleichen)
- REGRESSION.md hat mindestens 5 Testschritte inklusive Fehler und Leerfall

## Abschluss
1. git commit und push
2. CLAUDE.md aktualisieren
3. Neue Entscheide in DECISIONS.md nachtragen
4. Neue Testschritte in REGRESSION.md nachtragen
5. Kontext leeren

## Aufgabe für den Nutzer
- Sichtbarkeit des Repos klären (Pages im Gratis Tarif nur bei öffentlichem Repo)
- Pages in den Repo Einstellungen auf "GitHub Actions" stellen und auf main mergen
- Tippschluss auf der Tippseite prüfen (D016), Grösse der Freundesgruppe nennen
