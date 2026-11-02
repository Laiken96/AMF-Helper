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

---

## Sprint 4 Wochenbilanz und Rangliste

Lokal geprüft auf Commit 65d83fe in einer Kopie. Simulierte Week 9: Wochendatei mit allen 15 Spielen final, Scores erfunden. DEN@CAR 20:20 (Unentschieden auf getippten DEN), Abweichung GB statt NE gewinnt 26:23, Abweichung MIN statt BUF verliert 19:27. current.json auf Week 9. Jobs liefen mit festem now 2026-11-10 (Dienstag) über einen kleinen tsx Aufruf von main.

R45 Bilanz komplett
    Vorbedingung: Tippdatei Week 9, Wochendatei Week 9 mit allen Spielen final, Review Week 8 vorhanden.
    Schritt: build-review mit now 2026-11-10T06:30Z, danach ein zweiter Lauf.
    Erwartet: data/reviews/2026-2-09.json mit complete true, points 9, tipped 13 (zwei Spiele offen ohne Tipp), deviationNet 0, Tiebreaker TNF diff 4 (getippt 18:26, Resultat 20:24) und MNF diff 11 (getippt 25:22, Resultat 19:27). index.json absteigend mit Week 9 vor Week 8. Zweiter Lauf schreibt nichts, Exit 0.
    Status: bestanden lokal 2026-11-02

R46 Unentschieden
    Vorbedingung: wie R45, getipptes Spiel endet 20:20.
    Schritt: Review und Reiter Bilanz ansehen.
    Erwartet: winnerTeamId null, correct false, zählt nicht als Punkt. In der App Spielkarte "20 : 20" mit "falsch". Ein Unentschieden bei einer Abweichung ergibt deviationEffect 0 (Unit Test).
    Status: bestanden lokal 2026-11-02

R47 Wirkung der Abweichungen
    Vorbedingung: wie R45.
    Schritt: Review und Reiter Bilanz ansehen.
    Erwartet: GB statt NE deviationEffect +1 und richtig, MIN statt BUF deviationEffect -1 und falsch, Netto 0. App zeigt "GB statt NE: +1", "MIN statt BUF: -1", "Netto 0".
    Status: bestanden lokal 2026-11-02

R48 Push Bilanz einmal
    Vorbedingung: Review Week 9 complete, leeres push-log, Versand gemockt mit Secrets und GITHUB_REF refs/heads/main.
    Schritt: push main zweimal hintereinander. Varianten mit leerem push-log: Week 8 und Week 9 complete, Week 9 offen und Week 8 complete, Week 10 und Week 9 offen und Week 8 complete.
    Erwartet: Erster Lauf genau eine Meldung "Bilanz W9 bereit" mit "App Punkte 9 von 13, Abweichungen netto 0, Tiebreaker Abweichung TNF 4, MNF 11. Rangliste melden", Link #bilanz, Schlüssel review-ready:2026-2-9 im push-log. Zweiter Lauf "Keine Meldung fällig". Beide complete: nur W9, keine Meldung für W8. Week 9 offen: W8 wird gemeldet (D033, neueste komplette der zwei neuesten). Week 10 und 9 offen: keine Bilanz Meldung.
    Status: bestanden lokal 2026-11-02. Nebenbefund: mit leerem push-log kommt am Dienstag zusätzlich "Tippliste W9 bereit" nach Wochenende, im Betrieb steht der Schlüssel schon im Log

R49 Formular nur Owner
    Vorbedingung: Event Datei mit gültigem Body Week 9, author_association CONTRIBUTOR. Zweite Event Datei vom Owner ohne Label rangliste.
    Schritt: `GITHUB_EVENT_PATH=<datei> COMMENT_FILE=<datei> npx tsx jobs/standings.ts` je Event.
    Erwartet: Exit 1, "Autor ist nicht der Repo Owner (CONTRIBUTOR)" bzw. "Label rangliste fehlt", kein Kommentar geschrieben, standings.json und standings-history.json byte gleich. Im Workflow verhindert zusätzlich die if Bedingung den Lauf.
    Status: bestanden lokal 2026-11-02

R50 Ablehnung mit Kommentar
    Vorbedingung: Owner Event Dateien mit Rangliste Week 8 als letztem Stand.
    Schritt: Body ohne Formular Struktur mit Shell Zeichen, Body null, Felder MS und DH "_No response_", JA 40 statt mindestens 45, Week 9 nochmals nach Übernahme (action edited), Week 10 mit LM 75 nach Week 9 mit LM 76.
    Erwartet: Jeweils Exit 1, Kommentar "Rangliste nicht übernommen, Issue bleibt offen." mit Grund je Feld, z. B. "MS: keine gültige Zahl (leer)", "JA: 40 Punkte ist weniger als 45 in Week 8", "Woche 9 ist nicht grösser als die zuletzt gemeldete Week 9", "LM: 75 Punkte ist weniger als 76 in Week 9". Dateien unverändert. Der Workflow postet den Kommentar und lässt das Issue offen.
    Status: bestanden lokal 2026-11-02 für den Job. Nebenbefunde: Rohwert im Kommentar kann Zeilenumbrüche enthalten und die Liste zerreissen. Kein Plausibilitätsdeckel, "1'000" Punkte für MS wurden übernommen. Eine übernommene Woche lässt sich per Formular nicht korrigieren. Kommentar und Schliessen auf GitHub offen GitHub

