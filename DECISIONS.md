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
