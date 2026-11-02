# Sprint 4 Wochenbilanz und Rangliste

## Ziel
DoD Punkt 5: Nach einer Woche zeigt die App die eigene Bilanz, Tiebreaker Abweichung, Wirkung der Abweichungen und die Wochenpunkte der Gruppe, mit Push "Bilanz bereit".

## Kontext
CLAUDE.md, DECISIONS.md: D022, D023, D025, D028, D029, D032. Datenvertrag fix in src/core/review-schema.ts, bestehend tips-schema.ts.

## Umfang
### Daten Agent
- jobs/build-review.ts: für jede Woche mit Tippdatei, deren Review fehlt oder nicht complete ist, Spielstände aus der Wochendatei lesen (die Woche per ESPN nachladen, falls sie nicht mehr current ist, gleiche Adapter Funktion), Review berechnen und data/reviews/<pfad>.json schreiben. Reine Logik in src/core/review.ts
- Regeln: correct = pickTeamId gleich winnerTeamId. Unentschieden zählt als falsch. deviationEffect nur bei deviation: +1 wenn Aussenseiter gewann, -1 wenn Favorit gewann. diff = |predHome minus actHome| + |predAway minus actAway|
- data.yml: build-review nach build-tips, gleiche Fehlerlogik
- .github/ISSUE_TEMPLATE/rangliste.yml: Formular "Rangliste melden" mit Feldern Saison (Default 2026), Woche, und je einer Zahl für MS, LM, DH, CZ, JA (Kürzel aus data/standings.json, im Template fest), Label rangliste
- .github/workflows/standings.yml: on issues opened und edited mit Label rangliste. Nur wenn github.event.issue.author_association == OWNER. Body nur über die Event Datei (GITHUB_EVENT_PATH) in Node lesen, nie per Ausdruck in run einsetzen. Parsen, mit zod prüfen (Punkte nie kleiner als in der Vorwoche, Woche grösser als letzte), standings.json und standings-history.json schreiben, committen mit pull rebase und Retry, Issue kommentieren und schliessen (GITHUB_TOKEN, permissions issues write, contents write). Bei Fehler Kommentar mit Grund, Issue bleibt offen. Danach Pages neu bauen wie in data.yml
- push: Meldung "Bilanz bereit" pro Woche, sobald review complete und nicht im push-log. Text: App Punkte x von y, Abweichungen netto, Tiebreaker Abweichung, Hinweis "Rangliste melden"
- Tests für alle Regeln, Parser des Issue Bodys (inklusive kaputter Eingaben und fremder Autoren), Push Fälligkeit

### Frontend Agent
- Neuer Reiter "Bilanz" (#bilanz): neueste Review Datei laut Liste (data/reviews/index.json, schreibt der Daten Agent, Format: Array von Pfaden absteigend) mit Wochenwahl
- Inhalt: App Punkte x von y, Trefferquote, Abweichungen mit Wirkung pro Spiel, Tiebreaker vorhergesagt gegen tatsächlich mit Abweichung, Wochenpunkte der Gruppe aus standings-history (Differenz zur Vorwoche, falls die Woche gemeldet ist, sonst Hinweis "Rangliste für Week N noch nicht gemeldet" mit Link zum Issue Formular https://github.com/Laiken96/AMF-Helper/issues/new?template=rangliste.yml), Saisonverlauf der Gruppe als einfache Tabelle
- Nicht finale Woche: Zwischenstand mit Hinweis

NICHT anfassen: Tipp Logik, Push Transport, Onboarding.

## Abnahmekriterien
- typecheck, test, build grün
- Tests: Bilanz Regeln, Unentschieden, offene Spiele, Wochenwechsel, Issue Parser, Owner Prüfung, Push Bilanz einmal
- Playwright 390 px Bilanz Ansicht mit Week 8 Review, Leerzustand
- Abnahme Nutzer: Rangliste Week 9 per Formular melden, Bilanz Week 9 erscheint am Dienstag mit Push

## Abschluss
1. git commit und push
2. CLAUDE.md aktualisieren
3. Neue Entscheide in DECISIONS.md nachtragen
4. Neue Testschritte in REGRESSION.md nachtragen
5. Kontext leeren
