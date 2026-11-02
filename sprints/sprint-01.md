# Sprint 1 Gerüst und Spielplan

## Ziel
Die öffentliche Vercel URL zeigt alle Spiele der aktuellen NFL Woche mit Teams und korrekter Kickoff Zeit in Europe/Zurich.

## Kontext
Lies CLAUDE.md, PROJEKT.md und DECISIONS.md. Relevant: D001 Stack, D002 Datenquellen, D003 Cache, D006 Zeit und Wochenlogik, D016 Tippschluss als Einstellung.

## Umfang
- Next.js (TypeScript, App Router) Projekt im Repo Root, Deployment auf Vercel
- Supabase Projekt Region Frankfurt, Migration supabase/migrations/0001_init.sql mit Tabellen teams, games, api_cache, settings
- settings enthält den Schlüssel lock_mode mit Wert per_kickoff (Alternative weekly)
- games enthält season, week, season_type, kickoff_utc, home_id, away_id, status, Scores, espn_id
- lib/espn/adapter.ts: holt das ESPN Scoreboard, validiert mit zod, bildet auf das eigene Modell ab. Bei Schemafehler klare Fehlermeldung und letzte gültige Daten aus der DB
- lib/cache.ts: api_cache mit TTL und Single Flight, TTL 30 min ausserhalb von Spielen
- Seed der 32 Teams aus ESPN
- Seite /woche: Spiele der Woche gruppiert nach Kickoff Slot, Zeiten Europe/Zurich, Woche über season und week aus ESPN
- Environment Variablen nur über .env.local und Vercel, .env.example mit Platzhaltern

NICHT anfassen: Quoten, Tipps, Push, Liveticker, News, Login. Keine UI Politur über ein sauberes Grundlayout hinaus.

## Abnahmekriterien
- npm run build grün, npm run lint grün
- Unit Tests grün für: ESPN Adapter mit gespeichertem Beispiel JSON, Adapter mit kaputtem JSON (Fehlerpfad), Zeitumrechnung über den Wechsel US Sommerzeit, Sonntagnachtspiel wird der richtigen Woche zugeordnet
- Datenbank aus Null reproduzierbar: supabase db reset erzeugt alle Tabellen nur aus dem Repo
- Vercel URL zeigt die aktuelle Woche, Zeiten stimmen mit der ESPN App überein (manuell 3 Spiele vergleichen)
- Leerfall: Bye Teams und Wochen ohne Spiel erzeugen keinen Fehler
- REGRESSION.md hat mindestens 5 Testschritte inklusive Fehler und Leerfall

## Abschluss
1. git commit und push
2. CLAUDE.md aktualisieren
3. Neue Entscheide in DECISIONS.md nachtragen
4. Neue Testschritte in REGRESSION.md nachtragen
5. Kontext leeren

## Aufgabe für den Nutzer in diesem Sprint
- Vercel und Supabase Konto bereitstellen, Keys als Environment Variablen setzen
- Auf der Tippseite prüfen, ob Tippschluss pro Kickoff oder pro Woche gilt, Ergebnis in D016 nachtragen
- Anzahl Personen in der Freundesgruppe nennen
