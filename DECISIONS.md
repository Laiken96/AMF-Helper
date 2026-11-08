# Entscheide NFL Dashboard

Jeder Entscheid vier Zeilen. Neue Einträge unten anhängen, alte nie löschen. Diese Datei ist die Referenz, gegen die Pläne aus Claude Code geprüft werden.

---

## D001 Stack

- Datum: 2026-11-02
- Entscheid: Next.js (TypeScript, App Router) auf Vercel Hobby, Supabase Postgres Region Frankfurt, Batch Jobs in Python (nflreadpy) über GitHub Actions
- Begründung: 0 CHF Betriebskosten, kein eigener Server, Daten in der EU, Next.js und Supabase sind mit Claude Code sehr zuverlässig, Python bleibt dort, wo nflverse und das Modell stark sind
- Verworfen: SvelteKit plus FastAPI plus SQLite auf Hetzner (Serverpflege, Backups, TLS selbst). Kein Vorprojekt Stack vorhanden, da Repo leer

## D002 Datenquellen

- Datum: 2026-11-02
- Entscheid: Live, Spielplan, Injuries über ESPN inoffizielle JSON API (site.api.espn.com scoreboard und summary). News über RSS von ESPN, CBS, PFT. Historie und Modelldaten über nflverse. Quoten über The Odds API Free Tier
- Begründung: alles gratis, ESPN liefert Play by Play nahezu live ohne Key, nflverse ist frei lizenziert und bringt historische Lines mit. Erreichbarkeit am 2026-11-02 per curl geprüft
- Verworfen: SportsDataIO Trial (Werte verfälscht, 10 min Verzögerung), BALLDONTLIE (Live nur kostenpflichtig), Scraping NFL.com (ToS). Fallback Live: API-Sports Free (100 Requests pro Tag)

## D003 Live Update Strategie

- Datum: 2026-11-02
- Entscheid: Client Polling plus gemeinsamer Server Cache (Tabelle api_cache mit Single Flight Lock). TTL 15 s bei laufendem Spiel, 60 s ab 30 min vor Kickoff, 30 min ohne Spiel. Polling pausiert in Hintergrund Tabs
- Begründung: SSE auf Serverless stösst an Funktionslimits, Vercel Hobby Cron nur täglich. Last auf ESPN bleibt unabhängig von der Nutzerzahl
- Verworfen: SSE und WebSockets. Späterer Ausweg bei Bedarf: Cloudflare Worker Cron als Poller

## D004 Tipp Engine

- Datum: 2026-11-02
- Entscheid: Stufe 1 Elo (K 20, Heimvorteil 48, Margin Multiplikator, ein Drittel Regression zum Mittelwert pro Saison). Stufe 2 Mischung mit margenbereinigten Quoten. Stufe 3 logistische Regression mit EPA. Messung über Walk Forward Backtest 2012 bis 2025 und Brier Score
- Begründung: Elo ist in einem Sprint baubar und transparent. Baseline "immer Heimteam" liegt bei Brier 0.25, Ziel unter 0.23
- Verworfen: reine LLM Tipps ohne Modell (nicht messbar, nicht reproduzierbar)

## D005 LLM Begründungen

- Datum: 2026-11-02
- Entscheid: Claude Haiku erzeugt pro Spiel einmal einen Begründungstext aus den berechneten Kennzahlen, gespeichert in predictions.rationale_md. Das LLM berechnet keine Wahrscheinlichkeiten
- Begründung: Zahlen bleiben reproduzierbar, Text ist Zusatznutzen, Kosten wenige Rappen pro Woche
- Verworfen: LLM als Prognosemodell

## D006 Zeit und Wochenlogik

- Datum: 2026-11-02
- Entscheid: Speicherung in UTC, Anzeige Europe/Zurich. Spielwoche immer über season und week aus der Quelle, nie über das Datum
- Begründung: Sonntagnachtspiele fallen in Europa auf Montag, US und EU Sommerzeit enden an unterschiedlichen Daten
- Verworfen: lokale Zeitstempel in der DB

## D007 Nutzer und Anforderungen

- Datum: 2026-11-02
- Entscheid: Anforderungen stammen aus Proxy Argumentation (Chat Loop des Nutzers), nicht aus Nutzergesprächen. Status: ungeprüft
- Begründung: Hauptnutzer ist der Entwickler selbst. Vor Gate 1 bestätigt der Nutzer Problem, Definition of Done und Nicht im Scope
- Verworfen: nichts

---

## D008 Zweck ist das Tippspiel

- Datum: 2026-11-02
- Entscheid: Kernnutzen ist die Unterstützung des Tippspiels unter Freunden (Sieger pro Spiel, Tiebreaker Resultat, Abweichungen von der Masse). Liveticker und News sind Zusatz
- Begründung: abgeleitet aus dem bestehenden Chat Loop. Dort entsteht der Aufwand, dort fehlt die Messbarkeit
- Verworfen: Dashboard ohne Bezug zum Tippspiel. Ersetzt den Scope Punkt "Tippspiel zwischen Freunden" aus der ersten Fassung von PROJEKT.md

## D009 Quoten vor Elo

- Datum: 2026-11-02
- Entscheid: Primäre Siegwahrscheinlichkeit sind margenbereinigte Quoten (The Odds API). Elo aus D004 dient als Fallback ohne Quote und als Vergleich im Backtest. Ändert die Reihenfolge aus D004
- Begründung: Der Loop tippt fast immer den Quotenfavoriten. Der Markt schlägt einfache Elo Modelle bei Sieger Prognosen zuverlässig
- Verworfen: Elo als Primärquelle

## D010 Abweichungen von der Masse

- Datum: 2026-11-02
- Entscheid: Ein Spiel wird Abweichungs Kandidat, wenn der Favorit unter 60 Prozent liegt und die Gruppe mehrheitlich den Favoriten tippt. Die Begründung (Rest, Kurzwoche, Bilanz) ist Zusatzinfo, nicht Auslöser
- Begründung: Eine Abweichung lohnt sich nur, wenn sie knapp ist und die Gruppe anders tippt. Ohne Gruppentipps ist sie Raten
- Verworfen: Abweichungen nach Bauchgefühl ohne Messung. Schwelle 60 Prozent ungeprüft, wird nach 4 Wochen im Backtest kalibriert

## D011 Gruppentipps

- Datum: 2026-11-02
- Entscheid: Tipps der Freunde werden manuell erfasst (Formular oder Screenshot Upload mit Auswertung), gespeichert unter Kürzel
- Begründung: Die externe Tippseite hat vermutlich keine API. Ungeprüft
- Verworfen: Scraping der Tippseite

