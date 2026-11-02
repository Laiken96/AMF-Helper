# NFL Dashboard

## Harte Regeln

1. Nach jedem Sprintschritt: commit und push, CLAUDE.md aktualisieren, DECISIONS.md ergänzen, REGRESSION.md ergänzen, Kontext leeren.
2. Kein neues Feature, solange die Definition of Done in PROJEKT.md offen ist.
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

Sprint 2 gebaut am 2026-11-02: Tippliste aus ESPN Quoten (D024), Abweichungen nach D026, Tiebreaker TNF und MNF (D025), Sperre ab Kickoff, Ansicht Tipps als Startseite. 103 Tests grün. Rangliste in data/standings.json wird bis Sprint 4 manuell gepflegt, nur Kürzel.

## Befehle

- npm run dev: lokaler Server
- npm run typecheck, npm test, npm run build: Prüfungen vor jedem Commit
- npm run job:schedule [-- --season 2026 --type 2 --week 9]: Spielplan holen
- npm run job:tips [-- --season 2026 --type 2 --week 9]: Tippliste rechnen, ohne Argumente Woche aus data/current.json
- vite preview braucht dasselbe BASE_PATH wie der Build

## Nächster Schritt

Sprint 3: Web Push mit Onboarding und Ausfall Wächter laut PLAN.md. Push muss vor Thanksgiving 26.11. laufen.
