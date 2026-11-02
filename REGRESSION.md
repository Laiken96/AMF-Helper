# Regressionsliste NFL Dashboard

Manuelle Testschritte, die vor jedem Release durchlaufen werden. Wächst mit jedem Sprint. Grüne Unit Tests ersetzen diese Liste nicht.

Mindestens ein Berechtigungsfall und ein Leerfall gehören dazu.

Format:

```
R1  Kurztitel
    Vorbedingung:
    Schritt:
    Erwartet:
    Status:
```

Status Werte: "bestanden lokal 2026-11-02" (heute durch QA selbst geprüft), "offen GitHub" (erst nach Merge auf main und mit aktivierten Pages prüfbar), "offen Nutzer" (braucht ESPN App oder echte Spielwoche).

Lokale Prüfungen liefen in einer Kopie des Repos, nicht im Arbeitsordner. Für die App Prüfungen: `BASE_PATH=/AMF-Helper/ npm run build`, dann `BASE_PATH=/AMF-Helper/ npx vite preview`, Aufruf mit Playwright (chromium, Viewport 390 x 844, Browser Zeitzone America/New_York, damit eine falsche Zeitzone auffallen würde). Manipuliert wurde nur im Ordner dist/data, nie in data/.

---

## Sprint 1 Gerüst und Spielplan

R1  Fehlerfall Netz im Datenjob
    Vorbedingung: data/ enthält einen gültigen Stand. Prüfsummen aller Dateien unter data/ notiert.
    Schritt: `HTTPS_PROXY=http://127.0.0.1:9 NODE_USE_ENV_PROXY=1 npm run job:schedule` (toter Proxy nur für diesen Befehl). Zusätzlich mit einer Antwort HTTP 503 und einer Antwort, die kein JSON ist.
    Erwartet: Meldung "Fehler beim Abruf, bestehende Dateien bleiben unverändert", Exit Code 1, alle Prüfsummen unter data/ unverändert, keine neue Datei.
    Status: bestanden lokal 2026-11-02 (alle drei Varianten Exit Code 1, data/ unverändert)

R2  Fehlerfall Schema im Datenjob
    Vorbedingung: wie R1.
    Schritt: Job mit einer Antwort starten, die gültiges JSON ist, aber nicht dem ESPN Schema entspricht (z. B. `{"events":[{"id":1}]}` oder `{"leagues":[],"events":[]}`), etwa über ein vorgeladenes Modul, das fetch ersetzt.
    Erwartet: Meldung "Schemafehler, bestehende Dateien bleiben unverändert" mit den betroffenen Feldern, Exit Code 1, data/ unverändert.
    Status: bestanden lokal 2026-11-02

R3  Fehlerfall Schema und kaputte Datei in der App
    Vorbedingung: Build und Preview wie oben, normale Woche lädt.
    Schritt: In dist/data/current.json nacheinander (a) abgeschnittenes JSON, (b) `{"schemaVersion":2,"season":2026}`, (c) Datei löschen. Jeweils Seite neu laden.
    Erwartet: Kein weisser Bildschirm. Sichtbar "Daten konnten nicht geladen werden." mit Grund, bei (a) "ist kein gültiges JSON", bei (b) "entspricht nicht dem erwarteten Format bei Feld schemaVersion", bei (c) eine Fehlermeldung. Keine Fehler in der Browser Konsole.
    Status: bestanden lokal 2026-11-02. Hinweis zu (c): vite preview liefert für fehlende Dateien index.html mit HTTP 200, daher erscheint lokal "kein gültiges JSON" statt "HTTP 404". Auf GitHub Pages erneut prüfen (offen GitHub).

R4  Leerfall Woche ohne Spiele
    Vorbedingung: Build und Preview wie oben.
    Schritt: In dist/data/weeks/<aktuelle Woche>.json die Felder games und byeTeamIds auf leere Listen setzen, Seite neu laden.
    Erwartet: Kopf mit Woche, Saison und Stand der Daten bleibt sichtbar, darunter "Diese Woche sind keine Spiele angesetzt." Kein Fehler, kein weisser Bildschirm.
    Status: bestanden lokal 2026-11-02

R5  Bye Teams sichtbar
    Vorbedingung: Aktuelle Woche hat spielfreie Teams (Woche 8 2026: NO, NYG, SF, HOU).
    Schritt: Seite Woche öffnen und ans Ende scrollen.
    Erwartet: Abschnitt "Spielfrei" listet genau die Teams ohne Spiel. Kein Bye Team erscheint in einem Spiel.
    Status: bestanden lokal 2026-11-02 (Woche 8 mit 4 Bye Teams, Woche 9 Datei mit 2 Bye Teams 10 und 23)