R51 Rangliste übernehmen und Tipps Week 10
    Vorbedingung: Rangliste Week 8 MS 71, LM 69, DH 68, CZ 51, JA 45.
    Schritt: Owner Event Week 9 mit MS 80, LM 76, DH 77, CZ 60, JA 54. Danach build-tips für Week 10. Zusätzlich mit JA 64.
    Erwartet: Exit 0, Kommentar "Rangliste 2026 Week 9 übernommen: MS 80, DH 77, LM 76, CZ 60, JA 54". standings.json asOfWeek 9 absteigend sortiert, standings-history.json mit Week 8 und Week 9. Tipps Week 10 maxDeviations 2 (26 Punkte Rückstand auf 9 Restwochen). Mit JA 64 maxDeviations 1 (16 auf 9).
    Status: bestanden lokal 2026-11-02

R52 Gruppenpunkte Differenz
    Vorbedingung: Build mit BASE_PATH, in dist/data die simulierte Week 9 mit Review und Rangliste Week 8 und Week 9.
    Schritt: Playwright 390 px, /AMF-Helper/#bilanz, danach Wochenwahl Week 8.
    Erwartet: "Week 9 Bilanz", "9 von 13", "Trefferquote 69 %", Gruppe Week 9 mit Woche MS 9, DH 9, CZ 9, JA 9 (hervorgehoben), LM 7 und Totals 80, 77, 60, 54, 76. Saisonverlauf Week 8 "?" und Week 9 Differenzen. Week 8 zeigt Zwischenstand und "Wochenpunkte fehlen, weil die Vorwoche nicht gemeldet ist". Keine horizontale Scrollbar, keine Konsolenfehler. Screenshot sprint4-week9-bilanz.png.
    Status: bestanden lokal 2026-11-02

R53 Hinweis Rangliste nicht gemeldet
    Vorbedingung: wie R52, aber Rangliste nur bis Week 8.
    Schritt: /AMF-Helper/#bilanz öffnen, Link prüfen.
    Erwartet: "Rangliste für Week 9 noch nicht gemeldet." mit Link "Rangliste für Week 9 melden" auf https://github.com/Laiken96/AMF-Helper/issues/new?template=rangliste.yml, neues Fenster mit noopener.
    Status: bestanden lokal 2026-11-02

R54 Leerzustand und Zwischenstand
    Vorbedingung: wie R52.
    Schritt: dist/data/reviews/index.json als leeres Array, danach Ordner reviews ganz entfernt. Zusätzlich Review Week 9 mit offenem MNF.
    Erwartet: Beide Leerfälle "Noch keine Bilanz vorhanden. Sie erscheint, sobald die erste Woche mit App Tipps gespielt ist.", keine Konsolenfehler. Zwischenstand "14 von 15 Spielen sind final", "MIN statt BUF: offen", "Resultat offen".
    Status: bestanden lokal 2026-11-02

R55 Andere Reiter mit Bilanz
    Vorbedingung: wie R52.
    Schritt: #tipps, #spielplan, #einstellungen, zurück #bilanz.
    Erwartet: "Week 9 Tipps", Spielplan "Week 9" mit Final Resultaten, Einstellungen mit Status, Bilanz wieder Week 9. Keine Konsolenfehler und keine Warnungen.
    Status: bestanden lokal 2026-11-02

R56 Rangliste per Formular am Handy melden
    Vorbedingung: standings.yml und rangliste.yml auf main, Label rangliste existiert, Week 9 komplett gespielt.
    Schritt: Am Handy in der Bilanz auf "Rangliste für Week 9 melden" tippen, Formular mit den 5 Gesamtpunkten absenden. Danach ein Issue mit absichtlich kleinerem Wert absenden und bearbeiten.
    Erwartet: Workflow läuft, committet "data: Rangliste aus Issue #N", kommentiert "übernommen", schliesst das Issue, startet Pages. Nach dem Build zeigt die Bilanz Gruppe Week 9 mit Wochenpunkten. Das fehlerhafte Issue bleibt offen mit Grund im Kommentar, nach Korrektur per Bearbeiten wird es übernommen. Am Dienstag kommt genau einmal "Bilanz W9 bereit".
    Status: offen Nutzer

---

## Sprint D Redesign Stil A

Lokale Prüfungen in einer Kopie des Repos mit Build `BASE_PATH=/AMF-Helper/`, vite preview und Playwright (chromium, Browser Zeitzone America/New_York, Service Worker blockiert). Week 9 per `npm run job:schedule` und `npm run job:tips` mit `--season 2026 --type 2 --week 9` in der Kopie geholt, dist/data/current.json auf Week 9 umgebogen. Jeder Schritt lief bei 390x844 (compact), 466x678 mit `?inset=84` (side), 669x951 (medium) und 951x669 (wide). Zeit simuliert mit page.clock oder einem Date Override per addInitScript. Screenshots unter scratchpad/qaD-shots.