## D012 Web Push als Erinnerung

- Datum: 2026-11-02
- Entscheid: Erinnerungen per Web Push (PWA, VAPID Keys als Environment Variablen). Beim ersten Start erklärt ein Onboarding den Push, den nötigen Homescreen Schritt am iPhone, fragt die Erlaubnis ab und sendet eine Testnachricht
- Begründung: Entscheid des Nutzers. Ersetzt die aktiven Meldungen des Chat Loops. Ohne Onboarding scheitert Push am iPhone still
- Verworfen: E Mail, Chat Loop als Erinnerung

## D013 Tippseite

- Datum: 2026-11-02
- Entscheid: Ziel ist das Football Bromance Tippspiel (tippspiel.footballbromance.com). 1 Punkt pro richtigem Sieger, bei Gleichstand entscheidet der Resultattipp im Tiebreaker. Tipps anderer sind erst nach Tippschluss sichtbar. Keine Anbindung an die Seite
- Begründung: Angaben des Nutzers. Die Teilnahmebedingungen (Ziffer 7) erlauben den Ausschluss bei automatisierten Eingaben, deshalb bleibt Tippen strikt manuell
- Verworfen: Scraping oder automatisches Eintragen

## D014 Abweichungen ohne Live Gruppentipps

- Datum: 2026-11-02
- Entscheid: Ergänzt D010. Da Gruppentipps erst nach Tippschluss sichtbar sind, schätzt die App das Gruppenverhalten aus den erfassten Vorwochen (Anteil Favoriten Tipps je Wahrscheinlichkeitsband). Bis 3 Wochen erfasst sind, gilt die Annahme, dass die Gruppe den Favoriten tippt
- Begründung: Angabe des Nutzers zu Frage 3
- Verworfen: Abweichungen ohne jede Gruppenbasis

## D015 Gegner ist die Freundesgruppe

- Datum: 2026-11-02
- Entscheid: Optimiert wird auf die Rangliste gegen die Freunde, nicht auf den Wochensieg im öffentlichen Tippspiel. Pro Woche höchstens 2 Abweichungs Kandidaten, Schwelle aus D010 bleibt
- Begründung: Angabe des Nutzers. In einer kleinen Gruppe kosten viele Abweichungen im Schnitt mehr Punkte als sie bringen
- Verworfen: aggressive Abweichungs Strategie für grosse öffentliche Pools

## D016 Tippschluss pro Kickoff

- Datum: 2026-11-02
- Entscheid: Tippschluss gilt pro Spiel beim Kickoff. Status: ungeprüft. Sperrlogik und Push Planung lesen den Tippschluss aus einer Einstellung (pro Kickoff oder Wochenfrist), damit ein Irrtum ohne Umbau korrigierbar ist
- Begründung: Nutzer vermutet Kickoff, der Chat Loop arbeitet ebenfalls so. Prüfung durch den Nutzer auf der Tippseite bis Ende Sprint 1
- Verworfen: fest einprogrammierter Tippschluss

## D017 Nur GitHub statt Vercel und Supabase

- Datum: 2026-11-02
- Entscheid: Ersetzt D001 Hosting und Datenbank sowie D003 Server Cache. Statische Web App (Vite, React, TypeScript) auf GitHub Pages. Datenjobs in TypeScript (Node) über GitHub Actions. Daten als JSON Dateien im Repo unter data/, jede Änderung ist ein Commit. Liveticker ruft ESPN direkt aus dem Browser ab (CORS am 2026-11-02 geprüft, erlaubt)
- Begründung: Entscheid des Nutzers. 1 Nutzer, winzige Datenmenge, keine zusätzlichen Konten, kein Server, Git Historie ist zugleich Backup. Eine Sprache für App und Jobs, der ESPN Adapter wird geteilt
- Verworfen: Vercel und Supabase (zwei Konten, Supabase pausiert bei Inaktivität). Python Jobs (zweite Sprache, nflverse erst in Sprint 7 nötig). Kommt Login für Freunde, wird das Backend neu entschieden

## D018 Erfassung der Gruppentipps

- Datum: 2026-11-02
- Entscheid: Ergänzt D011. Gruppentipps werden über ein GitHub Issue Formular erfasst, eine Action liest es aus und schreibt die JSON Datei. Kein Token in der Web App
- Begründung: GitHub Pages kann nicht ins Repo schreiben, das Issue Formular funktioniert in der GitHub App am Handy
- Verworfen: persönlicher Token im Browser (Sicherheitsrisiko), manuelles Editieren von JSON

## D019 Schutz vor schrumpfenden Daten

- Datum: 2026-11-02
- Entscheid: Der Spielplan Job lehnt eine leere Antwort oder fehlende Spiel IDs ab, wenn die bestehende Woche Spiele enthält (Exit 1, Dateien unverändert). Ausnahme nur bei explizit gewählter Woche per CLI
- Begründung: Review Sprint 1. Eine kurzzeitig leere ESPN Antwort hätte eine gültige Woche überschrieben und deployt
- Verworfen: blindes Überschreiben bei schemakonformer Antwort

## D020 Bedeutung des Datenstands

- Datum: 2026-11-02
- Entscheid: fetchedAt wird nur bei Inhaltsänderung geschrieben, die App beschriftet es als "Letzte Änderung". Ein Ausfall des Jobs wird ab Sprint 3 über den Ausfall Wächter erkannt, nicht über einen stündlichen Commit
- Begründung: Ein Commit pro Stunde würde die Historie fluten
- Verworfen: data/status.json mit Zeitpunkt jeder Prüfung

## D021 Abweichungen nach Ranglistenstand

- Datum: 2026-11-02
- Entscheid: Ergänzt D015. Tippgruppe hat 5 Personen inklusive Nutzer, also 4 Gegner. Anzahl Abweichungs Kandidaten pro Woche hängt vom Rückstand in der Saisonrangliste ab: in Führung 0, bis 2 Punkte Rückstand höchstens 1, mehr Rückstand höchstens 2. Gegen Saisonende mit grossem Rückstand höchstens 3. Status: ungeprüft, Kalibrierung mit den Daten aus Sprint 4
- Begründung: In einer kleinen Gruppe mit Saisonwertung erhöhen Abweichungen vor allem die Streuung. Das hilft nur, wer zurückliegt. Wer führt, verliert dadurch im Schnitt
- Verworfen: feste Anzahl Abweichungen pro Woche

## D022 Kein verpasster Tipp hat Vorrang vor Abweichungen

