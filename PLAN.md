# Umsetzungsplan NFL Dashboard

Rolle Master Control: plant, verteilt Sprints an Agenten, prüft Ergebnisse gegen DECISIONS.md und gibt Gates frei. Agenten bauen, Master Control reviewt.

## Agentenrollen

| Agent | Aufgabe | Liefert |
|---|---|---|
| Recherche | Datenquellen, Limits, Schemas prüfen | Quellenbericht (erledigt, siehe D002) |
| Architekt (Plan) | Struktur, DB Schema, Sprintschnitt | Architekturbericht (erledigt, siehe D001, D003) |
| Frontend | Next.js Seiten, Polling Hooks, Mobile Layout | UI Komponenten |
| Daten | ESPN Adapter mit zod, Cache, API Routes, RSS Import | lib/espn, lib/cache, app/api |
| Modell | Quoten Umrechnung, Abweichungslogik, Elo Backtest (Python) | jobs/, Backtest Report |
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
GitHub Actions (Python): Odds Do und So, Injuries vor Tippschluss, Bilanz Dienstag, RSS, Supabase Ping
```

## Sprints

Reihenfolge nach D008: zuerst ersetzt die App den Chat Loop, danach kommen Liveticker und News.

| Nr | Inhalt | Agenten | Abnahme (überprüfbar) |
|---|---|---|---|
| 1 | Gerüst: Next.js, Vercel, Supabase EU, Migration 0001, Teams, Spielplan der Woche | Daten, Frontend | Öffentliche URL zeigt alle Spiele der Woche mit korrekter Zürcher Zeit |
| 2 | Tippliste: Quoten Import, Siegwahrscheinlichkeit, Tipp, Lage (klar, Favorit, unklar), Tiebreaker Vorschlag, Sperre bei Kickoff | Daten, Modell, Frontend | Donnerstag 19:00 steht für jedes Spiel ein Tipp mit Prozentwert, Ansicht gleich wie die Tabelle aus dem Chat Loop |
| 3 | Web Push und Ausfall Wächter: PWA, Onboarding mit Push Erklärung und Testnachricht, Injuries und Inactives je Spiel, Push 20 min vor jedem Tippschluss | Daten, Frontend, QA | DoD Punkte 1 und 3 an einem echten Sonntag erfüllt |
| 4 | Gruppe und Bilanz: Gruppentipps erfassen, Abweichungs Kandidaten nach D010, Wochenbilanz eigene Tipps vs Gruppe | Modell, Frontend | Dienstag zeigt die App Punkte der Woche für dich und die Gruppe |
| 5 | Liveticker: Scoreboard mit Polling nach Spielplan, Game Detail mit Play by Play | Daten, Frontend, QA | Sonntag: Rückstand max 30 s auf ESPN, max 4 ESPN Requests pro Minute |
| 6 | News: RSS ESPN, CBS, PFT, Dedup, Teamfilter | Daten | 3 Quellen, 0 Duplikate, Update alle 30 min |
| 7 | Optional nach Gate 3: Elo Backtest, Kalibrierung der Schwelle aus D010, Begründungen per Claude | Modell | Backtest Report mit Brier Score Quoten vs Elo vs Mischung |

Definition of Done ist nach Sprint 4 erreicht. Sprint 5 und 6 erfüllen den ursprünglichen Wunsch (Liveticker, News) und laufen nach Gate 3.

## Gates

- Gate 1 vor Sprint 1: Nutzer bestätigt PROJEKT.md (Problem, DoD, Nicht im Scope). Offen
- Gate 2 vor erstem Freund als Nutzer: BETRIEB.md, Backup, Rollback, Datenschutz falls Login
- Gate 3 vor Sprint 5 und jedem weiteren Feature

## Risiken

- ESPN API inoffiziell: Schemabruch oder Sperre. Gegenmittel Adapter mit Validierung, letzte gültige Daten anzeigen, Fallback API-Sports
- Supabase Free pausiert nach 7 Tagen ohne Aktivität: Ping Job
- Zeitzonen und Wochenzuordnung: D006
- Saisontiming: Regular Season endet am 10. Januar 2027. Sprint 2 bis 4 müssen an echten Spielwochen abgenommen werden, sonst wartet die Abnahme bis September 2027
- Benachrichtigung: Web Push (D012). GitHub Actions Cron startet teils verspätet, deshalb Push Job 40 min vor Tippschluss planen, damit er sicher 20 min davor ankommt