R57 Duo zugeklappt am echten Gerät
    Vorbedingung: Sprint D auf main, Pages aktuell, iPhone Duo zugeklappt, App vom Home Bildschirm.
    Schritt: Tipps, Bilanz, Spielplan und Einstellungen öffnen, Liste ganz nach unten scrollen.
    Erwartet: Layout side mit senkrechter Navigation rechts vor dem reservierten Bereich, nichts liegt unter dem Systembereich rechts oder unten, kein waagrechtes Scrollen, letzte Spielzeile und Häkchen bedienbar.
    Status: bestanden durch Nutzer am iPhone Duo 2026-11-02

R58 Duo aufgeklappt quer und hoch am echten Gerät
    Vorbedingung: wie R57, Duo aufgeklappt.
    Schritt: Quer halten, Tipps öffnen, Spielbereich und Liste ansehen. Danach hoch halten.
    Erwartet: Quer Spielbereich links bis zum Falz, Liste rechts scrollt allein, Navigation senkrecht in der rechten Systemspalte. Hoch Spielbereich oben, Spiele zweispaltig, schwebende Kapsel unten. Kein Inhalt im Falz abgeschnitten.
    Status: bestanden durch Nutzer am iPhone Duo 2026-11-02

R59 Wechsel beim Auf und Zuklappen am echten Gerät
    Vorbedingung: wie R57, Tipps offen, Liste etwas gescrollt, ein Häkchen gesetzt.
    Schritt: Duo aufklappen, drehen (quer und hoch), wieder zuklappen, ohne neu zu laden.
    Erwartet: Layout wechselt jedes Mal ohne Neuladen, Häkchen und Umschalter bleiben, kein weisser Bildschirm. Liste springt an den Anfang (siehe Befund R67).
    Status: bestanden durch Nutzer am iPhone Duo 2026-11-02

R60 iPhone normal am echten Gerät
    Vorbedingung: Sprint D auf main, normales iPhone, App vom Home Bildschirm.
    Schritt: Alle vier Ziele der Navigation öffnen, Liste ganz nach unten scrollen, Häkchen setzen, Knopf "Auf der Tippseite eintragen" tippen.
    Erwartet: Schwebende Kapsel unten über dem Home Indikator, letzte Zeile darüber sichtbar, Schriften Barlow Condensed und Inter, Tippseite öffnet in neuem Tab.
    Status: bestanden durch Nutzer am iPhone Duo 2026-11-02

R61 Häkchen bleibt nach Neuladen
    Vorbedingung: Week 9 geladen, Zeit 02.11.2026 12:00 UTC, localStorage leer.
    Schritt: Umschalter auf Alle, erstes Häkchen (JAX) setzen, Seite neu laden.
    Erwartet: Häkchen bleibt gesetzt, Fortschritt "1 von 15 eingetragen", Umschalter "Offen 14 | Alle 15". Unter Offen ist JAX nicht mehr gelistet.
    Status: bestanden lokal 2026-11-02 in allen vier Grössen

R62 Warnung bei geändertem Tipp
    Vorbedingung: wie R61, JAX als eingetragen markiert.
    Schritt: In dist/data/tips/2026-2-09.json beim Spiel 401873037 pickTeamId von 30 auf 33 tauschen, Seite neu laden.
    Erwartet: In der Zeile erscheint "Tipp geändert, auf der Tippseite anpassen" (role alert), Häkchen nicht mehr gesetzt, Zeile gilt als offen ("Offen 15") und erscheint unter Offen.
    Status: bestanden lokal 2026-11-02 in allen vier Grössen. Screenshots 1-warnung-*.png

R63 Umschalter Offen und Alle
    Vorbedingung: wie R61.
    Schritt: Zähler vor und nach dem Häkchen lesen, Auswahl Alle wählen und neu laden, dann Offen wählen und neu laden.
    Erwartet: Offen zählt nicht gesperrte und nicht eingetragene Spiele plus Warnungen, Alle zählt alle 15. Die gewählte Kapsel ist nach dem Neuladen weiter aktiv (aria-pressed).
    Status: bestanden lokal 2026-11-02 in allen vier Grössen

R64 Spielbereich Wechsel nach Kickoff
    Vorbedingung: Week 9, Tippdatei ohne gesperrte Spiele.
    Schritt: Zeit auf 05.11.2026 20:00:30 UTC, Tipps öffnen. Danach die Uhr live über den Kickoff JAX at BAL (06.11. 01:15 UTC) laufen lassen. Zusätzlich direkt mit 06.11.2026 01:20 UTC laden.
    Erwartet: Vorher Spielbereich JAX at BAL mit TNF bzw. Thursday Night, Tipp JAX, Resultat 26 : 18. Nach dem Kickoff ohne Neuladen und nach frischem Laden CIN at ATL (So 08.11. 15:30, Tipp ATL, Countdown 2 T 13 h).
    Status: bestanden lokal 2026-11-02 in allen vier Grössen. Hinweis: Die Liste zeigt JAX at BAL weiter als offen ("Offen 15"), bis der Tippjob locked setzt. Das ist bestehende Logik aus Sprint 2, nicht Teil von Sprint D

R65 Spielbereich alle gesperrt
    Vorbedingung: wie R64.
    Schritt: Zeit auf 11.11.2026 12:00 UTC, Tipps öffnen.
    Erwartet: Spielbereich zeigt "Alle Tipps dieser Woche gesperrt" und "Der nächste Spielbereich erscheint mit der Tippliste der neuen Woche." Keine Konsolenfehler.
    Status: bestanden lokal 2026-11-02 in allen vier Grössen

