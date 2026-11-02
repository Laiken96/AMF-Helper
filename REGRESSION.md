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
    Status: offen Nutzer

R8  Job mit expliziter Woche
    Vorbedingung: current.json zeigt auf die aktuelle Woche.
    Schritt: `npm run job:schedule -- --season 2026 --type 2 --week 9`, danach denselben Befehl ein zweites Mal.
    Erwartet: Exit Code 0, neue Datei data/weeks/2026-2-09.json mit season 2026, seasonType 2, week 9 in jedem Spiel. current.json und settings.json unverändert, Ausgabe "current.json nicht angepasst". Zweiter Lauf meldet alle Dateien als unverändert.
    Status: bestanden lokal 2026-11-02 (15 Spiele, 2 Bye Teams. Nebenbefund: teams.json wurde beim ersten Lauf neu geschrieben, weil ESPN für einzelne Teams andere Farbwerte lieferte)

R9  Pages URL lädt unter Unterpfad
    Vorbedingung: Pages auf "GitHub Actions" gestellt, pages.yml auf main grün.
    Schritt: https://<user>.github.io/AMF-Helper/ am Handy öffnen, Netzwerk Ansicht oder Neuladen prüfen.
    Erwartet: Seite Woche erscheint, Skripte, Styles und data/current.json werden unter /AMF-Helper/ geladen, kein HTTP 404.
    Status: lokaler Teil bestanden 2026-11-02 (Build mit BASE_PATH=/AMF-Helper/, Preview unter /AMF-Helper/ ohne fehlgeschlagene Anfragen). Echte Pages URL offen GitHub

R10 Daten Workflow committet nur bei Änderung
    Vorbedingung: data.yml auf main, mindestens ein erfolgreicher Lauf.
    Schritt: Workflow "Daten Spielplan" zweimal kurz hintereinander manuell starten, ausserhalb laufender Spiele.
    Erwartet: Erster Lauf committet nur, wenn ESPN neue Daten liefert. Zweiter Lauf meldet "Keine Änderungen unter data/", kein Commit, kein Pages Build. Bei einem Commit startet pages.yml.
    Status: lokaler Teil bestanden 2026-11-02 (zweiter Joblauf schreibt keine Datei, updatedAt in current.json bleibt gleich). Workflow selbst offen GitHub

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