- Datum: 2026-11-02
- Entscheid: Stand nach Week 8: Nutzer Platz 5 mit 45 Punkten aus 73 Tipps (Quote 62 Prozent, beste der Gruppe), Spitze 71 Punkte aus 117 Tipps. Der Rückstand stammt aus rund 44 nicht abgegebenen Tipps, nicht aus schlechter Qualität. Höchste Priorität hat deshalb, dass kein Tipp mehr fehlt (Push vor jedem Tippschluss, D012). Abweichungen nach D021 bleiben, realistisches Saisonziel ist Platz 4 (6 Punkte Rückstand) mit Favoriten Tipps
- Begründung: 26 Punkte Rückstand auf Platz 1 bei rund 150 verbleibenden Spielen sind über Abweichungen statistisch kaum aufzuholen. Jeder verpasste Tipp kostet dagegen sicher rund 0.6 Punkte
- Verworfen: aggressive Abweichungen, um Platz 1 zu jagen
- Datenschutz: Namen der Gruppe werden nie im öffentlichen Repo gespeichert, nur Kürzel

## D023 Tippschluss verifiziert

- Datum: 2026-11-02
- Entscheid: D016 ist geprüft. Tipps sind pro Spiel bis zum Kickoff änderbar. lockMode bleibt per_kickoff
- Begründung: vom Nutzer auf der Tippseite verifiziert
- Folge für D022: Am Donnerstag werden alle Spiele der Woche sofort mit dem Favoriten getippt (Grundtipp), spätere Checks ändern nur noch. Ein vergessener Check kostet so keinen Punkt mehr, nur eine verpasste Korrektur

## D024 Quoten aus ESPN statt The Odds API

- Datum: 2026-11-02
- Entscheid: Ändert D002 und D009. Siegwahrscheinlichkeit aus dem Spread im ESPN Scoreboard (Anbieter DraftKings) über Normalverteilung mit Standardabweichung 13.5 Punkte. Tiebreaker Resultat aus Over/Under und Spread. The Odds API erst, wenn ESPN Quoten fehlen oder unzuverlässig sind
- Begründung: ESPN liefert Spread und Over/Under gratis im bereits genutzten Abruf (am 2026-11-02 für Week 9 geprüft). Kein weiteres Konto, kein Key
- Verworfen: The Odds API in Sprint 2 (Konto und Key nötig, Mehrwert eines zweiten Buchmachers gering)

## D025 Zwei Tiebreaker pro Woche

- Datum: 2026-11-02
- Entscheid: Laut FAQ der Tippseite gibt es Resultat Tipps nur für das Thursday Night und das Monday Night Game, beide zählen als Tiebreaker. Zuordnung über den Wochentag in America/New_York, bei mehreren Spielen am selben Tag das späteste. Datenvertrag tiebreakers als Liste mit 0 bis 2 Einträgen
- Begründung: FAQ der Tippseite, vom Nutzer übermittelt. Ersetzt die Annahme "erstes Spiel der Woche"
- Verworfen: ein einziger Tiebreaker. Ungeprüft bleibt die Regel bei mehreren Spielen am selben Tag

## D026 Abweichungen nach Rückstand pro Restwoche

- Datum: 2026-11-02
- Entscheid: Ersetzt die Schwellen aus D021. Massgebend ist der Rückstand auf den Spieler direkt vor dem Nutzer (Ziel nach D022), geteilt durch die verbleibenden Regular Season Wochen inklusive der aktuellen (18 minus Woche plus 1). Bis 1 Punkt pro Woche: 0 Abweichungen. Bis 2: 1. Darüber: 2. In den letzten 3 Wochen mit über 2 Punkten Rückstand total: 3. In Führung: 0. Postseason: wie letzte 3 Wochen. Tiebreaker Resultat folgt dem getippten Team, bei Abweichung gewinnt der getippte Aussenseiter mit 3 Punkten Vorsprung bei gleichem Total
- Begründung: Mit D021 hätte die App in Week 9 zwei Abweichungen mit je rund 41 Prozent vorgeschlagen und damit im Schnitt rund 0.35 Punkte verschenkt, obwohl das Ziel Platz 4 bei 6 Punkten Rückstand ohne Risiko erreichbar ist. Ein Resultat Tipp gegen den eigenen Sieger Tipp ist widersprüchlich
- Verworfen: Rückstand auf Platz 1 als Massstab, feste Schwellen ohne Restlaufzeit

## D027 Review Ergebnisse Sprint 2

- Datum: 2026-11-02
- Entscheid: Grundtipp ist immer der Favorit vor einer Abweichung. Häkchen "eingetragen" speichert das getippte Team lokal, weicht der aktuelle Tipp ab, warnt die App. Spiele, die beim ersten Lauf schon vorbei sind, heissen "nicht_erfasst" und bekommen keinen Tiebreaker. Der Tipp Job nimmt die Woche aus data/current.json, damit Spielplan und Tipps nie verschiedene Wochen sehen. Beide Jobs laufen im Workflow auch bei Fehler des anderen, der Lauf wird am Ende rot
- Begründung: unabhängiger Review und QA Sprint 2
- Verworfen: Häkchen nur als Ja oder Nein ohne Team

## D028 Ziel ist immer Platz 1

- Datum: 2026-11-02
- Entscheid: Ersetzt das Saisonziel aus D022 und das Ziel in D026. Massstab für die Abweichungen ist immer der Rückstand auf Platz 1, die Formel pro Restwoche aus D026 bleibt. Stand Week 9: 26 Punkte auf 10 Wochen ergibt 2 Abweichungen
- Begründung: Entscheid des Nutzers, die App spielt immer auf Sieg. Product Owner Hinweis dokumentiert: Abweichungen kosten im Schnitt Punkte, die Chance auf Platz 1 bleibt bei 26 Punkten Rückstand klein, dafür sinkt die Chance auf Platz 4
- Verworfen: Ziel Platz 4 aus D022

## D029 Web Push ohne Server

- Datum: 2026-11-02
- Entscheid: Die App ist eine PWA mit Service Worker. Beim Onboarding meldet das Gerät sich für Push an und zeigt die Anmeldung (Subscription JSON) mit Kopierknopf. Der Nutzer legt sie einmalig als GitHub Secret PUSH_SUBSCRIPTION ab, der private VAPID Schlüssel liegt als Secret VAPID_PRIVATE_KEY. Ein Workflow alle 10 Minuten (ungerade Minuten wegen Cron Verzögerung) sendet mit web-push. Bereits gesendete Meldungen stehen in data/push-log.json, damit nichts doppelt kommt
- Begründung: GitHub Pages kann keine Anmeldung speichern, ein Secret ist der sicherste Ort ohne Backend. Einmaliger Aufwand pro Gerät
- Verworfen: Anmeldung im öffentlichen Repo oder in einem Issue, eigenes Backend

