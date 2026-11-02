# NFL Dashboard

## Harte Regeln

1. Nach jedem Sprintschritt: commit und push, CLAUDE.md aktualisieren, DECISIONS.md ergänzen, REGRESSION.md ergänzen, Kontext leeren.
2. Kein neues Feature, solange die Definition of Done in PROJEKT.md offen ist. Seit D042 gilt sie als erreicht, die Abnahme erfolgt am Projektende.
3. Keine Änderung am Datenformat unter data/ ohne Anpassung von schema_version und zod Schema.
4. Keine Secrets im Browser Code. Schreibzugriff nur über GitHub Actions.
5. Bei Widerspruch zwischen Auftrag und DECISIONS.md: anhalten und nachfragen, nicht selbst entscheiden.

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

Sprint D (Redesign Stil A) gebaut am 2026-11-02: Layouts compact, side, medium, wide nach Breite und rechtem Safe Area Inset (D035 bis D039), Spielbereich in Teamfarben, Navigation als Kapsel, Schriften selbst gehostet unter public/fonts. Ab Kickoff gilt ein Spiel in der App als gesperrt, auch vor dem Tippjob. 215 Tests grün. Offen: Test am echten iPhone Duo (R57 bis R60), Abnahme Week 9.

## Befehle

- npm run dev: lokaler Server
- npm run typecheck, npm test, npm run build: Prüfungen vor jedem Commit
- npm run job:schedule [-- --season 2026 --type 2 --week 9]: Spielplan holen
- npm run job:review: Wochenbilanz rechnen
- npm run job:standings: Ranglisten Meldung aus Issue Event verarbeiten (nur im Workflow)
- npm run job:watch, npm run job:push: Ausfall Wächter und Push Versand (Versand nur auf main mit Secrets)
- npm run job:tips [-- --season 2026 --type 2 --week 9]: Tippliste rechnen, ohne Argumente Woche aus data/current.json
- vite preview braucht dasselbe BASE_PATH wie der Build
- Layout Tests: ?inset=84 und ?insetBottom=34 simulieren Safe Area Insets

## Nächster Schritt

Sprints laut PLAN.md (D042): Wochen blättern und Liveticker (Frontend), News und KI Zweitmeinung (Daten), danach Gesamtabnahme.
