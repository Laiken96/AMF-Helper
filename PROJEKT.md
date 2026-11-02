# NFL Dashboard

Angelegt: 2026-11-02
Status: Sprint 3 gebaut am 2026-11-02, Push Abnahme am Handy offen

## Problem

Für ein Tippspiel unter Freunden (Sieger pro Spiel plus Tiebreaker Resultat) werden die Tipps heute in einem Chat Loop erstellt und mit geplanten Checks vor Tippschluss nachgeführt. Quoten, Ausfälle, eigene Bilanz und die Tipps der Gruppe liegen verstreut, es gibt keine gespeicherte Historie, und ob die bewussten Abweichungen von der Masse Punkte bringen, ist nicht messbar.

## Nutzer

- 1 Hauptnutzer (Entwickler selbst), tippt manuell auf einer externen Tippseite
- Situation: Donnerstag Tippliste der Woche, Sonntag 17:40 und 21:00 kurzer Check der Ausfälle mit wenigen Minuten bis Tippschluss, meist am Handy
- Später optional Freunde aus der Tippgruppe mit Lesezugriff
- Anforderungen vom Nutzer selbst bestätigt am 2026-11-02 (D007 damit geprüft), Tippgruppe 5 Personen inklusive Nutzer

## Definition of Done

Das Projekt ist fertig, wenn in einer kompletten Regular Season Woche (Donnerstag bis Dienstag) alle sechs Punkte erfüllt sind. Prüfung durch den Nutzer an einer echten Spielwoche, Ergebnis wird in REGRESSION.md festgehalten.

1. Onboarding: Beim ersten Start erklärt die App, dass Erinnerungen per Web Push kommen, dass dies am iPhone nur nach "Zum Home Bildschirm" funktioniert, fragt die Erlaubnis ab und sendet eine Testnachricht. Der Push Status ist jederzeit in den Einstellungen sichtbar und neu auslösbar.
2. Tippliste: Donnerstag bis 19:00 steht für jedes Spiel der Woche ein Tipp mit Siegwahrscheinlichkeit aus den Quoten, der Lage (klar, Favorit, unklar), markierten Abweichungs Kandidaten und einem Resultatvorschlag für das Tiebreaker Spiel. Dazu kommt ein Push "Tippliste bereit".
3. Ausfall Wächter: Spätestens 20 Minuten vor jedem Tippschluss (Kickoff Slot) kommt ein Push mit geänderten Ausfällen von Quarterback und Startspielern seit Donnerstag oder mit "keine Änderung". Ändert sich dadurch ein Tipp, ist das in der Tippliste markiert.
4. Sperre: Jeder Tipp ist ab Tippschluss gesperrt (pro Kickoff, verifiziert D023) und danach nicht mehr änderbar.
5. Bilanz: Dienstag zeigt die App die eigenen Punkte der Woche, die Abweichung beim Tiebreaker Resultat, die Punkte der Gruppe (nach Erfassung der Gruppentipps, die erst nach Tippschluss sichtbar sind) und für jede Abweichung, ob sie gegenüber dem Favoriten Tipp einen Punkt gebracht oder gekostet hat. Dazu kommt ein Push "Bilanz bereit".
6. Zeiten: Alle Zeiten in App und Push stimmen mit Europe/Zurich überein, geprüft an einer Woche mit Sonntagnacht und Montagnacht Spiel.

## Nicht im Scope

- Echtgeld Wetten, Wettschein Verwaltung oder Anbindung an Buchmacher
- Automatisches Eintragen der Tipps auf der Tippseite (Tipps setzt der Nutzer selbst)
- Eigene Tippspiel Plattform für die Freunde
- Native App (nur Web App, am Handy als PWA mit Web Push)
- Fantasy Football, Spielerprojektionen
- Video, Highlights, Streams, News Volltexte
- Andere Ligen in Version 1

## Datenklasse

keine

Begründung: öffentliche Sportdaten, Tipps der Freunde unter Kürzel, eine Push Subscription des eigenen Geräts als GitHub Secret. Achtung: Ist das Repo öffentlich, sind auch data/ und die Gruppentipps öffentlich. Werden Namen der Freunde gespeichert oder kommt Login dazu, wechselt die Datenklasse auf personendaten und der Datenschutz Check ist vor Gate 2 fällig.

## Release Blocker

- Quellen nur über Adapter mit Schema Validierung, bei Fehler letzte gültige Daten anzeigen
- Alle Zeiten in UTC gespeichert, Anzeige Europe/Zurich, Test über den Wechsel US Sommerzeit
- Tipps werden bei Kickoff gesperrt und sind danach nicht mehr änderbar
- Keine API Keys im Repository
- Datenformat der JSON Dateien unter data/ versioniert (Feld schema_version) und per zod validiert