R66 Countdown jede Minute
    Vorbedingung: wie R64, Date Override mit echten Timern, Start 05.11.2026 20:00:57 UTC.
    Schritt: Countdown lesen, 65 Sekunden warten, erneut lesen.
    Erwartet: Wechsel von "5 h 14 min" auf "5 h 12 min" (tatsächlich 5 h 12 min 58 s).
    Status: bestanden lokal 2026-11-02 mit Befund. Der Wert ändert sich, aber in 1 von 4 Läufen zeigte er "5 h 13 min", also eine Minute zu viel. Ursache: Der Minutentakt feuert genau am Minutenwechsel und Math.floor rundet bei einem minimal zu frühen Timer auf die alte Minute. Mit page.clock tritt das immer auf (erster Wechsel erst nach 2 Minuten). Niedrig

R67 Layoutwechsel zur Laufzeit
    Vorbedingung: Tipps bei 669x951, Umschalter Alle, Liste bis Zeile 10 gescrollt.
    Schritt: setViewportSize auf 951x669, in der Liste scrollen, zurück auf 669x951. Zusätzlich 466x678 mit Inset 84 nach 951x669.
    Erwartet: data-layout wechselt medium, wide, medium bzw. side, wide ohne Neuladen (Marker im window bleibt), kein waagrechtes Scrollen, keine Konsolenfehler. Liste behält eine sinnvolle Position.
    Status: bestanden lokal 2026-11-02 mit Befund. Bei jedem Wechsel springt die Liste an den Anfang, weil der scrollende Bereich wechselt (Seite, .page bzw. .pane-list). Häkchen und Filter bleiben. Niedrig. Screenshots 3-*.png

R68 Letzte Spielzeile sichtbar
    Vorbedingung: Tipps, Umschalter Alle.
    Schritt: Alle scrollenden Bereiche ganz nach unten, Lage der letzten Zeile (MIN vs BUF) gegen die Navigation messen und Häkchen per elementFromPoint prüfen. Dasselbe im Spielplan.
    Erwartet: Letzte Zeile ganz im Bild, überlappt die Navigation nicht, Häkchen ist klickbar. 390x844 Unterkante 740, Kapsel ab 768. 466x678 Zeile endet rechts bei 372, Kapsel ab 396. 669x951 Unterkante 847, Kapsel ab 875. 951x669 Zeile endet rechts bei 863, Kapsel ab 887.
    Status: bestanden lokal 2026-11-02. Screenshots 4-letzte-zeile-*.png und 4-spielplan-ende-*.png

R69 Tastatur und Fokus
    Vorbedingung: Tipps, Onboarding gesehen.
    Schritt: 40 mal Tab, aktives Element und Fokusrahmen protokollieren.
    Erwartet: Reihenfolge Knopf "Auf der Tippseite eintragen", "Offen", "Alle", Häkchen der Spiele, danach Navigation Tipps, Bilanz, Spielplan, Einstellungen. Jedes Ziel mit sichtbarem Fokus und im Bild.
    Status: bestanden lokal 2026-11-02 in allen vier Grössen. Nebenbefund 390x844: Ein fokussiertes Häkchen am unteren Rand liegt neben der schwebenden Kapsel, die Prozentangabe der Zeile ist dabei verdeckt (kein scroll-padding). Niedrig. Screenshots 5-fokus-haekchen-*.png

R70 Einstellungen, Onboarding, Bilanz und Spielplan
    Vorbedingung: localStorage leer.
    Schritt: Startseite öffnen, Onboarding lesen und mit "Fertig" schliessen. Einstellungen öffnen, "Einführung erneut anzeigen" und schliessen. Bilanz und Spielplan öffnen.
    Erwartet: Onboarding "Willkommen bei NFL Tipps" mit Knöpfen Schliessen, Push erlauben, Fertig. Einstellungen mit Status, Push erlauben und Einführung erneut anzeigen. Bilanz Week 8 mit Zwischenstand und App Punkten. Spielplan Week 9 ab JAX @ BAL. Kein waagrechtes Scrollen, keine Konsolenfehler.
    Status: bestanden lokal 2026-11-02 in allen vier Grössen. Screenshots 6-*.png

R71 Schriften selbst gehostet
    Vorbedingung: wie R70.
    Schritt: Alle Anfragen beim Durchklicken von Tipps, Einstellungen, Bilanz und Spielplan protokollieren.
    Erwartet: Keine Anfrage an fonts.googleapis.com oder fonts.gstatic.com. Die woff2 Dateien unter /AMF-Helper/fonts/ laden mit HTTP 200, document.fonts meldet Inter 400, 600, 700 und Barlow Condensed 600, 700, 800 als geladen.
    Status: bestanden lokal 2026-11-02. Auf GitHub Pages erneut prüfen (offen GitHub)