R6  Sommerzeit und Sonntagnachtspiel
    Vorbedingung: Woche mit Spielen vor und nach dem Ende der US Sommerzeit (2026: EU Wechsel 25.10., US Wechsel 1.11.), Woche 8 2026.
    Schritt: Seite Woche mit Browser Zeitzone ausserhalb Europas öffnen und Zeiten prüfen.
    Erwartet: Donnerstagspiel CAR at GB (00:15 UTC) als "Fr 30.10. 01:15", Sonntagsspiele 18:00 UTC als "So 01.11. 19:00", Sonntagnachtspiel PHI at WSH als "Mo 02.11. 02:20" und weiterhin in Woche 8, Montagnachtspiel als "Di 03.11. 02:15". Alle Zeiten in Europe/Zurich, unabhängig von der Zeitzone des Browsers.
    Status: bestanden lokal 2026-11-02

R7  Vergleich 3 Spiele mit der ESPN App
    Vorbedingung: Pages URL zeigt die aktuelle Woche, ESPN App am Handy auf Schweizer Zeitzone.
    Schritt: Drei Spiele aus verschiedenen Slots (Donnerstag, Sonntag früh, Sonntagnacht oder Montag) in beiden Apps vergleichen.
    Erwartet: Teams, Datum und Kickoff Zeit stimmen exakt überein.
    Status: bestanden durch Nutzer 2026-11-02

R8  Job mit expliziter Woche
    Vorbedingung: current.json zeigt auf die aktuelle Woche.
    Schritt: `npm run job:schedule -- --season 2026 --type 2 --week 9`, danach denselben Befehl ein zweites Mal.
    Erwartet: Exit Code 0, neue Datei data/weeks/2026-2-09.json mit season 2026, seasonType 2, week 9 in jedem Spiel. current.json und settings.json unverändert, Ausgabe "current.json nicht angepasst". Zweiter Lauf meldet alle Dateien als unverändert.
    Status: bestanden lokal 2026-11-02 (15 Spiele, 2 Bye Teams. Nebenbefund: teams.json wurde beim ersten Lauf neu geschrieben, weil ESPN für einzelne Teams andere Farbwerte lieferte)

R9  Pages URL lädt unter Unterpfad
    Vorbedingung: Pages auf "GitHub Actions" gestellt, pages.yml auf main grün.
    Schritt: https://<user>.github.io/AMF-Helper/ am Handy öffnen, Netzwerk Ansicht oder Neuladen prüfen.
    Erwartet: Seite Woche erscheint, Skripte, Styles und data/current.json werden unter /AMF-Helper/ geladen, kein HTTP 404.
    Status: lokaler Teil bestanden 2026-11-02 (Build mit BASE_PATH=/AMF-Helper/, Preview unter /AMF-Helper/ ohne fehlgeschlagene Anfragen). Auf GitHub bestanden 2026-11-02: https://laiken96.github.io/AMF-Helper/ zeigt Week 8, keine Konsolenfehler

R10 Daten Workflow committet nur bei Änderung
    Vorbedingung: data.yml auf main, mindestens ein erfolgreicher Lauf.
    Schritt: Workflow "Daten Spielplan" zweimal kurz hintereinander manuell starten, ausserhalb laufender Spiele.
    Erwartet: Erster Lauf committet nur, wenn ESPN neue Daten liefert. Zweiter Lauf meldet "Keine Änderungen unter data/", kein Commit, kein Pages Build. Bei einem Commit startet pages.yml.
    Status: lokaler Teil bestanden 2026-11-02 (zweiter Joblauf schreibt keine Datei, updatedAt in current.json bleibt gleich). Auf GitHub bestanden 2026-11-02: manueller Lauf committete geänderte Scores (4ea9965), Pages baute automatisch neu, neue Daten live. Fall ohne Änderung auf GitHub noch offen

R11 Fehlerfall Netz im Workflow
    Vorbedingung: data.yml auf main.
    Schritt: Lauf ansehen, bei dem ESPN nicht erreichbar war (oder Ausfall abwarten).
    Erwartet: Schritt "Spielplan holen" rot, kein Commit, die App zeigt weiter den letzten gültigen Stand mit altem Zeitstempel.
    Status: offen GitHub

