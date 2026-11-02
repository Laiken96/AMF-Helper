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

Sprint 3 gebaut am 2026-11-02: PWA mit Onboarding und Einstellungen, Push Versand über GitHub Actions alle 10 Minuten (D029, D031), Ausfall Wächter mit Grundstand ab Donnerstag (D030). 148 Tests grün. Abnahme am Handy offen: Secrets VAPID_PRIVATE_KEY und PUSH_SUBSCRIPTION.

## Befehle

- npm run dev: lokaler Server
- npm run typecheck, npm test, npm run build: Prüfungen vor jedem Commit
- npm run job:schedule [-- --season 2026 --type 2 --week 9]: Spielplan holen
- npm run job:watch, npm run job:push: Ausfall Wächter und Push Versand (Versand nur auf main mit Secrets)
- npm run job:tips [-- --season 2026 --type 2 --week 9]: Tippliste rechnen, ohne Argumente Woche aus data/current.json
- vite preview braucht dasselbe BASE_PATH wie der Build

## Nächster Schritt

Sprint 4: Gruppentipps per Issue Formular (D018), Wochenbilanz und Ranglistenstand automatisch, Push "Bilanz bereit".
