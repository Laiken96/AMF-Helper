# Sprint 5 bis 8 Ausbau (D042)

Datenvertrag fix in src/core/extra-schema.ts. Zwei Streams mit getrennten Dateien.

## Stream Daten (src/core, jobs, tests, .github, data)
1. Wochenindex: data/weeks/index.json nach WeeksIndexSchema, geschrieben vom Datenjob nach jedem Lauf aus den vorhandenen Dateien. Spielplan Job holt zusätzlich die nächsten 2 Wochen der Regular Season (gleiche Schutzregeln D019, current.json unverändert). Tipp Job rechnet Tipps auch für kommende Wochen, sobald Quoten vorhanden sind (maxDeviations wird erst mit dem ersten Lauf der Woche eingefroren, D034).
2. News: jobs/news.ts liest RSS von ESPN (https://www.espn.com/espn/rss/nfl/news), CBS (https://www.cbssports.com/rss/headlines/nfl/), PFT (https://profootballtalk.nbcsports.com/feed/). Dedupe über normalisierte URL, nur Titel, Anriss ohne HTML, Link (keine Volltexte). Team Erkennung über Namen, Spitznamen und Städte aus teams.json (z. B. "Chiefs", "Kansas City"). Höchstens 150 Einträge. Läuft im Datenjob. Fehler einer Quelle blockiert die anderen nicht.
3. KI Zweitmeinung (Schattenmodus, D040): jobs/opinion.ts. Vor Implementierung den Skill claude-api laden und dessen Vorgaben zu Modell, SDK und Web Suche folgen. Pro Spiel genau eine Meinung, erzeugt im ersten Lauf, wenn Kickoff weniger als 6 Stunden entfernt ist und eine Quote existiert. Eingaben: Teams, Quote, Siegwahrscheinlichkeit Markt, Ausfälle aus data/injuries. Mit Web Suche nach aktuellen News, Antwort als strukturiertes JSON (Sieger, Wahrscheinlichkeit, 2 bis 3 Sätze Deutsch, Quellen mit URL). Ohne Quelle verwerfen. Danach nie überschreiben. Secret ANTHROPIC_API_KEY, fehlt es: Log Meldung, Exit 0. Kosten pro Lauf loggen. Läuft im Push Workflow (alle 10 Minuten), damit die 6 Stunden Grenze getroffen wird. Nicht in der App anzeigen.
4. Bilanz Vergleich: Review berechnet zusätzlich für Spiele mit Meinung: Trefferquote Markt gegen KI, Brier Score beider, Liste der Spiele mit abweichendem Sieger. Neues optionales Feld opinionCompare im Review (ReviewFileSchema um optionales Feld erweitern, schemaVersion bleibt 1, da optional).
5. Kleiner Fix: Push "Tippliste bereit" nennt nur offene Spiele (nicht gesperrte), nicht alle der Woche.
Tests für alles, inklusive kaputter Feeds, doppelter News, fehlender API Key, Meinung nach Kickoff nie erzeugt, Meinung nie überschrieben.

## Stream Frontend (src/app, public, index.html)
1. Wochen blättern: in Tipps, Bilanz und Spielplan oben ein Wochenwähler (zurück, Woche, vor) auf Basis von data/weeks/index.json. Standard ist die aktuelle Woche aus current.json. Vergangene Wochen read only mit Ergebnis je Tipp (richtig, falsch). Kommende Wochen: Spielplan, Tipps falls tipsFile existiert, sonst Hinweis "Tipps folgen, sobald Quoten verfügbar sind". Wahl im URL Hash (z. B. #tipps/2026-2-10).
2. Liveticker: Reiter Spielplan wird "Spiele". Laufende Spiele holt der Browser direkt bei ESPN (site.api.espn.com scoreboard, CORS erlaubt, D017), alle 20 Sekunden nur während ein Spiel läuft und der Tab sichtbar ist, sonst kein Polling. Pro laufendem Spiel: Score, Viertel und Uhr, Ballbesitz, Down und Distanz falls vorhanden, letzter Spielzug. Antippen öffnet Detail mit den letzten 10 Spielzügen aus dem ESPN Summary Endpoint. Im Spielbereich der Tipps erscheint bei laufendem Spiel der Live Score statt Countdown. Fehler der Live Abfrage: letzter Stand mit Hinweis, kein Absturz.
3. News: neuer Reiter "News" mit Liste aus data/news.json, Filter Alle, Meine Spiele (Teams der aktuellen Woche mit offenem Tipp), pro Team. Link öffnet in neuem Tab. Im Spielbereich der Tipps bis zu 2 aktuelle Schlagzeilen zu den beiden Teams.
4. Navigation: 5 Ziele Tipps, Bilanz, Spiele, News, Einstellungen. Layouts compact, side, medium, wide aus Sprint D bleiben gültig, Kapsel muss auf 466x678 mit Inset 84 passen.
Fehlende Dateien (index, news) dürfen die App nie blockieren, dann Verhalten wie bisher.

## Abnahmekriterien beider Streams
typecheck, test, build grün. Playwright 390x844, 466x678?inset=84, 669x951, 951x669 ohne Konsolenfehler und ohne waagrechtes Scrollen. REGRESSION.md wird von der QA ergänzt.