R12 Stand der Daten sichtbar
    Vorbedingung: Normale Woche geladen.
    Schritt: Kopf der Seite Woche ansehen.
    Erwartet: Saison und Stand der Daten in Europe/Zurich, z. B. "Saison 2026 · Stand Mo., 02.11.2026, 03:18". Spiele nach Kickoff Slot gruppiert.
    Status: bestanden lokal 2026-11-02. Nebenbefund: Überschrift lautet englisch "Week 8", Rest der Seite deutsch

---

## Sprint 2 Tippliste

Jobprüfungen liefen in einer Kopie über `main(argv, deps)` aus jobs/build-tips.ts mit eigenem dataDir, simulierter Zeit (now) und gemocktem fetch auf Basis von tests/fixtures/espn-scoreboard-2026-w9.json. Ausgangslage war die Tippdatei data/tips/2026-2-09.json (alle Tipps ungesperrt, Grundtipps gesetzt).

R13 Sperre nach Kickoff
    Vorbedingung: Bestehende Tippdatei Week 9. Simulierte Zeit 2026-11-06T02:00Z, also nach dem Thursday Night Game JAX at BAL (01:15Z).
    Schritt: Job mit veränderter Quote laufen lassen: JAX at BAL neu BAL Favorit 8.5, DAL at IND neu nur DAL 1. Danach zweiter Lauf um 2026-11-08T15:00Z mit erneut anderer Quote für JAX at BAL.
    Erwartet: Exit Code 0. Tipp JAX at BAL bleibt inhaltlich unverändert (Quote 8.5 für JAX, Tipp JAX), nur locked true und lockedAt gesetzt. DAL at IND wird neu berechnet (pHome 0.4705, Lage unklar). Thursday Tiebreaker bleibt 26 zu 18 für JAX. Im zweiten Lauf bleibt der gesperrte Tipp byte gleich, CIN at ATL (14:30Z) wird zusätzlich gesperrt.
    Status: bestanden lokal 2026-11-02

R14 Grundtipp bleibt erhalten
    Vorbedingung: wie R13.
    Schritt: Nach den Läufen aus R13 und R15 firstPickTeamId aller Spiele mit der Ausgangsdatei vergleichen.
    Erwartet: firstPickTeamId ist bei allen 15 Spielen unverändert, auch bei gesperrten und bei Spielen mit neuer Quote.
    Status: bestanden lokal 2026-11-02. Nebenbefund: Wird eine Tippdatei neu angelegt und ist ein Spiel sofort eine Abweichung, wird der Aussenseiter als Grundtipp gespeichert (gesehen bei BUF at MIN mit 11 Punkten Rückstand). Nach D023 ist der Grundtipp der Favorit. Klärung durch Review oder Nutzer

R15 Quotenwechsel vor Kickoff dreht den Favoriten
    Vorbedingung: Bestehende Tippdatei Week 9, simulierte Zeit 2026-11-04T12:00Z (vor allen Spielen).
    Schritt: Quote CLE at NO von NO 3 auf CLE 3 drehen, Job laufen lassen.
    Erwartet: Tipp wechselt auf CLE (Team 5, 0.5879, unklar), firstPickTeamId bleibt NO (18), changedSinceFirst true. Kein anderes Spiel hat changedSinceFirst true. In der App erscheint beim Spiel der Hinweis "geändert seit Grundtipp".
    Status: Job bestanden lokal 2026-11-02. Hinweis in der App offen Nutzer (braucht echten Quotenwechsel in einer Spielwoche)

R16 Abweichungen an den Grenzen von D026
    Vorbedingung: data/standings.json im Job dataDir je Variante ersetzt, eigenes Kürzel JA.
    Schritt: Job für Week 9 und mit expliziter Woche für Week 15 und 16 laufen lassen. Varianten: in Führung, gleichauf mit der Spitze, Iststand 6 Punkte Rückstand auf CZ, 10, 11, 20 und 21 Punkte Rückstand in Week 9, 3 Punkte in Week 15, 2, 4 und 5 Punkte in Week 16.
    Erwartet: maxDeviations in Führung 0, gleichauf 0, Iststand 0, 10 Punkte Week 9 (genau 1 pro Restwoche) 0, 11 Punkte 1, 20 Punkte 1, 21 Punkte 2, 3 Punkte Week 15 0 (noch nicht letzte 3 Wochen), 2 Punkte Week 16 0, 4 und 5 Punkte Week 16 je 3. Abweichungen nur bei Lage unklar, aufsteigend nach Favoritenwahrscheinlichkeit, nie gesperrt. Massgebend ist der Spieler direkt vor JA, nicht Platz 1 (4 Punkte Rückstand mit Platz 1 weit vorne ergibt trotzdem 3).
    Status: bestanden lokal 2026-11-02

