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