R72 Duo Systemanzeige verdeckt keine Bedienelemente
    Vorbedingung: Duo aufgeklappt quer oder zugeklappt, App vom Home Bildschirm.
    Schritt: Rechte Spalte ansehen.
    Erwartet: Uhrzeit, WLAN und Batterie von iOS stehen oben frei. Werkzeugkapsel (Aktualisieren, Glocke) und Navigation sitzen unten gestapelt, nichts überlappt. Lokal mit ?inset=84 bei 951x669: Werkzeugkapsel beginnt bei y 319, Navigation endet bei y 653.
    Status: bestanden lokal und durch Nutzer am iPhone Duo 2026-11-02

---

## Ausbau Sprint 5 bis 8 (Wochen blättern, Liveticker, News, KI Zweitmeinung)

Lokale Prüfungen am 2026-11-02 in einer Kopie des Repos (scratchpad/qaAusbau, node_modules per Symlink) auf Stand 1b94a15. In der Kopie typecheck und 272 Tests grün, Build mit `BASE_PATH=/AMF-Helper/`, vite preview und Playwright (chromium, Service Worker blockiert, Browser Zeitzone Europe/Zurich). Jobs mit echtem Netz und zusätzlich über `main(argv, deps)` mit gemocktem fetch bzw. gemocktem Anthropic Client. App Schritte liefen bei 390x844 (compact), 466x678 mit `?inset=84` (side), 669x951 (medium) und 951x669 (wide). current.json und Week 9 Ergebnisse wurden nur per Playwright route umgebogen, ESPN Scoreboard und Summary per route simuliert, ein XSS Testeintrag nur in dist/data/news.json. Zeit per page.clock. Screenshots unter scratchpad/qaAusbau-shots.

R73 News Job zweimal ohne Duplikate
    Vorbedingung: Kopie mit data/news.json aus dem Repo (103 Einträge).
    Schritt: `npm run job:news` zweimal mit echtem Netz. Danach mit gemocktem fetch 3 Feeds mit je 82 Einträgen inklusive doppelter URL (mit und ohne Schrägstrich am Ende, utm Parameter) zweimal laufen lassen.
    Erwartet: Echtes Netz: CBS 36 und PFT 30 Einträge, Datei unverändert, 103 Einträge mit 103 eindeutigen URLs und IDs. Mock: erster Lauf schreibt genau 150 Einträge (51 ESPN, 50 CBS, 49 PFT), doppelte URL nur einmal, zweiter Lauf meldet "unverändert", Datei bytegleich. Titel und Anriss ohne HTML (aus "<b>bold</b>" wird "bold", img entfernt), Team Erkennung "Chiefs" und "Kansas City" ergibt KC.
    Status: bestanden lokal 2026-11-02

R74 News Job mit kaputter Quelle
    Vorbedingung: wie R73.
    Schritt: Mock mit ESPN Verbindungsfehler und CBS mit HTML statt RSS, PFT gültig. Zusätzlich echter Lauf (ESPN liefert lokal HTTP 202 WAF challenge).
    Erwartet: Fehlermeldung je Quelle ("ECONNREFUSED", "Kein RSS Dokument", "HTTP 202 Accepted (WAF challenge)"), PFT läuft weiter, bisherige Einträge der kaputten Quellen bleiben, Exit 0. Exit 1 nur, wenn alle drei scheitern.
    Status: bestanden lokal 2026-11-02. Befund niedrig: Fällt ESPN dauerhaft aus, bleiben die alten ESPN Einträge stehen, bis sie durch die Grenze von 150 verdrängt werden

R75 ESPN RSS in GitHub Actions
    Vorbedingung: Ausbau auf main, Workflow NFL Daten läuft.
    Schritt: Log des Schritts News im nächsten Lauf lesen, data/news.json ansehen.
    Erwartet: Mindestens CBS und PFT liefern. Wenn ESPN mit 202 oder 403 scheitert, steht die Meldung im Log, der Schritt bleibt grün (D043 Risiko).
    Status: offen GitHub

R76 Spielplan Job mit nächsten Wochen und Wochenindex
    Vorbedingung: Kopie, current.json auf Week 8.
    Schritt: `npm run job:schedule`, danach `npm run job:index`, Datei Referenzen des Index gegen das Dateisystem prüfen.
    Erwartet: current.json bytegleich (Week 8). Kommende Woche 9 mit 15 und Woche 10 mit 14 Spielen geholt. data/weeks/index.json enthält Wochen 8, 9, 10. Week 8 mit weekFile, tipsFile, reviewFile, Week 9 mit weekFile und tipsFile, Week 10 nur weekFile, tipsFile null. Jede genannte Datei existiert.
    Status: bestanden lokal 2026-11-02. Befund niedrig: opinionFile im Index wird nur im stündlichen Datenjob nachgeführt, die Meinungen schreibt aber der Push Workflow. Der Index hinkt bis zu einer Stunde nach. Ohne Folge, solange die App Meinungen nicht zeigt

R77 KI Zweitmeinung ohne Key
    Vorbedingung: Kopie, ANTHROPIC_API_KEY nicht gesetzt.
    Schritt: `npm run job:opinion`.
    Erwartet: Meldung "Secret ANTHROPIC_API_KEY fehlt, keine KI Zweitmeinung erzeugt.", Exit 0, kein Ordner data/opinions.
    Status: bestanden lokal 2026-11-02

