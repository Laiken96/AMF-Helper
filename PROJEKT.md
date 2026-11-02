# NFL Dashboard

Angelegt: 2026-11-02
Status: Kickoff (Gate 1 offen, Annahmen ungeprüft)

## Problem

Spielinfos, News, Live Stände und eigene Prognosen zur NFL sind heute auf mehrere Apps, Webseiten und einen manuellen Chat Loop verteilt. Die Tipps entstehen ohne gespeicherte Historie, deshalb ist nicht messbar, ob sie besser sind als Zufall oder der Markt.

## Nutzer

- 1 Hauptnutzer (Entwickler selbst), Situation: Sonntagabend und Nacht europäische Zeit am Laptop oder Handy, unter der Woche kurzer Blick auf News und Tipps der kommenden Woche
- Später optional bis 5 Freunde mit Lesezugriff
- Annahme, ungeprüft (siehe DECISIONS.md D007)

## Definition of Done

Während eines kompletten NFL Spieltags zeigt die öffentlich erreichbare Web App für jedes Spiel der Woche einen vor Kickoff gesperrten Tipp mit Siegwahrscheinlichkeit, live Scores mit höchstens 30 Sekunden Rückstand auf ESPN, mindestens 3 News Quellen ohne Duplikate, und am Dienstag danach erscheinen Trefferquote und Brier Score der Woche automatisch.

## Nicht im Scope

- Echtgeld Wetten, Wettschein Verwaltung oder Anbindung an Buchmacher
- Push Notifications und native App (nur Web App, auf dem Handy als PWA nutzbar)
- Fantasy Football, Spielerprojektionen, Draft Tools
- Video, Highlights, Streams
- Volltexte von News Artikeln (nur Titel, Anriss, Link)
- Andere Ligen (College, CFL, AMF/ELF) in Version 1
- Kommentare, Chat oder Tippspiel zwischen Freunden

## Datenklasse

keine

Begründung: Version 1 speichert nur öffentliche Sportdaten. Kommt in Sprint 7 Login für Freunde dazu (E Mail Adresse), wechselt die Datenklasse auf personendaten und der Datenschutz Check ist vor Gate 2 fällig.

## Release Blocker

- ESPN Zugriff nur über Adapter mit Schema Validierung und gemeinsamem Server Cache (kein direkter Client Zugriff auf ESPN)
- Alle Zeiten in UTC gespeichert, Anzeige Europe/Zurich, Test über den Wechsel US Sommerzeit
- Tipps werden vor Kickoff gesperrt und sind danach nicht mehr änderbar
- Keine API Keys im Repository, alle Keys als Environment Variablen
- Supabase Migrationen versioniert unter supabase/migrations