## D030 Ausfall Wächter

- Datum: 2026-11-02
- Entscheid: Quelle ist der ESPN Summary Endpoint pro Spiel (injuries, leaders). Wichtig sind alle Quarterbacks und die Team Leader (Passing, Rushing, Receiving). Am Donnerstag wird ein Grundstand gespeichert, vor jedem Kickoff Slot wird verglichen. Gemeldet werden Statuswechsel dieser Spieler und Tippänderungen seit dem Grundtipp
- Begründung: ESPN liefert keine verlässliche Startaufstellung im selben Abruf, Leader sind ein guter Ersatz für Schlüsselspieler
- Verworfen: Depth Chart Endpoint (komplex, inoffiziell, viele Abrufe)

## D031 Push Zuverlässigkeit

- Datum: 2026-11-02
- Entscheid: Slot Meldung im Fenster 2 bis 60 Minuten vor Kickoff (statt 15 bis 60 laut Sprint Auftrag). TTL der Meldung endet beim Kickoff. Push Workflow mit eigener Concurrency Gruppe und Retry beim Push. Echter Versand nur auf main, Testnachricht überall
- Begründung: Review Sprint 3. Fallen mehrere verzögerte Cron Läufe aus, käme sonst gar keine Erinnerung. Eine späte Erinnerung ist besser als keine (D022). Eine Erinnerung nach Kickoff ist wertlos
- Verworfen: feste Untergrenze 15 Minuten

## D032 Bilanz ohne Einzeltipps der Gruppe

- Datum: 2026-11-02
- Entscheid: Ersetzt D011, D014 und D018 im Umfang. Der Nutzer meldet pro Woche nur die 5 Punktestände der Gruppenrangliste über ein GitHub Issue Formular. Ein Workflow übernimmt sie nach data/standings.json und data/standings-history.json, nur wenn der Autor der Repo Owner ist. Wochenpunkte der Gruppe sind die Differenz zur Vorwoche. Eigene Bilanz, Tiebreaker Abweichung und Wirkung der Abweichungen rechnet die App aus App Tipps und Resultaten. Annahme: der Nutzer trägt die App Tipps ein. Push "Bilanz bereit", sobald alle Spiele final sind
- Begründung: 5 Zahlen pro Woche statt 60 Einzeltipps. Mit D028 (Ziel Platz 1) braucht die Abweichungslogik kein Gruppenverhalten pro Spiel
- Verworfen: Einzeltipps der Gruppe erfassen, Screenshot Auswertung (bräuchte API Key)

## D033 Bilanz Meldung und Ranglisten Workflow

- Datum: 2026-11-02
- Entscheid: Push "Bilanz bereit" nur für die neueste komplette Woche, geprüft werden die zwei neuesten Bilanzen. Der Ranglisten Workflow hat eine eigene Concurrency Gruppe mit Retry beim Push
- Begründung: Ein leeres push-log soll keine Flut alter Meldungen auslösen. In der Gruppe von data.yml könnte ein Cron Lauf eine wartende Ranglistenmeldung verdrängen
- Verworfen: Meldung für jede fertige Woche ohne Begrenzung

## D034 Review Ergebnisse Sprint 4

- Datum: 2026-11-02
- Entscheid: Ranglisten Meldung für dieselbe Woche ersetzt den letzten Eintrag (Korrektur), identische Meldung ist Erfolg ohne Änderung, Punkte höchstens 300, nur Owner als Autor und Sender. maxDeviations wird pro Woche beim ersten Lauf eingefroren, eine neue Rangliste wirkt ab der nächsten Woche. Abgesagte Spiele und ab Kickoff plus 7 Tage verschobene oder fehlende Spiele zählen in der Bilanz nicht. Ranglistenverlauf mit seasonType. Alle drei Workflows schreiben mit Retry
- Begründung: unabhängiger Review und QA Sprint 4
- Verworfen: Korrektur nur durch Bearbeiten der JSON Datei

## D035 Layout nach Bildschirmform, iPhone Duo

- Datum: 2026-11-02
- Entscheid: Das Redesign richtet sich nach der Form des Viewports per CSS Media Queries, nicht nach dem Gerätemodell. Drei Layouts: schmal hoch (normales iPhone, eine Spalte, Navigation oben oder unten), flach breit (iPhone Duo zugeklappt, rund 678 mal 466 CSS px: Navigation als Seitenleiste links, Spiele zweispaltig, kompakter Kopf), breit hoch (iPhone Duo aufgeklappt, rund 626 mal 890: drei Übersichtskacheln, Spiele zweispaltig, ganze Woche auf einen Blick). Wechsel beim Auf und Zuklappen ohne Neuladen. Entwürfe im Design Canvas. Umsetzung erst nach Abnahme Week 9. Pixelmasse des Duo aus Drittquellen, ungeprüft
- Begründung: Safari gibt das iPhone Modell nicht preis. Media Queries greifen sofort beim Wechsel des Zustands und decken auch künftige Geräte ab
- Verworfen: Erkennung über den User Agent

## D036 Stil A und Duo Layouts nach Recherche

- Datum: 2026-11-02
- Entscheid: Stil A Flutlicht ist gesetzt. Ergänzt D035 mit Werten aus der Recherche (Drittquellen, ungeprüft): Duo zugeklappt 466 mal 678 Punkte hoch mit 84 Punkten reserviert rechts und 34 unten, Navigation als Leiste rechts vor dem reservierten Bereich. Duo aufgeklappt quer rund 951 mal 669 mit Systemleiste rechts (Screenshot des Nutzers) und Falz in der Mitte: Navigationsleiste links, links die scrollende Spielliste, rechts die Übersicht, Teilung 50 zu 50 am Falz, gerade Spaltenzahl. Aufgeklappt hoch rund 669 mal 951: Kacheln oben, Spiele zweispaltig. Breakpoints nach Breite: unter 600 kompakt, 600 bis 839 mittel, ab 840 zwei Bereiche. Safe Area per env(safe-area-inset-*) je Seite einzeln, viewport-fit=cover. Viewport Segments API nur als Zusatz
- Begründung: Wahl des Nutzers, Screenshot vom Duo, Apple Empfehlung laut Drittquellen (Size Classes statt Gerät, asymmetrische Safe Areas, scrollende Inhalte bleiben stehen, gerade Spaltenzahl wegen Falz), Android Canonical Layouts als Referenz
- Verworfen: Stil B, feste Gerätelayouts

