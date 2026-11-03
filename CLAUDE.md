# NFL Dashboard

## Harte Regeln

1. Nach jedem Sprintschritt: commit und push, CLAUDE.md aktualisieren, DECISIONS.md ergänzen, REGRESSION.md ergänzen, Kontext leeren.
2. Kein neues Feature, solange die Definition of Done in PROJEKT.md offen ist. Seit D042 gilt sie als erreicht, die Abnahme erfolgt am Projektende.
3. Keine Änderung am Datenformat unter data/ ohne Anpassung von schema_version und zod Schema.
4. Keine Secrets im Browser Code. Schreibzugriff nur über GitHub Actions.
5. Bei Widerspruch zwischen Auftrag und DECISIONS.md: anhalten und nachfragen, nicht selbst entscheiden.
6. Vor jedem Merge von main: Merge Ergebnis prüfen. Bei Konflikt in data/ gilt der Stand von main (dort schreibt die Automatik). Nie committen, solange Konfliktmarker existieren (git diff --check).
7. Tests lesen nie aus data/, nur aus tests/fixtures/ (data/ ändert die Automatik laufend).
8. Sprache: Jede Antwort an den Nutzer ist auf Deutsch (Schweizer Rechtschreibung, ss statt ß), auch direkt nach englischen System, Hook oder Agentenmeldungen. Keine Semikolons und keine Gedankenstriche. Aufträge an Agenten ebenfalls auf Deutsch, mit der Vorgabe, auf Deutsch zu berichten.
9. Merge nach main (D046): eigene Pull Requests selbst mergen, wenn typecheck, test und build grün und Review und QA bestanden sind, danach Nutzer informieren und Veröffentlichung prüfen. Nachfragen bei Secrets, Kosten, externen Diensten, grösseren Umbauten, Designänderungen, offenen Entscheiden und roten Prüfungen.

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

Stand 2026-11-03 nachts, alles auf main und live unter https://laiken96.github.io/AMF-Helper/
- DoD erreicht (D042), Gesamtabnahme am Projektende. Features: Tipps mit Quoten, Favorit als Vorschlag (D052), Tiebreaker TNF und MNF, Push vor Tippschluss, Ausfall Wächter, Bilanz mit Ranglisten Formular, Wochen blättern, Liveticker, News, KI Zweitmeinung im Schattenmodus (erste echte Meinung CHI@SEA erzeugt, 0.034 USD)
- Design Stil A für iPhone und iPhone Duo (D035 bis D039, D045, D047, D048 Spielauswahl im Spielbereich)
- Automatik: cron-job.org startet push.yml alle 10 Minuten und data.yml stündlich Minute 47 (D041), GitHub Zeitpläne unzuverlässig
- Secrets: VAPID_PRIVATE_KEY, PUSH_SUBSCRIPTION, ANTHROPIC_API_KEY. Token cron-job läuft am 02.11.2027 ab, Erinnerung geplant
- 515 Tests grün. Code Review (D049), Beta Test und Feature Analyse (D050, D051) in drei Wellen umgesetzt: UI Paket, neue Daten (Ausfälle nächste Woche, Linie, FPI, Public Picks, Spielort, Ruhetage), Saisonkalender, Design (Navigation mit Text, Logos, Wischgeste, Hellmodus, Duo quer zweispaltig), Spieler wählbar, Fakten pro Spiel, Bilanz Saison mit Simulation. D052: Ziel möglichst viele Punkte, Vorschlag immer Favorit, Abweichung entscheidet der Nutzer per Knopf. Duo zugeklappt per Bildschirmbreite erkannt (R113), Versuch gegen schwarzen Balken (R115), Diagnose in Einstellungen Technik
- Offen: Liveticker an echtem Spiel (MNF CHI@SEA 2026-11-03 01:15 UTC, echte ESPN Antworten als Fixtures sichern, R105), R104 R113 R115 R116 am Gerät, Gerätetests R97 R101, Gesamtabnahme Week 9 (Do 05.11. bis Di 10.11.), danach Post Mortem
- Arbeitsweise: Entwicklung auf Branch claude/nfl-dashboard-plan-mcwlna, Pull Request nach main (ci.yml muss grün sein), Merge selbst laut Regel 9 (D046). Vor Merge immer main zuerst holen (Regel 6). Agenten pro Stream, danach unabhängiger Review und QA

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