R17 Tiebreaker TNF und MNF
    Vorbedingung: Tippdatei Week 9 aus dem Job, App mit current.json auf Week 9.
    Schritt: Tiebreaker Box oben in der Ansicht Tipps prüfen, ebenso die Marke "Resultat tippen" in der Liste. Zusätzlich Job mit 11 Punkten Rückstand, wodurch MNF BUF at MIN zur Abweichung wird.
    Erwartet: Do JAX 26 zu 18 BAL (Spread 8.5, Over/Under 43.5), Mo BUF 25 zu 22 MIN (Spread 2.5, Over/Under 46.5). Marke nur bei diesen zwei Spielen. Bei Abweichung folgt das Resultat dem Tipp: MIN 25 zu 22 BUF. Thanksgiving und Doppel Monday Night mit echter Woche prüfen.
    Status: bestanden lokal 2026-11-02. Thanksgiving und Doppel Monday Night offen Nutzer

R18 Spiel ohne Quote
    Vorbedingung: Fixture Week 9, NYG at PHI und LAR at WSH ohne odds.
    Schritt: Job laufen lassen, App Week 9 öffnen. Zusätzlich MNF ohne Over/Under liefern.
    Erwartet: Beide Spiele mit Lage offen, pickTeamId und pHome null, in der App "keine Quote" und "offen", kein Prozentwert. MNF ohne Over/Under ergibt Standardwert 23 zu 20 für den Favoriten BUF (basis standard).
    Status: bestanden lokal 2026-11-02

R19 Fehlerfälle im Tippjob
    Vorbedingung: Bestehende Tippdatei Week 9, Prüfsummen des ganzen dataDir notiert.
    Schritt: Nacheinander (a) abgeschnittene standings.json, (b) ESPN Antwort ist HTML statt JSON, (c) ESPN Antwort ohne Spiele ohne explizite Woche, (d) kaputte bestehende Tippdatei.
    Erwartet: Jeweils Exit Code 1, alle Prüfsummen unverändert. Meldungen (a) "data/standings.json fehlt oder ist ungültig", (b) "Fehler beim Abruf" mit "Antwort ist kein JSON", (c) "nicht überschrieben, Antwort enthält keine Spiele", (d) "gesperrte Tipps würden verloren gehen".
    Status: bestanden lokal 2026-11-02

R20 Ansicht Tipps als Startseite
    Vorbedingung: Build und Preview wie oben, current.json auf Week 8.
    Schritt: Startseite ohne Hash öffnen, 390 px.
    Erwartet: Überschrift "Week 8 Tipps" laut current.json, Tiebreaker Box, Rangliste mit Kürzeln und erlaubten Abweichungen, 14 Spiele nach Slot gruppiert, abgelaufene Spiele mit Schloss "gesperrt". Keine horizontale Scrollleiste, keine Konsolenfehler.
    Status: bestanden lokal 2026-11-02. Nebenbefund: Rangliste zeigt "Rückstand auf Platz 1: 26 Punkte", D026 rechnet mit dem Spieler direkt vor dem Nutzer (6 Punkte). Text passt nicht zur Zahl der erlaubten Abweichungen

R21 Week 9 mit Quoten
    Vorbedingung: Week 9 Datei per `npm run job:schedule -- --season 2026 --type 2 --week 9` erzeugt und nach dist/data/weeks kopiert, dist/data/current.json auf week 9 und weekFile weeks/2026-2-09.json.
    Schritt: Startseite neu laden, Screenshot fullPage.
    Erwartet: "Week 9 Tipps", 15 Spiele, Tipp fett, (H) beim Heimteam, Prozent und Lage, Kickoff in Europe/Zurich (TNF "Fr 06.11. 02:15"). Keine Konsolenfehler.
    Status: bestanden lokal 2026-11-02

R22 Leerzustand ohne Tippdatei
    Vorbedingung: Build und Preview, dist/data/tips/2026-2-08.json temporär entfernt.
    Schritt: Startseite neu laden.
    Erwartet: Kopf "Week 8 Tipps" und Rangliste bleiben sichtbar, darunter "Für diese Woche gibt es noch keine Tipps." Kein Fehler, keine Konsolenfehler.
    Status: bestanden lokal 2026-11-02

