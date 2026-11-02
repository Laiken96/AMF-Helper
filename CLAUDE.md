# NFL Dashboard

## Harte Regeln

1. Nach jedem Sprintschritt: commit und push, CLAUDE.md aktualisieren, DECISIONS.md ergänzen, REGRESSION.md ergänzen, Kontext leeren.
2. Kein neues Feature, solange die Definition of Done in PROJEKT.md offen ist. Seit D042 gilt sie als erreicht, die Abnahme erfolgt am Projektende.
3. Keine Änderung am Datenformat unter data/ ohne Anpassung von schema_version und zod Schema.
4. Keine Secrets im Browser Code. Schreibzugriff nur über GitHub Actions.
5. Bei Widerspruch zwischen Auftrag und DECISIONS.md: anhalten und nachfragen, nicht selbst entscheiden.
6. Vor jedem Merge von main: Merge Ergebnis prüfen. Bei Konflikt in data/ gilt der Stand von main (dort schreibt die Automatik). Nie committen, solange Konfliktmarker existieren (git diff --check).
7. Tests lesen nie aus data/, nur aus tests/fixtures/ (data/ ändert die Automatik laufend).

## Ziel

Siehe PROJEKT.md. Entscheide siehe DECISIONS.md. Nicht duplizieren.

## Stack

Vite, React, TypeScript als statische Web App auf GitHub Pages. Datenjobs in TypeScript (tsx) über GitHub Actions. Daten als JSON unter data/. Tests mit vitest. Details D017, D002, D006, D016 in DECISIONS.md, Sprintplan in PLAN.md.

## Projektstruktur

- src/core/ geteilter Code für App und Jobs (Typen, zod Schemas, ESPN Adapter, Zeit und Wochenlogik)
- src/app/ React Oberfläche
- jobs/ Node Skripte für GitHub Actions
- data/ erzeugte JSON Daten, nur von Jobs geschrieben
- tests/ vitest Tests mit Fixtures unter tests/fixtures/
- .github/workflows/ Datenjobs und Pages Deployment

## Aktueller Stand

Ausbau Sprint 5 bis 8 gebaut am 2026-11-02 (D042 bis D044): Wochen blättern, Liveticker im Reiter Spiele, News Reiter, KI Zweitmeinung im Schattenmodus (claude-haiku-5-5, Secret ANTHROPIC_API_KEY, läuft nach dem Push Versand). Externer Auslöser cron-job.org (D041). 279 Tests grün. Offen: echte KI Läufe, Liveticker an echtem Spiel, ESPN RSS in Actions, Gesamtabnahme.

## Befehle

- npm run dev: lokaler Server
- npm run typecheck, npm test, npm run build: Prüfungen vor jedem Commit
- npm run job:schedule [-- --season 2026 --type 2 --week 9]: Spielplan holen
- npm run job:review: Wochenbilanz rechnen
- npm run job:news, job:opinion, job:weeks: News, KI Zweitmeinung (nur mit Key), Wochenindex
- npm run job:standings: Ranglisten Meldung aus Issue Event verarbeiten (nur im Workflow)
- npm run job:watch, npm run job:push: Ausfall Wächter und Push Versand (Versand nur auf main mit Secrets)
- npm run job:tips [-- --season 2026 --type 2 --week 9]: Tippliste rechnen, ohne Argumente Woche aus data/current.json
- vite preview braucht dasselbe BASE_PATH wie der Build
- Layout Tests: ?inset=84 und ?insetBottom=34 simulieren Safe Area Insets

## Nächster Schritt

Gesamtabnahme an einer echten Woche (Sprint 9), danach Post Mortem.