## D037 Duo quer nach Referenz im Stil Apple Sports

- Datum: 2026-11-02
- Entscheid: Ergänzt D036 für das Duo aufgeklappt quer. Links bis zum Falz ein Spielbereich für das Spiel mit dem nächsten Tippschluss in Teamfarben: Countdown, Ring mit Siegwahrscheinlichkeit, Tipp, Resultat Tiebreaker, wichtigster Ausfall, Knopf zur Tippseite. Rechts die scrollende Spielliste mit Umschalter Offen oder Alle und Fortschritt. Navigation als senkrechte Kapsel in der rechten Systemspalte, darüber eine Werkzeugkapsel (Aktualisieren, Benachrichtigungen). Keine Navigation links
- Begründung: Referenz Screenshot des Nutzers (Sport App auf dem Duo quer), entspricht der Apple Empfehlung, Leisten auf dem Duo rechts zu führen
- Verworfen: Navigationsleiste links aus D036

## D038 Durchgängiges Design über alle Bildschirmformen

- Datum: 2026-11-02
- Entscheid: Vier Bausteine in allen Layouts gleich: Spielbereich in Teamfarben mit Ring der Siegwahrscheinlichkeit, Tipp, Tiebreaker Resultat, wichtigstem Ausfall und Knopf zur Tippseite. Umschalter Offen oder Alle als Kapsel. Spielzeile mit Teampunkt, Tipp, Gegner, Prozent und Häkchen. Navigation als Kapsel mit fünf Symbolen (Tipps, Bilanz, Spielplan, Rangliste, Mehr). Anordnung je Form: iPhone und Duo aufgeklappt hoch mit schwebender Kapsel unten (Leisten im Hochformat waagrecht), Duo zugeklappt und aufgeklappt quer mit senkrechter Kapsel in der rechten Spalte. Spielbereich im iPhone und Duo hoch oben, im Duo quer als linke Hälfte, im Duo zu kompakt oben
- Begründung: Wunsch des Nutzers nach durchgängigem Design zwischen Duo quer und hoch, Referenz Sport App
- Verworfen: Reiter als Textleiste oben aus Entwurf A

## D039 Design Umsetzung vor der Abnahme

- Datum: 2026-11-02
- Entscheid: Redesign nach D036 bis D038 wird sofort umgesetzt (Sprint D), nur Darstellung, keine Änderung an Logik, Datenvertrag, Jobs oder Push. Merge vor Donnerstag, damit die Abnahme Week 9 bereits mit dem neuen Design läuft. Schriften Barlow Condensed und Inter selbst gehostet unter public/fonts statt Google Fonts. Navigation mit 4 Zielen (Tipps, Bilanz, Spielplan, Einstellungen). Layoutwahl per Breite plus gemessenem rechtem Safe Area Inset
- Begründung: Wunsch des Nutzers. Product Owner Hinweis: Politur vor Abnahme ist ein Risiko, begrenzt durch reine Darstellungsänderung und Review und QA vor Merge. Google Fonts würde bei jedem Aufruf die IP an Google senden
- Verworfen: Umsetzung erst nach Dienstag, Ranglisten Reiter ohne eigene Seite

## D040 KI Zweitmeinung im Backlog

- Datum: 2026-11-02
- Entscheid: Wunsch des Nutzers nach einer KI Zweitmeinung zur Profiquote kommt in den Backlog nach Gate 3. Ablauf: 4 Wochen Schattenmodus, Zweitmeinung mit Sieger, Wahrscheinlichkeit, Begründung und Quellenlinks wird pro Spiel vor Kickoff gespeichert und gesperrt wie der Tipp, aber nicht angezeigt. Danach Vergleich mit der Quote in der Bilanz (Brier Score, Trefferquote, Fälle mit abweichendem Sieger). Der Tipp selbst bleibt quotenbasiert (D005, D009), die Zweitmeinung ersetzt ihn nicht. Fakten ohne Quelle werden verworfen
- Begründung: Forschung zeigt keinen belegten Vorteil von Sprachmodellen gegenüber Wettquoten. Messen vor Anzeigen verhindert Scheinsicherheit. Quellenpflicht gegen erfundene Ausfälle
- Verworfen: KI berechnet den Tipp, Anzeige ohne vorherige Messung

## D041 Externer Auslöser über cron-job.org

- Datum: 2026-11-02
- Entscheid: Zwei Jobs bei cron-job.org starten die Workflows per workflow_dispatch über die GitHub API: "NFL Push Wächter" alle 10 Minuten (push.yml), "NFL Daten" stündlich um Minute 47 (data.yml). Authentifizierung mit einem fein granulierten Token nur für das Repo AMF-Helper und nur Actions Read and write, gültig bis 2026-11-02 plus 1 Jahr (02.11.2027). Die Zeitpläne in den Workflows bleiben aktiv, Doppelläufe sind unschädlich (push-log verhindert doppelte Meldungen, concurrency serialisiert). Support Ticket 4939976 bei GitHub wurde am 2026-11-02 ohne Prüfung geschlossen (Gratis Tarif nur Selbsthilfe), cron-job.org ist damit die Dauerlösung
- Begründung: GitHub startete push.yml nach Zeitplan nie und data.yml erst nach über 8 Stunden einmal. Ursache von aussen nicht feststellbar, Antwort des Supports dauert Tage, Erinnerungen müssen ab Donnerstag sicher laufen. Testläufe 2026-11-02 12:20 und 12:24 UTC grün, echter Push "Tippliste W8 bereit" zugestellt
- Verworfen: warten, Auslösen über geplante Aufgaben einer Claude Sitzung (nicht dauerhaft), Token ohne Ablauf

## D042 Abnahme ans Projektende verschoben

- Datum: 2026-11-02
- Entscheid: Entscheid des Nutzers. Die Definition of Done gilt als erreicht (alle sechs Punkte gebaut, live, automatisiert, Gerätetest Duo bestanden). Gate 3 ist damit freigegeben. Die formelle Abnahme an einer echten Woche entfällt jetzt und erfolgt am Projektende zusammen mit allen Features. Reihenfolge der weiteren Sprints: Wochen blättern, Liveticker, News, KI Zweitmeinung im Schattenmodus, danach Gesamtabnahme. Die Automatik läuft ab Week 9 trotzdem, gemeldete Fehler werden sofort behoben
- Begründung: Wunsch des Nutzers, die App vollständig zu bauen und am Schluss abzunehmen. Product Owner Hinweis dokumentiert: Fehler im Grundsystem werden dadurch später sichtbar und überlagern sich mit Fehlern neuer Features
- Verworfen: Abnahme Week 9 vor neuen Features (Regel 2 in CLAUDE.md, hier bewusst aufgehoben)

