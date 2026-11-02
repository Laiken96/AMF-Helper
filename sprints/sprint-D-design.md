# Sprint D Redesign Stil A Flutlicht

## Ziel
Die App sieht auf iPhone, iPhone Duo zugeklappt, aufgeklappt quer und aufgeklappt hoch aus wie die Entwürfe in sprints/design-referenz/, ohne Änderung an Logik oder Daten.

## Kontext
CLAUDE.md, DECISIONS.md D035 bis D039. Referenzen (statische Entwürfe, Werte sind Beispieldaten): sprints/design-referenz/Main.dc.html (iPhone Tipps), A-Bilanz.dc.html (Bilanz, Navigation dort ist veraltet, Kapsel verwenden), Duo-Zu.dc.html (466 mal 678), Duo-Quer.dc.html (951 mal 669), Duo-Offen.dc.html (669 mal 951). Die Dateien sind HTML mit Inline Styles, Platzhalter in {{ }} und Daten im Skript unten.

## Design Tokens
- Hintergrund #0B0E13, Fläche #171B22, Fläche 2 #1C2129, aktiv #3A414D, Linie #2A303A
- Text #F2F4F7, Text 2 #D5DAE1, Text 3 #AEB6C2
- Akzent #F5B83D, klar #3DDC97, favorit #8FB7FF, unklar #F5B83D, Fehler #FF8A8A
- Schriften: Barlow Condensed 600/700/800 für Zahlen, Kürzel, Titel, Inter 400 bis 700 für Text, selbst gehostet als woff2 unter public/fonts (von Google Fonts Download oder npm Paket @fontsource, Lizenz OFL beilegen)
- Radien 14 Karten, 22 Spielbereich, 999 Kapseln. Touch Ziele mindestens 44 px

## Layouts (CSS plus kleines JS für die Wahl)
- viewport-fit=cover, Abstände mit env(safe-area-inset-top|right|bottom|left) je Seite einzeln
- Layoutwahl als data-layout am Root, neu berechnet bei resize und orientationchange:
  - wide: Breite ab 840. Spielbereich links bis zur Mitte, Liste rechts, Navigation als senkrechte Kapsel in eigener rechter Spalte (Breite max(72px, safe-area-inset-right))
  - side: Breite unter 840 und rechter Inset ab 40 px (Duo zugeklappt). Eine Spalte, Navigation senkrecht rechts
  - medium: Breite 600 bis 839. Spielbereich oben zweigeteilt, Spiele zweispaltig, schwebende Kapsel unten
  - compact: sonst (iPhone). Eine Spalte, schwebende Kapsel unten
- Rechter Inset messen über ein unsichtbares Element mit padding-right: env(safe-area-inset-right)
- Die Liste scrollt, im wide Layout scrollen beide Hälften unabhängig, Seite selbst nicht

## Bausteine
- Navigation Kapsel: 4 Ziele mit Symbolen (Tipps, Bilanz, Spielplan, Einstellungen), aria-label, aktives Ziel mit Akzent
- Spielbereich (nur Tipps): Spiel mit dem nächsten nicht gesperrten Kickoff der Woche. Verlauf aus den Farben beider Teams (teams.json color, fehlt sie: #3A414D), dunkle Überlagerung für Kontrast, Text weiss. Kapsel Countdown bis Kickoff (T, h, min, live aktualisiert jede Minute). Ring SVG mit Siegwahrscheinlichkeit des getippten Teams in Akzentfarbe des getippten Teams und Gegnerfarbe. Felder Tipp und Resultat (falls Tiebreaker Spiel). Zeile wichtigster Ausfall aus data/injuries Datei der Woche (Schlüsselspieler mit Status Out oder Doubtful, beim Gegner oder eigenem Team, sonst Zeile weglassen, Datei fehlt: weglassen). Knopf "Auf der Tippseite eintragen" verlinkt https://tippspiel.footballbromance.com in neuem Tab. Keine Woche mehr offen: Spielbereich zeigt "Alle Tipps dieser Woche gesperrt"
- Kacheln Tiebreaker und Ziel Platz 1 (Rückstand, erlaubte Abweichungen)
- Umschalter Kapsel "Offen N | Alle M": Offen = nicht gesperrt und nicht eingetragen oder Warnung, Auswahl in localStorage (try catch)
- Spielzeile: Teampunkt in Teamfarbe, Kürzel getipptes Team, Gegner mit @ oder vs, Prozent oder Status, Häkchen 44 px. Bestehende Zustände bleiben: Abweichung, geändert seit Grundtipp, Warnung bei abweichendem Eintrag, gesperrt, nicht erfasst, keine Quote, Resultat tippen
- Bilanz, Spielplan, Einstellungen und Onboarding: gleiche Tokens, Karten und Navigation, Inhalt unverändert

## Nicht anfassen
src/core, jobs, data, Workflows, Service Worker Logik (nur Theme Farbe im Manifest auf #0B0E13 erlaubt).

## Abnahmekriterien
- typecheck, test, build grün, keine neuen Runtime Dependencies ausser Schriften
- Playwright Screenshots ohne Konsolenfehler und ohne waagrechtes Scrollen bei 390x844, 466x678 mit simuliertem rechtem Inset 84 (CSS Variable Override für Tests erlaubt), 669x951, 951x669, 1280x800, für Tipps, Bilanz, Spielplan, Einstellungen
- Kontrast Text mindestens 4.5 zu 1 auch auf dem Teamfarben Verlauf
- Keine Anfrage an fonts.googleapis.com oder fonts.gstatic.com
