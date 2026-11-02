# Umsetzungsplan NFL Dashboard

Rolle Master Control: plant, verteilt Sprints an Agenten, prüft Ergebnisse gegen DECISIONS.md und gibt Gates frei. Agenten bauen, Master Control reviewt.

## Agentenrollen

| Agent | Aufgabe | Liefert |
|---|---|---|
| Recherche | Datenquellen, Limits, Schemas prüfen | Quellenbericht (erledigt, siehe D002) |
| Architekt (Plan) | Struktur, DB Schema, Sprintschnitt | Architekturbericht (erledigt, siehe D001, D003) |
| Frontend | Next.js Seiten, Polling Hooks, Mobile Layout | UI Komponenten |
| Daten | ESPN Adapter mit zod, Cache, API Routes, RSS Import | lib/espn, lib/cache, app/api |
| Modell | Elo, Backtest, Quoten Mischung (Python) | jobs/elo, Backtest Report |
| QA | Fehlerfälle, Regressionsliste, Sonntagstest | REGRESSION.md Einträge |
| Review | unabhängiger Code Review pro Sprint ohne Vorwissen des Bauers | Findings Liste |

Parallelisierbar: Daten und Modell laufen ab Sprint 2 unabhängig voneinander. Frontend hängt am Datenmodell der API Routes.

## Architektur

```
Browser (Next.js, SWR Polling)
   │
   ▼
Vercel API Routes ──► api_cache (Supabase) ──► ESPN JSON API
   │                                         └► API-Sports (Fallback)
   ▼
Supabase Postgres (teams, games, news_items, predictions, prediction_results)
   ▲
GitHub Actions (Python): RSS alle 30 min, Elo jeden Dienstag, Odds Snapshot, Supabase Ping
```

## Sprints

| Nr | Inhalt | Agenten | Abnahme (überprüfbar) |
|---|---|---|---|
| 1 | Gerüst: Next.js, Vercel, Supabase EU, Migration 0001, Teams, Spielplan der Woche | Daten, Frontend | Öffentliche URL zeigt alle Spiele der Woche mit korrekter Zürcher Zeit |
| 2 | Live Scoreboard: Adapter, Cache, Polling nach Spielplan | Daten, Frontend, QA | Sonntag: Rückstand max 30 s auf ESPN, max 4 ESPN Requests pro Minute im Log |
| 3 | Game Detail: Drives, Play by Play, Ballbesitz | Frontend, Daten | Laufendes Spiel Play für Play verfolgbar, fertige Spiele aus der DB |
| 4 | News: RSS Import ESPN, CBS, PFT, Dedup, Teamfilter | Daten | 3 Quellen, 0 Duplikate, Update alle 30 min nachweisbar |
| 5 | Elo MVP plus Backtest, Tipps sperren | Modell, QA | Backtest Brier unter 0.25, jedes Spiel der Woche hat gesperrten Tipp |
| 6 | Tracking und Quoten: prediction_results, Statistikseite, Elo vs Mischung | Modell, Frontend | Dienstag erscheinen Brier und Trefferquote der Woche automatisch |
| 7 | Optional nach Gate 3: Claude Begründungen, Magic Link Login für Freunde | Daten, Frontend | Freund sieht Tipps mit Begründung, LLM Kosten pro Woche geloggt |

Definition of Done ist nach Sprint 6 erreicht. Sprint 7 ist ein neues Feature und läuft erst nach Gate 3.

## Gates

- Gate 1 vor Sprint 1: Nutzer bestätigt PROJEKT.md (Problem, DoD, Nicht im Scope). Offen
- Gate 2 vor erstem Freund als Nutzer: BETRIEB.md, Backup, Rollback, Datenschutz falls Login
- Gate 3 vor Sprint 7 und jedem weiteren Feature

## Risiken

- ESPN API inoffiziell: Schemabruch oder Sperre. Gegenmittel Adapter mit Validierung, letzte gültige Daten anzeigen, Fallback API-Sports
- Supabase Free pausiert nach 7 Tagen ohne Aktivität: Ping Job
- Zeitzonen und Wochenzuordnung: D006
- Saisontiming: Regular Season läuft bis Anfang Januar 2027. Sprint 2 muss an einem echten Sonntag abgenommen werden, sonst wartet die Abnahme bis September 2027