R23 Häkchen eingetragen bleibt lokal
    Vorbedingung: Ansicht Tipps geladen.
    Schritt: Beim zweiten Spiel "eingetragen" anhaken, Seite neu laden, danach Haken entfernen und erneut neu laden.
    Erwartet: Haken bleibt nach dem Neuladen gesetzt, andere Spiele bleiben leer. Nach dem Entfernen bleibt er leer. Speicherung nur im localStorage des Browsers.
    Status: bestanden lokal 2026-11-02. Auf dem Handy des Nutzers offen Nutzer

R24 Hash Navigation Spielplan
    Vorbedingung: Build und Preview.
    Schritt: Direkt /AMF-Helper/#spielplan öffnen, dann auf "Tipps" tippen.
    Erwartet: Spielplan der Woche mit Resultaten, Reiter Spielplan aktiv. Klick auf Tipps zeigt wieder die Tippliste. Keine Konsolenfehler.
    Status: bestanden lokal 2026-11-02

R25 Tippjob im Workflow
    Vorbedingung: data.yml mit build-tips nach dem Spielplan Job auf main.
    Schritt: Workflow manuell starten, danach ein zweites Mal.
    Erwartet: data/tips/<woche>.json wird erzeugt und committet, der zweite Lauf ohne Änderung erzeugt keinen Commit. Pages zeigt die neue Tippliste.
    Status: offen GitHub

---

## Sprint 3 Web Push und Ausfall Wächter

Geprüft wurde Stand 3206fcf in einer Kopie. Für den echten Push wurde in der Kopie ein eigenes VAPID Testschlüsselpaar mit web-push erzeugt und src/core/push-config.ts nur dort ersetzt. App wie oben mit Build und Preview unter /AMF-Helper/, Playwright Chromium 390 x 844. Echter Push nur mit `chromium.launchPersistentContext` im neuen Headless Modus (`channel: "chromium"`) und `grantPermissions(["notifications"])`. Die Standard Headless Shell meldet Erlaubnis "blockiert" und bei erteilter Erlaubnis "push service not available", das ist der bekannte Headless Hinweis. Jobprüfungen über `main(argv, deps)` aus jobs/push.ts und jobs/watch.ts mit eigenem dataDir, simulierter Zeit, Week 9 aus tests/fixtures/espn-scoreboard-2026-w9.json (TNF JAX at BAL 2026-11-06T01:15Z), Summary Fixture 401873037 und gemocktem Versand. GITHUB_REF war refs/heads/main, sofern nicht anders vermerkt.

R26 Onboarding beim ersten Start
    Vorbedingung: Build und Preview, leerer localStorage.
    Schritt: Startseite öffnen, Einführung lesen, "Fertig" tippen, Seite neu laden. Zusätzlich mit gesperrtem localStorage (Zugriff wirft).
    Erwartet: Overlay "Willkommen bei NFL Tipps" mit 1. Erinnerungen per Push und 2. Push erlauben, keine horizontale Scrollleiste. Nach "Fertig" steht das Flag im localStorage, nach dem Neuladen kein Overlay. Mit gesperrtem Storage erscheint das Overlay, schliesst sich mit "Fertig" und die Tippliste ist bedienbar. Keine Konsolenfehler.
    Status: bestanden lokal 2026-11-02

R27 Onboarding iPhone mit Homescreen
    Vorbedingung: iPhone mit iOS 16.4 oder neuer, Pages URL in Safari.
    Schritt: Seite in Safari öffnen, Einführung lesen. Danach Teilen, Zum Home Bildschirm, App NFL Tipps vom Home Bildschirm öffnen, Einführung oder Einstellungen öffnen und "Push erlauben" tippen.
    Erwartet: In Safari Schritt 2. iPhone mit Anleitung Teilen, Zum Home Bildschirm und Hinweis "Push ist erst möglich, wenn die App vom Home Bildschirm aus geöffnet wird". Vom Home Bildschirm aus fragt iOS nach Mitteilungen, danach erscheint die lokale Testnachricht und die Anmeldung als JSON mit Kopierknopf. Einstellungen zeigen Modus "App vom Home Bildschirm".
    Status: lokaler Teil bestanden 2026-11-02 (iPhone User Agent zeigt Schritt 2. iPhone mit Anleitung). Am Gerät offen Nutzer

