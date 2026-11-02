# Sprint 3 Web Push und Ausfall Wächter

## Ziel
DoD Punkte 1 und 3: Onboarding mit Push Erklärung und Testnachricht, und vor jedem Tippschluss Slot kommt ein Push mit Ausfällen und Tippänderungen.

## Kontext
CLAUDE.md, DECISIONS.md: D012, D023, D027, D029, D030. src/core/push-config.ts ist fix.

## Umfang
### App (Frontend Agent)
- PWA: public Manifest (Name "NFL Tipps", start_url und scope relativ zum base Pfad, display standalone, Icons 192 und 512 als PNG, schlicht generiert), Service Worker sw.js (push Ereignis zeigt Notification mit title, body, tag, Klick öffnet bzw. fokussiert die App mit url), Registrierung mit korrektem Scope unter /AMF-Helper/
- Ansicht "Einstellungen" (#einstellungen) und Onboarding beim ersten Start (Flag in localStorage, try catch):
  1. Erklärung: Erinnerungen kommen per Push vor jedem Tippschluss, am Donnerstag kommt die Tippliste
  2. iPhone Erkennung: ohne Standalone Modus Anleitung "Teilen, Zum Home Bildschirm", Push dort erst danach möglich
  3. Knopf "Push erlauben": Notification.requestPermission, pushManager.subscribe mit VAPID_PUBLIC_KEY, lokale Testnachricht über den Service Worker
  4. Anmeldung als JSON mit Kopierknopf und Anleitung: GitHub, Settings, Secrets and variables, Actions, New repository secret, Name PUSH_SUBSCRIPTION. Link auf https://github.com/Laiken96/AMF-Helper/settings/secrets/actions
  5. Status jederzeit sichtbar: Erlaubnis, Anmeldung vorhanden, Service Worker aktiv. Knopf "Testnachricht" und "Neu anmelden"
### Jobs (Push Agent)
- jobs/watch.ts: für die Woche aus data/current.json Summary je Spiel laden, Schlüsselspieler nach D030 mit Status, Grundstand data/injuries/<season>-<type>-<ww>.json beim ersten Lauf ab Donnerstag 00:00 New York setzen, aktuellen Stand und Änderungen berechnen
- jobs/push.ts: entscheidet, ob eine Meldung fällig ist, sendet mit web-push, schreibt data/push-log.json. Meldungen:
  - "Tippliste bereit": sobald für die Woche eine Tippdatei mit Quoten existiert und noch nicht gemeldet. Text: Anzahl Spiele, Abweichungen, beide Tiebreaker
  - "Tippschluss in X min": pro Kickoff Slot, wenn der Kickoff 15 bis 60 Minuten entfernt ist und noch nicht gemeldet. Text: Spiele des Slots, Ausfälle von Schlüsselspielern seit Grundstand, Tipps mit changedSinceFirst, sonst "Keine Änderung"
  - Ohne Secrets: Meldung im Log, Exit 0, damit der Workflow vor der Einrichtung nicht rot ist
  - Abgelaufene Anmeldung (HTTP 404 oder 410): Fehler im Log, Lauf rot
- .github/workflows/push.yml: Cron "3,13,23,33,43,53 * * * *" plus workflow_dispatch, Secrets als env, commit von data/push-log.json und data/injuries, concurrency gemeinsam mit data.yml Gruppe, Pages nicht neu bauen
- Reine Logik in src/core oder jobs Bibliotheken, testbar mit Fixtures (Summary Fixture von ESPN speichern)

NICHT anfassen: Tippberechnung, Gruppentipps, Liveticker, News.

## Abnahmekriterien
- typecheck, test, build grün
- Tests: Slot Fenster Grenzen 15 und 60 Minuten, keine doppelte Meldung, Grundstand nur einmal, Statuswechsel erkannt (Questionable zu Out, neuer Eintrag, Eintrag verschwindet), Tippänderung im Text, fehlende Secrets ergeben Exit 0, 410 ergibt Fehler
- Playwright 390 px: Onboarding erscheint beim ersten Start, Einstellungen zeigen Status, keine Konsolenfehler, Manifest und Service Worker unter /AMF-Helper/ geladen
- Abnahme durch den Nutzer: Push am Handy erhalten (Testnachricht und eine echte Slot Meldung)

## Abschluss
1. git commit und push
2. CLAUDE.md aktualisieren
3. Neue Entscheide in DECISIONS.md nachtragen
4. Neue Testschritte in REGRESSION.md nachtragen
5. Kontext leeren
