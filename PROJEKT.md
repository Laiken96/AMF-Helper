# NFL Dashboard

Angelegt: 2026-11-02
Status: Kickoff (Gate 1 offen, Annahmen ungeprüft)

## Problem

Für ein Tippspiel unter Freunden (Sieger pro Spiel plus Tiebreaker Resultat) werden die Tipps heute in einem Chat Loop erstellt und mit geplanten Checks vor Tippschluss nachgeführt. Quoten, Ausfälle, eigene Bilanz und die Tipps der Gruppe liegen verstreut, es gibt keine gespeicherte Historie, und ob die bewussten Abweichungen von der Masse Punkte bringen, ist nicht messbar.

## Nutzer

- 1 Hauptnutzer (Entwickler selbst), tippt manuell auf einer externen Tippseite
- Situation: Donnerstag Tippliste der Woche, Sonntag 17:40 und 21:00 kurzer Check der Ausfälle mit wenigen Minuten bis Tippschluss, meist am Handy
- Später optional Freunde aus der Tippgruppe mit Lesezugriff
- Annahme, ungeprüft (siehe DECISIONS.md D007)

## Definition of Done

Für eine komplette Regular Season Woche zeigt die Web App am Donnerstag für jedes Spiel einen Tipp mit Siegwahrscheinlichkeit aus Quoten, markierte Abweichungs Kandidaten und einen Tiebreaker Vorschlag, meldet vor jedem Tippschluss geänderte Ausfälle der Startspieler, und zeigt am Dienstag danach die eigene Bilanz der Woche im Vergleich zur Gruppe.

## Nicht im Scope

- Echtgeld Wetten, Wettschein Verwaltung oder Anbindung an Buchmacher
- Automatisches Eintragen der Tipps auf der Tippseite (Tipps setzt der Nutzer selbst)
- Eigene Tippspiel Plattform für die Freunde
- Native App (nur Web App, am Handy als PWA)
- Fantasy Football, Spielerprojektionen
- Video, Highlights, Streams, News Volltexte
- Andere Ligen in Version 1

## Datenklasse

keine

Begründung: öffentliche Sportdaten plus Tipps der Freunde ohne Namen (Kürzel). Werden Namen der Freunde gespeichert oder kommt Login dazu, wechselt die Datenklasse auf personendaten und der Datenschutz Check ist vor Gate 2 fällig.

## Release Blocker

- Quellen nur über Adapter mit Schema Validierung und gemeinsamem Server Cache
- Alle Zeiten in UTC gespeichert, Anzeige Europe/Zurich, Test über den Wechsel US Sommerzeit
- Tipps werden bei Kickoff gesperrt und sind danach nicht mehr änderbar
- Keine API Keys im Repository
- Supabase Migrationen versioniert unter supabase/migrations