R28 Einstellungen mit Status
    Vorbedingung: Build und Preview, Onboarding geschlossen.
    Schritt: Reiter Einstellungen öffnen. In der Standard Headless Shell "Push erlauben" tippen. Im neuen Headless Modus mit erteilter Erlaubnis erneut, danach "Anmeldung kopieren".
    Erwartet: Status listet Erlaubnis, Anmeldung, Service Worker und Modus. Ohne Erlaubnis: "Erlaubnis blockiert, Anmeldung keine, Service Worker aktiv" und Meldung "Die Erlaubnis wurde nicht erteilt." Mit Erlaubnis: lokale Testnachricht "NFL Tipps" erscheint, Anmeldung als JSON mit Endpoint des Push Dienstes, Kopieren meldet "Kopiert.", Anleitung zu Settings, Secrets and variables, Actions, Name PUSH_SUBSCRIPTION und Link auf die Secrets Seite. Knöpfe "Testnachricht" und "Neu anmelden" sichtbar.
    Status: bestanden lokal 2026-11-02

R29 Manifest und Service Worker unter Unterpfad
    Vorbedingung: Build mit BASE_PATH=/AMF-Helper/.
    Schritt: Startseite laden, Registrierung und Manifest im Browser auslesen.
    Erwartet: Manifest /AMF-Helper/manifest.webmanifest mit HTTP 200 und Typ application/manifest+json, Name "NFL Tipps", display standalone, start_url und scope ergeben /AMF-Helper/, Icons /AMF-Helper/icons/icon-192.png und icon-512.png. Service Worker /AMF-Helper/sw.js aktiv mit Scope /AMF-Helper/. Keine fehlgeschlagene Anfrage.
    Status: bestanden lokal 2026-11-02. Auf Pages offen GitHub

R30 Echter Push Ende zu Ende lokal
    Vorbedingung: Testschlüsselpaar in der Kopie, App im neuen Headless Modus über "Push erlauben" angemeldet, Anmeldung aus dem Textfeld übernommen.
    Schritt: `VAPID_PRIVATE_KEY=<test> PUSH_SUBSCRIPTION=<json> npm run job:push -- --test` (lokal mit NODE_USE_ENV_PROXY=1 wegen Proxy). Danach push main mit Week 9 Daten und Zeit 30 Minuten vor TNF. Gegenproben mit falschem privaten Schlüssel und verändertem Endpoint.
    Erwartet: "Testnachricht gesendet.", Exit 0, im Browser erscheint "Test aus GitHub Actions" über den Service Worker. Der Lauf vor TNF sendet "Tippliste W9 bereit" und "Tippschluss in 30 min / JAX@BAL. Keine Änderung", beide kommen im Browser an, push-log.json wird geschrieben. Falscher Schlüssel ergibt HTTP 403 und Exit 1, veränderter Endpoint echte Antwort HTTP 410 mit Text "Anmeldung abgelaufen" und Exit 1.
    Status: bestanden lokal 2026-11-02. Hinweis: direkt nach der ersten Anmeldung kam die Nachricht innerhalb von 30 Sekunden nicht an, nach erneutem Start des Browsers mit derselben Anmeldung innert Sekunden. Erste Zustellung kann verzögert sein

R31 Testnachricht am Handy
    Vorbedingung: R27 erledigt, App vom Home Bildschirm angemeldet.
    Schritt: In Einstellungen "Testnachricht" tippen, App schliessen, Sperrbildschirm ansehen.
    Erwartet: Mitteilung "NFL Tipps" mit Testtext erscheint. Tippen auf die Mitteilung öffnet die App in Einstellungen.
    Status: Push Empfang am iPhone bestanden 2026-11-02 über R33. Lokale Testnachricht aus den Einstellungen offen Nutzer

R32 Secret PUSH_SUBSCRIPTION einrichten
    Vorbedingung: Anmeldung aus R27 kopiert, Secret VAPID_PRIVATE_KEY bereits im Repo.
    Schritt: Link "Direkt zu den Secrets auf GitHub" öffnen, New repository secret, Name PUSH_SUBSCRIPTION, Wert einfügen, speichern.
    Erwartet: Unter Actions secrets stehen VAPID_PRIVATE_KEY und PUSH_SUBSCRIPTION. Kein Schlüssel oder Anmelde JSON im Repo oder im Log eines Laufs. Nach "Neu anmelden" muss das Secret ersetzt werden.
    Status: bestanden durch Nutzer 2026-11-02