R78 KI Zweitmeinung im Fenster, nie überschrieben
    Vorbedingung: Kopie mit Week 9 Tippdatei, gemockter Client über main(argv, deps) mit Suchergebnis und submit_opinion.
    Schritt: Lauf am 05.11.2026 20:15 UTC (5 h vor JAX at BAL). Zweiter Lauf 10 Minuten später mit anderem Sieger im Mock.
    Erwartet: Erster Lauf schreibt opinions/2026-2-09.json mit 1 Meinung (JAX 0.64, Markt JAX 0.7355, 1 Quelle) und attempts.json, Kostenzeile im Log (Modell claude-haiku-5-5). Zweiter Lauf: "Keine Meinung fällig.", kein API Aufruf, Datei bytegleich.
    Status: bestanden lokal 2026-11-02

R79 KI Zweitmeinung nach Kickoff und ausserhalb 6 Stunden
    Vorbedingung: wie R78, frische Kopie der Daten.
    Schritt: Lauf am 06.11.2026 01:20 UTC (nach Kickoff TNF) und am 05.11.2026 18:00 UTC (7 h vorher).
    Erwartet: Beide Male "Keine Meinung fällig.", kein API Aufruf, keine Meinungsdatei.
    Status: bestanden lokal 2026-11-02

R80 KI Zweitmeinung ohne gültige Quelle
    Vorbedingung: wie R78.
    Schritt: Mock antwortet mit einer Quelle, deren URL nicht in den Suchergebnissen steht. Drei Läufe im Abstand von 10 Minuten. Zusätzlich Antwort ohne jede Websuche.
    Erwartet: "verworfen, keine belegte Quelle", keine Meinungsdatei, attempts.json zählt 1 und 2. Dritter Lauf ruft die API nicht mehr auf (höchstens 2 Versuche). Exit 0.
    Status: bestanden lokal 2026-11-02. Befund kosmetisch: Logzeile lautet "verworfen, keine belegte Quelle, verworfen"

R81 KI Zweitmeinung mit echtem Key
    Vorbedingung: Secret ANTHROPIC_API_KEY im Repo gesetzt, Push Workflow läuft alle 10 Minuten (D041), Week 9 Tippliste mit Quoten.
    Schritt: Ab Donnerstag 05.11. ca. 19:15 UTC Log des Schritts Meinung lesen, data/opinions/2026-2-09.json nach dem Lauf öffnen, Quellen Links anklicken.
    Erwartet: Genau eine Meinung pro Spiel, erzeugt weniger als 6 Stunden vor Kickoff, deutsche Begründung in 2 bis 3 Sätzen, jede Quelle öffnet einen echten Artikel. Kostenzeile pro Lauf, Woche unter 1.10 USD. Spätere Läufe ändern bestehende Meinungen nicht. Die App zeigt keine Meinung.
    Status: offen Nutzer

R82 Bilanz Vergleich Markt gegen KI
    Vorbedingung: Kopie, Week 9 als aktuelle Woche, alle 15 Spiele final simuliert (1 Unentschieden), 14 Meinungen, davon 4 mit anderem Sieger als der Markt, ein Spiel ohne Meinung.
    Schritt: build-review main mit Zeit 11.11.2026 12:00 UTC, Ergebnis gegen unabhängig gerechnete Sollwerte vergleichen.
    Erwartet: opinionCompare opinions 14, scored 13 (Unentschieden nicht gewertet), marketHits 9, aiHits 7, marketHitRate 0.6923, aiHitRate 0.5385, marketBrier 0.2286, aiBrier 0.24, disagreements mit den 4 erwarteten Spiel IDs inklusive Sieger. Log "KI Vergleich: 13 gewertet, Markt 9, KI 7, 4 abweichend". Bilanz komplett.
    Status: bestanden lokal 2026-11-02. Hinweis: marketBrier zählt nur Spiele mit marketProb, aiBrier alle gewerteten. Bei fehlender Marktquote sind die Nenner verschieden

R83 Push Tippliste bereit nur offene Spiele
    Vorbedingung: Week 9 Tippdatei mit 15 Spielen, 2 Abweichungen (CLE, MIN), Tiebreaker TNF und MNF.
    Schritt: tipsReadyMessage zu verschiedenen Zeiten auswerten.
    Erwartet: Do 12:00 UTC "15 Spiele, 2 Abw: CLE MIN. TB TNF JAX@BAL 26:18, MNF BUF@MIN 22:25". Nach TNF Kickoff (gesperrt oder nur Kickoff vorbei) "14 Spiele" ohne TNF Tiebreaker. Spiel mit Status in zählt nicht. So 20:00 UTC "6 Spiele, 1 Abw: MIN". Nach allen Kickoffs keine Meldung.
    Status: bestanden lokal 2026-11-02

R84 Wochenwähler vor und zurück
    Vorbedingung: Originaldaten (aktuell Week 8, Index 8 bis 10), Zeit 02.11.2026 13:00 UTC.
    Schritt: In Tipps und Spiele zweimal "Nächste Woche", dann zweimal "Vorherige Woche". In Bilanz dasselbe versuchen.
    Erwartet: Tipps und Spiele W8, W9, W10, W9, W8, Hash #tipps/2026-2-10 bzw. #spiele/2026-2-10, an den Enden ist der Pfeil deaktiviert. Bilanz zeigt nur Wochen mit Bilanzdatei, hier nur W8 mit beiden Pfeilen deaktiviert (D044).
    Status: bestanden lokal 2026-11-02 in allen vier Grössen, 18 Wiederholungen stabil