## D043 Ausbau Daten: News, Wochenindex, KI Zweitmeinung

- Datum: 2026-11-02
- Entscheid: News aus RSS (ESPN, CBS, PFT) mit eigenem schlanken Parser, höchstens 150 Einträge, nur Titel, Anriss, Link. Spielplan und Tipps zusätzlich für die nächsten 2 Wochen. Wochenindex data/weeks/index.json. KI Zweitmeinung mit claude-haiku-5-5, Web Suche mit höchstens 3 Suchen, Antwort über ein striktes Werkzeug, Quellen zählen nur, wenn ihre URL in den Suchergebnissen stand. Höchstens 2 Versuche pro Spiel, protokolliert in data/opinions/attempts.json (eigenes zod Schema). Kosten rund 0.035 USD pro Spiel, etwa 0.55 USD pro Woche, höchstens 1.10 USD. Bekannte Teamfarben werden nicht durch fehlende Werte späterer Wochen gelöscht
- Begründung: kleinstes aktuelles Modell genügt für Zusammenfassung und Einschätzung, Websuche liefert belegbare Quellen gegen erfundene Fakten
- Risiko: ESPN RSS blockiert direkte Abrufe teils (Bot Abwehr). Fällt die Quelle in Actions aus, laufen CBS und PFT weiter
- Verworfen: strukturierte JSON Ausgabe per output_config (verträgt sich nicht mit Zitaten), schweres RSS Paket

## D044 Ausbau Frontend