R33 Testlauf workflow_dispatch test true
    Vorbedingung: R32 erledigt, push.yml auf dem Branch oder auf main.
    Schritt: Workflow "Push und Ausfall Wächter" manuell mit test true starten.
    Erwartet: Nur der Schritt "Testnachricht senden" läuft, Ausgabe "Testnachricht gesendet.", Lauf grün, am Handy kommt "Test aus GitHub Actions". Kein Commit, push-log.json unverändert. Mit ungültigem Secret rot mit "PUSH_SUBSCRIPTION ist kein gültiges Anmelde JSON" ohne Inhalt des Secrets.
    Status: bestanden auf GitHub 2026-11-02 (Lauf 41384349660, nur Testschritt, Nachricht am iPhone angekommen)

R34 Tippliste bereit genau einmal
    Vorbedingung: Week 9 Tippdatei mit Quoten, leeres push-log.
    Schritt: push main um 2026-11-03T12:00Z, danach zweiter Lauf um 12:10Z.
    Erwartet: Erster Lauf sendet genau "Tippliste W9 bereit" mit "15 Spiele, 2 Abw: GB MIN. TB TNF JAX@BAL 26:18, MNF BUF@MIN 22:25" und schreibt tips-ready:2026-2-9 ins push-log. Zweiter Lauf "Keine Meldung fällig.", nichts gesendet.
    Status: bestanden lokal 2026-11-02

R35 Slot Fenster
    Vorbedingung: wie R34, Tippliste bereits gemeldet, Kopie des push-log je Zeitpunkt.
    Schritt: push main bei 61, 60, 30, 15, 14, 2 und 1 Minuten vor TNF.
    Erwartet: 61 Minuten nichts. 60, 30, 15, 14 und 2 Minuten je genau "Tippschluss in X min" mit "JAX@BAL. Keine Änderung". 1 Minute nichts.
    Status: bestanden lokal 2026-11-02 für das Fenster 2 bis 60 Minuten aus 3206fcf. Abweichung: Sprint Auftrag und Abnahmekriterien nennen 15 bis 60 Minuten. Die Untergrenze 2 ("lieber spät als gar nicht") ist noch nicht in DECISIONS.md festgehalten, Entscheid nachtragen oder zurück auf 15

R36 Keine Doppelmeldung
    Vorbedingung: wie R34.
    Schritt: push main bei 50, 40 und 20 Minuten vor TNF mit demselben push-log.
    Erwartet: Nur der Lauf bei 50 Minuten sendet "Tippschluss in 50 min". Die Läufe bei 40 und 20 Minuten senden nichts. push-log enthält genau tips-ready:2026-2-9 und slot:2026-11-06T02:15+01:00.
    Status: bestanden lokal 2026-11-02

R37 Keine Meldung nach Kickoff
    Vorbedingung: push-log ohne Slot Eintrag.
    Schritt: push main 0, 5 und 60 Minuten nach TNF Kickoff. Zusätzlich 30 Minuten vor Kickoff mit Spielstatus in_progress.
    Erwartet: Keine Slot Meldung in allen Fällen.
    Status: bestanden lokal 2026-11-02

R38 Fehlende Secrets und Lauf ausserhalb von main
    Vorbedingung: Slot Meldung fällig.
    Schritt: push main ohne Secrets, nur mit VAPID_PRIVATE_KEY, nur mit PUSH_SUBSCRIPTION, dann mit beiden Secrets und GITHUB_REF refs/heads/claude/x. Zusätzlich `--test` ohne Secrets.
    Erwartet: Jeweils Exit 0, nichts gesendet, kein push-log geschrieben. Meldungen "Secrets VAPID_PRIVATE_KEY oder PUSH_SUBSCRIPTION fehlen, nichts gesendet, push-log unverändert." bzw. "Kein Versand auf refs/heads/claude/x, nur refs/heads/main sendet." Die Testnachricht ohne Secrets meldet "keine Testnachricht gesendet".
    Status: bestanden lokal 2026-11-02. Folge: echte Slot Meldungen kommen erst nach dem Merge auf main, auf dem Branch geht nur die Testnachricht