R85 Wochenwahl per Hash
    Vorbedingung: wie R84.
    Schritt: Direkt laden #tipps/2026-2-10, #spiele/2026-2-10, #tipps/2026-2-9, #tipps/2026-2-99, #bilanz/2026-2-9.
    Erwartet: W10 Tipps mit Hinweis, W10 Spielplan mit 14 Spielen, W9 mit 15 Häkchen (kommend mit Tippdatei), ungültige Woche ohne Absturz, Bilanz W9 "Für Week 9 gibt es noch keine Bilanz."
    Status: bestanden lokal 2026-11-02 in allen vier Grössen

R86 Vergangene Woche read only
    Vorbedingung: current.json per route auf Week 10, Week 9 per route komplett final (9 richtig, 5 falsch, 1 Unentschieden), Zeit 11.11.2026 12:00 UTC.
    Schritt: #tipps/2026-2-9 öffnen.
    Erwartet: 15 Ergebnis Marken richtig, falsch bzw. unentschieden, Kasten "9 von 15, Trefferquote 64 %", kein Häkchen, kein Filter Offen und Alle, kein Eingabefeld. Kein waagrechtes Scrollen.
    Status: bestanden lokal 2026-11-02 in allen vier Grössen. Hinweis: Die echte Week 8 zeigt nur 1 Ergebnis, weil 13 Spiele "nicht erfasst" sind (App startete mitten in Week 8). Screenshots s5-*.png

R87 Kommende Woche ohne Tipps
    Vorbedingung: Originaldaten und Variante aktuell Week 9.
    Schritt: #tipps/2026-2-10 öffnen. Zusätzlich aktuelle Woche ohne Tippdatei (current Week 10).
    Erwartet: Kommende Woche zeigt "Tipps folgen, sobald Quoten verfügbar sind." Aktuelle Woche ohne Datei zeigt "Für diese Woche gibt es noch keine Tipps." Kein Konsolenfehler.
    Status: bestanden lokal 2026-11-02 in allen vier Grössen

R88 Liveticker mit simuliertem laufenden Spiel
    Vorbedingung: current.json per route auf Week 9, Zeit 06.11.2026 02:00 UTC, Scoreboard per route mit JAX at BAL in Q3 4:12, 17 : 10, Ballbesitz JAX, "3rd & 4 at BAL 35", letzter Spielzug, Summary mit 14 Spielzügen.
    Schritt: Spiele öffnen, Karte antippen, Detail lesen, mit Escape schliessen. Tipps öffnen.
    Erwartet: Karte mit Score 17 : 10, Ballsymbol bei JAX, Down und Distanz, Q3 4:12, letzter Spielzug, Hinweis "Live, aktualisiert alle 20 Sekunden". Detail mit genau 10 Zügen, neuester zuerst (Nummer 14 bis 5). Spielbereich der Tipps zeigt "Läuft, Q3 4:12" mit JAX 17 und BAL 10 statt Countdown. Kein waagrechtes Scrollen.
    Status: bestanden lokal 2026-11-02 in allen vier Grössen. Screenshots s2-*.png

R89 Liveticker Fehler 500
    Vorbedingung: wie R88.
    Schritt: Scoreboard liefert nach einer erfolgreichen Abfrage HTTP 500, danach wieder gültig. Zusätzlich frisches Laden mit 500 ab Beginn.
    Erwartet: Letzter Stand 17 : 10 bleibt mit "Live Daten gerade nicht erreichbar. Angezeigt wird der Stand von ...", nach der nächsten gültigen Antwort wieder Live. Bei 500 ab Beginn Spielplan mit Hinweis, kein Absturz. Ausser den 500 Meldungen keine Konsolenfehler.
    Status: bestanden lokal 2026-11-02. Screenshot s3-fehler500-390x844.png

R90 Polling Stopp
    Vorbedingung: wie R88, page.clock installiert, document.visibilityState per addInitScript steuerbar.
    Schritt: Abfragen zählen über 2 mal 20 Sekunden. Tab verstecken, 65 Sekunden vorspulen, wieder sichtbar. Detail offen 20 Sekunden, dann versteckt 65 Sekunden. Scoreboard auf final stellen, 100 Sekunden vorspulen. Zusätzlich Originaldaten am Montag 13:00 UTC ohne laufendes Spiel.
    Erwartet: Abfragen 1, 2, 3 im Takt von 20 Sekunden. Versteckt keine Abfrage, sichtbar sofort eine. Summary 1, 2, dann versteckt keine weitere. Nach final keine Abfrage mehr. Ohne laufendes Spiel null Abfragen an ESPN in Tipps und Spiele.
    Status: bestanden lokal 2026-11-02 bei 390x844, ohne laufendes Spiel in allen vier Grössen

R91 Liveticker bei echtem laufenden Spiel
    Vorbedingung: Ausbau auf Pages, Sonntag mit laufenden Spielen, iPhone.
    Schritt: Spiele öffnen, 2 Minuten beobachten, ein Spiel antippen, App in den Hintergrund und zurück.
    Erwartet: Score und Uhr ändern sich ohne Neuladen, Ballbesitz und letzter Spielzug passen zur ESPN App, Detail zeigt 10 Spielzüge. Nach Spielende kein weiteres Polling. Keine CORS Fehler.
    Status: offen Nutzer (Sonntag)