- Datum: 2026-11-02
- Entscheid: Wochenwähler in Tipps, Bilanz und Spiele mit Wahl im Hash (#tipps/2026-2-10). Bilanz startet auf der neuesten vorhandenen Bilanz bis zur aktuellen Woche. Reiter Spielplan heisst Spiele und enthält den Liveticker (Abfrage direkt bei ESPN alle 20 Sekunden nur bei möglichem laufenden Spiel und sichtbarem Tab, Detail mit den letzten 10 Spielzügen). Reiter News mit Filtern Alle, Meine Spiele, Team. Navigation mit 5 Zielen
- Begründung: Wunsch des Nutzers (Wochen blättern), Ausbauplan D042. Die aktuelle Woche hat bis Dienstag meist noch keine Bilanz
- Verworfen: Live Daten über GitHub Actions (zu langsam)

## D045 Wochenwechsel schnell und einheitlich

- Datum: 2026-11-02
- Entscheid: Daten werden pro Sitzung einmal geladen und im Speicher gehalten, Nachbarwochen im Hintergrund vorgeladen. Bei sichtbarem Tab alle 5 Minuten Hintergrundprüfung (no-store), bei Rückkehr nach über 60 s und per Aktualisieren Knopf, ersetzt wird nur geänderter Inhalt ohne Leerzustand. Alle Wochen nutzen dieselbe Struktur (Spielbereich, Kacheln, Umschalter, Tippzeile), kommende Wochen ohne Quoten zeigen "offen" und einen Hinweis statt Ring, vergangene Wochen sind nur lesbar. Kopfzeile immer einzeilig
- Begründung: Gerätetest des Nutzers. Vorher lud jeder Wechsel 8 Dateien neu (0.9 bis 2.2 s mit Leerzustand) und kommende Wochen nutzten grössere Spielplan Karten. Neu 9 bis 27 ms
- Verworfen: Laden ohne Cache, eigene Darstellung für kommende Wochen

## D046 Selbstständiges Mergen eigener Pull Requests

- Datum: 2026-11-02
- Entscheid: Feste Freigabe des Nutzers. Claude merged eigene Pull Requests vom Entwicklungsbranch nach main selbst, wenn typecheck, test und build grün sind und Review und QA bestanden haben (bei kleinen Fixes genügt ein Test, der den Fehler abdeckt). Danach kurze Meldung an den Nutzer, was live ging, und Prüfung der Veröffentlichung. Weiterhin nachfragen bei: Änderungen an Secrets, Kosten oder externen Diensten, grösseren Umbauten oder Designänderungen, allem was einen Entscheid des Nutzers braucht, und bei roten Prüfungen
- Begründung: Wunsch des Nutzers, weniger Rückfragen bei Routine
- Verworfen: Rückfrage vor jedem Merge

## D047 Bilanz Wochenwähler wie Tipps

- Datum: 2026-11-02
- Entscheid: Ersetzt den Teil von D044 zur Bilanz Wochenwahl. Die Bilanz nutzt dieselbe Wochenliste wie Tipps und Spiele. Wochen ohne Bilanz zeigen im gleichen Aufbau einen Hinweis. Startwoche bleibt die neueste Woche mit Bilanz
- Begründung: Nutzerbefund, der Wähler wirkte mit nur einer Bilanzwoche wie defekt
- Verworfen: Wähler nur über Wochen mit Bilanz

## D048 Spielbereich per Auswahl (List Detail)

- Datum: 2026-11-02
- Entscheid: Wunsch des Nutzers. Im Layout wide wählt ein Antippen einer Spielzeile das Spiel für den Spielbereich links, mit Pfeilen zum Durchklicken (folgen dem aktiven Filter) und Knopf "Zum nächsten Tippschluss". In compact, side und medium öffnet das Antippen denselben Spielbereich als Blatt von unten. Gesperrte Spiele zeigen Endresultat mit richtig oder falsch, laufende den Live Score. Auswahl im Hash, Wochenwechsel setzt zurück. Häkchen ändert die Auswahl nicht
- Begründung: Spielbereich zeigte bisher fix das nächste Tippschluss Spiel, die Liste rechts war nicht mit ihm verbunden. Entspricht dem List Detail Muster für breite Bildschirme
- Verworfen: Wischgesten (optional, später)

## D049 Stabilität nach Code Review

- Datum: 2026-11-02
- Entscheid: Ergebnis eines Reviews mit vier Agenten. ESPN Status mit state "post" gelten nur als final bei completed oder Name STATUS_FINAL, alle anderen (suspendiert, abgebrochen, verwirkt) als verschoben, damit die Regel aus D034 greift. Tippliste wertet wie die Bilanz (ungewertet). Verschobene und abgesagte Spiele bekommen keinen Tiebreaker, ein gesperrter Tiebreaker bleibt. KI Zweitmeinung: Timeout, Netzfehler und gescheiterte Fortsetzung zählen als Versuch, keine Wiederholung im SDK, damit gilt höchstens 2 Versuche mit je höchstens 3 Anfragen pro Spiel (D043). 401, 403, 408, 429 und 5xx zählen weiterhin nicht (R99). push.yml startet Pages nach neuen Ausfalldaten. Neuer CI Workflow für Pull Requests. App: Ladefehler erholen sich mit Aktualisieren oder "Erneut versuchen", Error Boundary, Zeitlimit 15 s für Daten und 10 s für Live, Liveticker mit Backoff bis 5 Minuten und ohne Abruf für verschobene Spiele
- Begründung: Review fand eine mögliche Kostenschleife (Timeout zählte nie), dauerhaft hängende Fehleranzeigen und falsch gewertete unterbrochene Spiele
- Verworfen: Concurrency pro Issue im Ranglisten Workflow (zwei parallele Läufe schreiben dieselbe Datei auf altem Stand, Konflikt oder Doppeleintrag). Sicherung von push-log ausserhalb Git (push.yml schreibt nur eigene Pfade, ein Konflikt ist ausgeschlossen, bei einer GitHub Störung scheitert jede Sicherung über GitHub ebenso)

## D050 Ausbau nach Beta Test mit Agenten

- Datum: 2026-11-02
- Entscheid: Entscheide des Nutzers nach Beta Test (drei Personas, UX Experte) und Feature Analyse (intern und Markt). UI: Wording vereinheitlichen, Tiebreaker mit TNF und MNF statt Wochentag, Abweichung im Spielblatt begründen, Touch Feedback und Trefferflächen 44 px, Unschärfe unter der Navigation, Onboarding mit einem Ausgang und Leseanleitung, Push Hilfe für iPhone, Bilanz aufgeräumt, Endstand in der Tippliste, Layoutfehler. Ausfall Wächter erfasst auch die kommende Woche. Design: ändert D038, Navigation zeigt beim aktiven Ziel Symbol und Text. Ändert D036 und D037, im Duo quer haben alle Reiter zwei Bereiche am Falz. Teamlogos in der Tippliste, Spielblatt schliesst per Wischgeste, zusätzlich Hellmodus nach Systemeinstellung. Nutzerkreis: Spieler beim Onboarding wählbar, Ziel und Abweichungen gelten für diese Person. Strategie: D026 und D028 bleiben, bis Saisonauswertung und Simulation der Chance auf Platz 1 die Grundlage für einen neuen Entscheid liefern. Features: Abgleich Rangliste gegen App Tipps, Linienbewegung im Push, Public Pick Prozente (ESPN Pick'em), ESPN FPI als dritte Meinung im Schattenvergleich, Playoffs und Saisonwechsel, Spielort und Ruhetage, Saisonauswertung, Simulation Platz 1
- Begründung: Testpersonen verstanden Begriffe und Begründungen nicht, Profi vermisste Zahlen und Ausfälle der kommenden Woche, Recherche stellt Abweichungen in kleinen Runden in Frage
- Verworfen: KI Hinweis im Schattenmodus, Mindestschrift 12 px in rem, Betriebsampel, Ranglisten Formular vorausgefüllt, Moneyline statt Spread, CSV Export (Wahl des Nutzers). Tipps automatisch eintragen (D013)

## D051 Saisonkalender, ruhende Wochen und neue Datenversionen

- Datum: 2026-11-02
- Entscheid: Preseason (Typ 1), Pro Bowl (Postseason Woche 4) und Offseason (Typ 4) werden übersprungen. Der Spielplan Job schreibt sie nicht, data/current.json bleibt auf der letzten Tippwoche, damit Tipps, Pushes, Wächter und KI ohne eigene Prüfung ruhen. Kommende Wochen folgen dem Kalender über die Grenze zur Postseason, Postseason Wochen ohne feste Paarung werden nicht geschrieben. Rangliste Version 2 mit season, aus einer anderen Saison gilt Rückstand 0. Wochenpunkte aus dem letzten Eintrag derselben Saison mit kleinerer Ordnung. Lebenszeichen data/heartbeat.json alle 30 Tage über data.yml gegen die Deaktivierung von Workflows. Neue Versionen: Wochendatei 2 (venueInfo, homeRest, awayRest), Tippdatei 2 (firstOdds), Review 2 (rankingCheck), Rangliste 2 (season). Alle Schemas lesen die vorherige Version weiter. Neue Dateien data/fpi und data/picks mit Version 1. Public Picks stündlich in data.yml, FPI und Ausfälle der kommenden Woche im Wächter
- Begründung: Alle Abläufe hängen an current.json, so ruht die Automatik ohne zusätzliches Feld. GitHub deaktiviert Workflows nach 60 Tagen ohne Aktivität
- Verworfen: Preseason als ruhend markieren (jeder Leser müsste das Feld prüfen), eigener Workflow für das Lebenszeichen (GitHub Zeitpläne unzuverlässig, D041), Picks alle 10 Minuten in push.yml (unnötige Abrufe und Commits)
- Offen: Die Simulation Platz 1 nimmt für Gegner eine Aussenseiterquote von 0.13 an (Annahme ohne geprüfte Quelle). Vor einem Entscheid zu D026 und D028 muss die Quote pro Spieler aus den eigenen Daten kalibriert werden (Rangliste gegen Favoritentreffer)
- Risiko: ESPN Pick'em und FPI sind undokumentiert, fallen sie aus, fehlt nur die Zusatzinfo. Verhalten von ESPN vor der Ansetzung einer Playoff Runde ungeprüft, echte Antworten im Januar als Fixtures sichern

## D052 Ziel möglichst hohe Punktzahl, Abweichung entscheidet der Nutzer

- Datum: 2026-11-03
- Entscheid: Entscheid des Nutzers. Ziel ist immer die höchste erwartete Punktzahl, nicht mehr Platz 1. Ersetzt D026 und D028 im Umfang der Abweichungen: Die App wählt keine Abweichungen mehr selbst, der Vorschlag ist immer das Team mit der höheren Siegwahrscheinlichkeit, der Tiebreaker folgt ihm. Gilt sofort, auch für Week 9 (noch kein Spiel gesperrt), eingefrorene Abweichungen werden verworfen. Der Nutzer entscheidet selbst: Die App markiert Kandidaten "Abweichung möglich" (knappe Spiele, deren Aussenseiter laut ESPN Tippverteilung selten getippt wird) und zeigt Signale (Linienbewegung, FPI gegen Markt, Ausfälle). Im Spielblatt wählt ein Knopf "Aussenseiter tippen", Tipp, Tiebreaker und Häkchen folgen der Wahl, gespeichert auf dem Gerät. Die Push Erinnerung nennt weiterhin den Vorschlag der App. Rangliste, Rückstand und Simulation bleiben als Information
- Begründung: Simulation mit echten Daten (Stand Week 8): Chance auf Platz 1 für JA bei 0 bis 3 Abweichungen pro Woche jeweils 0 Prozent, jede Abweichung kostet im Mittel rund 1 bis 2 Punkte. Recherche: in kleinen Runden gewinnt eher der konsequente Favoritentipp. Der Nutzer will trotzdem selbst entscheiden können
- Verworfen: Ziel Platz 2, Abweichungen nur in den letzten Wochen, Wahl im Push über ein GitHub Issue (Aufwand), Kosten in Punkten und Wirkung auf die Rangliste pro Spiel (Wahl des Nutzers)

## D053 Duo: Leiste bündig am rechten Rand

- Datum: 2026-11-03
- Entscheid: Wahl des Nutzers. Meldet iOS rechts keine Safe Area (Duo, Gerätetest mit Diagnose: App 867 bzw. 382 breit, Systemspalte ausserhalb der App, auch nach Neuinstallation), liegt die Navigationsleiste in den Layouts side und wide bündig am rechten Rand, die Kapseln sind nur links gerundet und schliessen an die Systemspalte an. Ändert D036 und D037 im Punkt "Navigation in der rechten Systemspalte", der am 2026-11-02 am Gerät noch galt (R58, R72), seither gibt iOS der App die Spalte nicht mehr
- Begründung: Eine Web App kann ausserhalb ihres Fensters nicht zeichnen
- Verworfen: Leiste links, schwebende Kapsel unten

## D054 Liveticker als Zentrum im Reiter Spiele

- Datum: 2026-11-03
- Entscheid: Wunsch des Nutzers. Laufende Spiele stehen als grosse Karte oben im Reiter Spiele, bei mehreren laufenden Spielen waagrecht wischbar, darunter die übrigen Spiele kompakt. Im Duo quer links der Ticker, rechts die Liste. Der Ticker zeigt: Kopf mit grossen Logos, Score, Bilanz, Punkte je Viertel, Uhr, Ballbesitz, Down und Distanz, Feldposition als Grafik, Red Zone. Verlauf der Siegchance mit Hinweis, ob der eigene Tipp vorne liegt. Letzte Spielzüge, aktueller Drive, Punktspielzüge. Teamvergleich als Balken, Top Spieler, Ort, Wetter, TV. Daten direkt aus ESPN Scoreboard und Summary im Browser (D017, CORS geprüft 2026-11-03)
- Begründung: Der bisherige Ticker war eine Detailansicht ohne Zentrum, ESPN liefert live deutlich mehr Daten
- Verworfen: Nur Liste mit Detail

## D055 Wochenwechsel nach dem letzten Spiel

- Datum: 2026-11-03
- Entscheid: Wunsch des Nutzers. Sind alle Spiele der von ESPN gemeldeten Woche beendet oder abgesagt, setzt der Spielplan Job data/current.json auf die nächste Tippwoche, sobald deren Wochendatei vorliegt. Tipps, Push, Wächter und App wechseln damit Dienstag früh nach dem MNF. current.json springt innerhalb einer Saison nie auf eine frühere Woche zurück, auch wenn ESPN noch die alte Woche meldet. Verschobene Spiele halten die Woche offen. Die Bilanz der alten Woche bleibt über den Wochenwähler erreichbar
- Begründung: ESPN schaltet erst Dienstag oder Mittwoch US Zeit um, die App zeigte bis dahin eine abgeschlossene Woche
- Verworfen: fester Zeitpunkt Dienstag Mittag, Wechsel wie ESPN

## D056 Spielansicht für alle Spiele im Stil des Livetickers

- Datum: 2026-11-03
- Entscheid: Wunsch des Nutzers. Geplante und beendete Spiele bekommen im Reiter Spiele dieselbe Gestaltung wie der Liveticker (D054). Vor dem Spiel: Kopf mit grossen Logos, Teamfarben, Bilanz, Countdown bis Kickoff, TV, Ring mit Siegchance und Tipp. Fakten als kompakte Kacheln (Markt, FPI, ESPN Tipps, Ort, Ruhetage, Ausfälle), Abweichung möglich als eigene Karte mit Knopf (D052). Nach dem Spiel: Endstand gross, Punkte je Viertel, Punktspielzüge, Teamvergleich, Top Spieler, richtig oder falsch zum Tipp. Die ESPN Summary wird für das geöffnete Spiel einmal geladen (rund 180 KB, ohne Polling), auch vor dem Spiel, sonst fehlen Bilanz und TV
- Begründung: Der Nutzer fand die Ansicht geplanter Spiele schlicht und ohne Logos
- Verworfen: Wetterprognose (Wahl des Nutzers)

## D057 Bug Suche 2026-11-08

- Datum: 2026-11-08
- Entscheid: Entscheide des Nutzers nach der Bug Suche mit vier Agenten. Bilanz und Saisonansicht verrechnen in der App die eigene, auf dem Gerät gespeicherte Wahl (D052) mit Hinweis "inkl. deiner Abweichungen". Der Push "Bilanz bereit" lässt den Teil zu Abweichungen weg. Die Push Erinnerung vor Tippschluss bleibt bei Paarungen und Ausfällen, ohne Tipps, Ausfälle nach Gewicht (Leader Rollen und Start QB zuerst, Ersatz QBs auf der Inaktivliste weglassen). ESPN News über die JSON Schnittstelle statt RSS, Werbeartikel (promo code, bonus code) werden ausgefiltert. In der Tippliste im Duo zugeklappt steht der Stand in einer zweiten Zeile unter den Teams. Zugeklappt zeigt die Leiste auch Aktualisieren und Glocke. Doppeltipp Zoom ist abgeschaltet (touch-action manipulation). Der Viewport Eingriff aus R115 gilt nur noch beim Zurückkehren in der Home Bildschirm App
- Begründung: Nutzer meldete tote Taps beim schnellen Durchtippen, fehlende Werkzeugkapsel und Bilanzwerte ohne eigene Wahl
- Verworfen: Tipps in der Push Erinnerung, ESPN News entfernen