R39 Abgelaufene Anmeldung
    Vorbedingung: Slot Meldung und Tippliste fällig, beide Secrets gesetzt.
    Schritt: Versand antwortet mit HTTP 410, dann 404, dann 500. Zusätzlich erste Meldung erfolgreich und zweite mit 410.
    Erwartet: 410 und 404 ergeben Exit 1 mit "HTTP 410: Anmeldung abgelaufen, im Onboarding neu anmelden und Secret ersetzen" (bzw. 404), Abbruch nach dem ersten Fehler, kein push-log. 500 ergibt Exit 1 mit "Senden fehlgeschlagen HTTP 500" für jede Meldung. Im gemischten Fall steht nur die erfolgreiche Meldung im push-log, Exit 1. Im Workflow wird der Lauf am Ende im Schritt "Fehler melden" rot.
    Status: bestanden lokal 2026-11-02 (gemockt und einmal echt gegen den Push Dienst, siehe R30). Auf GitHub offen GitHub

R40 Grundstand
    Vorbedingung: Week 9, nur TNF offen, keine Ausfall Datei.
    Schritt: watch main um 2026-11-05T04:59Z (Mittwoch 23:59 New York), 05:03Z (Donnerstag 00:03), 20:13Z mit geändertem Status, 21:13Z mit HTTP 503. Separat: erster Lauf ab Donnerstag mit HTTP 503.
    Erwartet: baselineFrom 2026-11-05T05:00:00Z (Normalzeit nach dem 1.11.). Mittwoch baseline null. Donnerstag Grundstand mit takenAt 05:03Z und 8 Schlüsselspielern (QB BAL Jackson Out, Huntley Questionable, Fagnano Out und Leader beider Teams). Spätere Läufe lassen den Grundstand byte gleich, auch bei 503 (Exit 1). Ist der erste Lauf ab Donnerstag unvollständig, bleibt baseline null mit "Grundstand nicht gesetzt, da nicht alle Spiele geladen wurden", Exit 1. Kaputte bestehende Ausfall Datei bleibt unverändert, Exit 1.
    Status: bestanden lokal 2026-11-02. Nebenbefund: data/injuries/2026-2-08.json hat einen Grundstand vom Montag 2026-11-02 nur mit dem MNF Spiel, weil der Wächter erst dann lief

R41 Statuswechsel in der Slot Meldung
    Vorbedingung: Grundstand aus R40 mit Tyler Huntley Questionable.
    Schritt: Summary mit Huntley Out laden, danach push main 45 Minuten vor TNF.
    Erwartet: changes enthält genau BAL Tyler Huntley QB wechsel von Questionable zu Out. Slot Meldung "Tippschluss in 45 min / JAX@BAL. BAL T.Huntley QB Q>O".
    Status: bestanden lokal 2026-11-02

R42 Reiter Tipps und Spielplan unverändert
    Vorbedingung: Build und Preview, Onboarding geschlossen.
    Schritt: Startseite, Reiter Spielplan, Reiter Tipps, direkt /AMF-Helper/#spielplan.
    Erwartet: Startseite "Week 8 Tipps", Spielplan "Week 8" mit Abschnitt Spielfrei, Rückweg zu Tipps klappt, Hash wechselt zu #spielplan und #tipps. Keine Konsolenfehler und keine Warnungen.
    Status: bestanden lokal 2026-11-02

R43 Echte Slot Meldung am Handy
    Vorbedingung: R32 erledigt, push.yml auf main, Spielwoche mit Tippdatei.
    Schritt: 15 bis 60 Minuten vor einem Kickoff Slot auf das Handy achten, danach Actions Log und data/push-log.json ansehen.
    Erwartet: Genau eine Mitteilung "Tippschluss in X min" pro Slot mit Spielen, Ausfällen oder "Keine Änderung". Tippen öffnet die Tippliste. push-log.json enthält den Slot Schlüssel, der nächste Lauf sendet nichts doppelt. Am Donnerstag kommt einmal "Tippliste bereit". Muss vor Thanksgiving 26.11. bestanden sein.
    Status: offen Nutzer

R44 Push Workflow auf main
    Vorbedingung: push.yml auf main, Secrets gesetzt.
    Schritt: Geplante Läufe einer Stunde ansehen.
    Erwartet: Läufe zu den Minuten 3, 13, 23, 33, 43, 53 (mit Cron Verzögerung). Commit "data: Push Log und Ausfälle aktualisiert" nur bei Änderung an data/push-log.json oder data/injuries. Kein Pages Neubau durch diese Commits. Gleichzeitiger data.yml Lauf führt nicht zu einem roten Push Schritt.
    Status: offen GitHub