R92 XSS in News
    Vorbedingung: dist/data/news.json mit Eintrag Titel `QA <img src=x onerror="window.__xss=1"> Chiefs <b>fett</b>` (dazu ein HTML Entity) und Anriss mit script und img onerror.
    Schritt: News öffnen.
    Erwartet: Titel und Anriss erscheinen als wörtlicher Text, kein img, script oder b Element in der Liste, window.__xss, __xss2, __xss3 bleiben undefiniert. Zusätzlich entfernt der News Job HTML schon beim Einlesen (R73).
    Status: bestanden lokal 2026-11-02 in allen vier Grössen. Screenshots s1-news-*.png

R93 News Filter
    Vorbedingung: Originaldaten plus Testeintrag (104 Einträge), Montag 13:00 UTC.
    Schritt: Meine Spiele wählen, zurück auf Alle, im Team Feld ein Team wählen. Link Ziel prüfen.
    Erwartet: Alle 104, Meine Spiele 5 (nur offenes MNF CHI at SEA), Team Auswahl zeigt nur Einträge mit Team Chip (z. B. 6), Links mit target _blank und rel noopener. Kein waagrechtes Scrollen.
    Status: bestanden lokal 2026-11-02 in allen vier Grössen

R94 Navigation mit 5 Zielen per Tastatur
    Vorbedingung: Tipps geöffnet.
    Schritt: Bis 120 mal Tab, Ziele in der Kapsel protokollieren, dann jedes Ziel fokussieren und Enter.
    Erwartet: Tipps, Bilanz, Spiele, News, Einstellungen erreichbar, Hash #tipps, #bilanz, #spiele, #news, #einstellungen. Kapsel ganz im Bild, auch bei 466x678 mit Inset 84.
    Status: bestanden lokal 2026-11-02 in allen vier Grössen

R95 Fehlende Index und News Datei
    Vorbedingung: weeks/index.json und news.json per route mit 404.
    Schritt: Tipps, Bilanz, Spiele und News öffnen.
    Erwartet: App wie vor dem Ausbau ohne Wochenwähler Blockade, News zeigt "Noch keine News vorhanden. Sie erscheinen nach dem nächsten Datenlauf." Kein Seitenfehler.
    Status: bestanden lokal 2026-11-02 bei 390x844

R96 Konsole und waagrechtes Scrollen
    Vorbedingung: alle Durchläufe R84 bis R95.
    Schritt: console error und pageerror sammeln, scrollWidth gegen clientWidth messen.
    Erwartet: Keine Konsolenfehler (ausser den gewollten 500 in R89), kein waagrechtes Scrollen in Tipps, Bilanz, Spiele, News.
    Status: bestanden lokal 2026-11-02 in allen vier Grössen

R97 Wochenwechsel Tempo und Einheitlichkeit
    Vorbedingung: App geöffnet, Week 8 bis 10 im Index.
    Schritt: In Tipps mit dem Wochenwähler 8, 9, 10 und zurück wechseln, auf iPhone und Duo quer.
    Erwartet: Wechsel ohne Leerzustand und ohne Flackern, unter 150 ms bei vorgeladenen Wochen. h1, Wochenwähler, Kacheln und erste Tippzeile in jeder Woche an gleicher Stelle und gleich gross (Toleranz 1 px). Kommende Woche ohne Quoten zeigt Spielbereich mit Hinweis und Zeilen mit "offen".
    Status: bestanden lokal 2026-11-02 (9 bis 27 ms), offen Nutzer am Gerät

R98 Hintergrundaktualisierung bei offener App
    Vorbedingung: App sichtbar geöffnet.
    Schritt: Tippdatei ändert sich auf dem Server (neue Quote).
    Erwartet: Änderung erscheint spätestens nach 5 Minuten oder sofort per Aktualisieren, ohne Leerzustand und Scrollsprung. Versteckter Tab löst keine Abrufe aus.
    Status: bestanden lokal 2026-11-02 (page.clock)

R99 Ungültiger API Schlüssel zählt nicht als Versuch
    Vorbedingung: Secret ANTHROPIC_API_KEY ungültig.
    Schritt: Push Wächter läuft im 6 Stunden Fenster eines Spiels.
    Erwartet: Fehler 401 im Log und in attempts.json, Lauf rot, Versuch wird nicht gezählt. Nach Korrektur des Secrets entsteht die Meinung im nächsten Lauf.
    Status: Fehlerfall echt auf GitHub beobachtet 2026-11-02 20:20 (CHI@SEA), Zählung lokal per Test bestanden, Erfolg nach Korrektur offen Nutzer

R100 Bilanz Wochenwähler
    Vorbedingung: Index mit Week 8 bis 10, Bilanz nur für Week 8.
    Schritt: In Bilanz vor und zurück blättern.
    Erwartet: Pfeile aktiv, Week 9 und 10 zeigen Hinweis "Bilanz folgt ..." im gleichen Aufbau, Wechsel ohne Leerzustand.
    Status: bestanden lokal 2026-11-02 (50 bis 91 ms)
