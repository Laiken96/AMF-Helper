# Betrieb NFL Dashboard

Stand 2026-11-08. Einziger Nutzer ist der Entwickler. Vor dem ersten weiteren Nutzer (Gate 2) diese Datei erneut prüfen.

## Umgebungen

- Lokal: Repo klonen, `npm ci`, `npm run dev`. Jobs lokal mit `npm run job:schedule`, `job:tips`, `job:picks`, `job:review`, `job:news`, `job:watch -- --current` oder `-- --next`, `job:heartbeat`, `job:index`. Push wird lokal nie versendet (nur auf main mit Secrets).
- Produktion: GitHub Pages unter https://laiken96.github.io/AMF-Helper/, gebaut aus dem Branch main. Repo öffentlich: https://github.com/Laiken96/AMF-Helper
- Entwicklung: Branch claude/nfl-dashboard-plan-mcwlna, Übernahme nach main nur per Pull Request.

## Automatik (GitHub Actions)

| Workflow | Datei | Auslöser | Aufgabe |
|---|---|---|---|
| Daten Spielplan, Tipps, Bilanz und News | data.yml | GitHub Zeitplan stündlich Minute 17, cron-job.org stündlich Minute 47, manuell | Spielplan (aktuelle und 2 kommende Tippwochen, Wochenwechsel D055), Tippliste, Pick Anteile (job:picks), Ausfälle und FPI der nächsten Woche (job:watch --next), Bilanz mit Abgleich Rangliste, News, Lebenszeichen (job:heartbeat), Wochenindex, Commit nach data/, danach Pages neu bauen |
| Push und Ausfall Wächter | push.yml | GitHub Zeitplan Minuten 4, 14, 24, 34, 44, 54, cron-job.org alle 10 Minuten, manuell mit test true | Ausfälle und FPI der aktuellen Woche (job:watch --current), Push versenden, push-log.json committen, Pages nur bei geänderten Ausfällen der aktuellen Woche, danach KI Zweitmeinung (job:opinion) mit eigenem Commit |
| Rangliste übernehmen | standings.yml | Issue mit Label rangliste vom Owner | Ranglistenstand nach data/ übernehmen |
| Pages | pages.yml | Push auf main, Start durch data.yml oder push.yml, manuell | Tests, Build, Veröffentlichung, bei Fehler ein zweiter Deploy nach 60 Sekunden |
| CI | ci.yml | Pull Request, manuell | typecheck, test, build ohne Veröffentlichung |

Alle Workflows nutzen Actions mit Node 24 (checkout und setup-node v7, upload-pages-artifact und deploy-pages v5). Die Jobs selbst laufen mit Node 22.

Jobs schreiben nur bei echter Änderung (Zeitstempel allein zählen nicht). Pick Anteile gelten erst ab 0.5 Prozentpunkten Bewegung als geändert, sonst entstünde bei jedem Lauf eine neue Datei und ein Pages Neubau (D057). Die Ausfälle der nächsten Woche laufen seit D057 nur noch stündlich in data.yml statt alle 10 Minuten in push.yml: sie sind nicht zeitkritisch, die Erinnerungen nutzen nur die aktuelle Woche, und ihr Commit fällt mit dem stündlichen Datencommit zusammen statt eigene Pages Neubauten auszulösen.

Externer Auslöser (D041): cron-job.org startet push.yml alle 10 Minuten und data.yml stündlich um Minute 47 per API, da GitHub die Zeitpläne nicht zuverlässig startet. Konto und Jobs beim Nutzer, Token fein granuliert nur Actions auf AMF-Helper, läuft ab am 02.11.2027.

Wochenwechsel (D055): Sind alle Spiele der von ESPN gemeldeten Woche beendet oder abgesagt, setzt der Spielplan Job data/current.json auf die nächste Tippwoche, sobald deren Wochendatei vorliegt, normalerweise Dienstag früh nach dem MNF. Tipps, Push, Wächter und App folgen damit. current.json springt in einer Saison nie zurück, verschobene Spiele halten die Woche offen.

Push Inhalte (D057): "Tippliste bereit" nennt Anzahl Spiele, Vorschlag Favorit und Tiebreaker. Die Erinnerung vor Tippschluss (2 bis 60 Minuten vor Kickoff) nennt nur Paarungen, Ausfälle und Linienbewegungen, keine Tipps. Ausfälle nach Gewicht: Start QB (QB mit Passing Leader Rolle) zuerst, dann Leader Rollen (Passing, Rushing, Receiving), dann Linienbewegung, dann QBs ohne Leader Rolle. Weggelassen werden Ersatz QBs, die neu als Out gelistet sind, und Spieler, die von Out oder IR aus von der Liste verschwinden. Wer sonst von der Liste verschwindet, erscheint als "nicht mehr gelistet". Höchstens 2 Punkte pro Spiel, der Rest als "+N". "Bilanz bereit" nennt App Punkte und Tiebreaker, ohne Abweichungen.

News (D057): ESPN über die JSON Schnittstelle site.api.espn.com (der RSS Feed ist durch eine Bot Abwehr blockiert), CBS und PFT über RSS. Werbeartikel (Titel mit promo code oder bonus code) fallen weg. Scheitert eine Quelle, erscheint eine Warnung im Lauf und ihre bisherigen Einträge bleiben.

Kontrolle: https://github.com/Laiken96/AMF-Helper/actions. Ein roter Lauf bedeutet, dass mindestens ein Schritt fehlschlug. Die Daten bleiben dann auf dem letzten gültigen Stand (D019).

Bekanntes Risiko: GitHub verzögert oder überspringt geplante Läufe bei hoher Last und deaktiviert sie in öffentlichen Repos nach 60 Tagen ohne Aktivität. Ein deaktivierter Workflow lässt sich auch per API (cron-job.org) nicht mehr starten. Gegenmittel: data.yml schreibt höchstens alle 30 Tage data/heartbeat.json (Schritt Lebenszeichen), damit entsteht auch in der Offseason mindestens ein Commit pro Monat. Notlösung siehe Störungen.

## Saisonwechsel und Offseason

Kalender laut ESPN: Typ 1 Preseason, Typ 2 Regular Season Woche 1 bis 18, Typ 3 Postseason Woche 1 Wild Card, 2 Divisional, 3 Conference, 4 Pro Bowl, 5 Super Bowl, Typ 4 Offseason. Logik in src/core/season-calendar.ts.

Verhalten der Automatik:

- Ruhende Wochen: Preseason, Pro Bowl und Offseason schreibt der Spielplan Job ohne Argumente nicht. current.json bleibt auf der letzten Tippwoche, deshalb entstehen dort keine Tipps und keine Pushes. Der Lauf bleibt grün, im Log steht "ruhende Woche".
- Kommende Wochen: der Spielplan Job holt die nächsten 2 Tippwochen über die Grenze Regular zu Postseason (Week 17 holt Week 18 und Postseason Week 1, die Conference Woche holt den Super Bowl). Postseason Wochen ohne feste Paarung (Platzhalter Teams, keine Spiele oder Schemafehler) schreibt er nicht, ohne den Lauf rot zu machen. Aus der Preseason holt er Regular Week 1 und 2 der neuen Saison.
- Wochenpunkte der Gruppe: gegen den letzten Eintrag derselben Saison mit kleinerer Ordnung (Typ mal 100 plus Woche), also Postseason Week 1 gegen Regular Week 18 und Super Bowl gegen Conference Woche. Fehlt die direkte Vorwoche, gibt es keine Wochenpunkte.
- Rangliste: data/standings.json trägt ab Version 2 die Saison. Gilt sie für eine andere Saison, ist der Rückstand 0 bis zur ersten Meldung der neuen Saison.
- Ruhetage pro Spiel (homeRest, awayRest) entstehen nur, wenn die Wochendatei der direkten Vorwoche vorliegt, also nicht in Regular Week 1.

Checkliste Ende Regular Season (Week 18):

1. Klären, ob die Tippgruppe die Postseason spielt. Falls nein: keine Meldungen für Typ 3, die Tipps entstehen trotzdem.
2. Nach Week 18 prüfen, dass current.json auf Postseason Week 1 wechselt (data/current.json, seasonType 3).
3. Ranglisten Formular: Postseason (3) wählen, Woche 1 bis 3 und 5.

Checkliste Pro Bowl und Super Bowl:

1. In der Pro Bowl Woche bleibt current.json auf der Conference Woche (Log "Pro Bowl, ruhende Woche"), die Super Bowl Woche erscheint als kommende Woche.
2. Sobald ESPN auf Woche 5 wechselt, wird sie current, Push vor Tippschluss läuft normal.

Checkliste Offseason (Februar bis August):

1. Nach dem Super Bowl Gesamtbilanz und Saisonauswertung sichern, Post Mortem schreiben.
2. Monatlich unter Actions prüfen, dass data.yml läuft und data/heartbeat.json höchstens 30 Tage alt ist. Ist ein Workflow trotzdem deaktiviert: Actions, Workflow wählen, "Enable workflow".
3. Einmal pro Monat lokal `git pull` (Backup ausserhalb GitHub).
4. Token cron-job.org Ablauf prüfen (02.11.2027), Push Anmeldung am iPhone testen (push.yml manuell mit test true).

Checkliste Saisonstart (August bis Week 1):

1. Preseason Läufe zeigen "Preseason, ruhende Woche", Regular Week 1 und 2 der neuen Saison liegen unter data/weeks/.
2. Kürzel der Gruppe im Formular .github/ISSUE_TEMPLATE/rangliste.yml und in data/standings.json prüfen (PLAYER_IDS in src/core/standings.ts).
3. Sobald ESPN auf Regular Week 1 wechselt, prüfen: current.json zeigt die neue Saison, Tippliste Week 1 entsteht mit der ersten Quote, Rückstand ist 0 (Rangliste der Vorsaison gilt nicht).
4. Nach Week 1 die erste Rangliste melden. Week 1 zählt ab 0 Punkten.
5. REGULAR_SEASON_WEEKS (tips.ts) und REGULAR_WEEKS (season-calendar.ts) prüfen, falls die NFL die Saison verlängert.

## Deploy

1. Änderung auf dem Entwicklungsbranch, `npm run typecheck`, `npm test`, `npm run build` grün.
2. Pull Request nach main, Review und QA laut CLAUDE.md.
3. Merge. pages.yml baut und veröffentlicht automatisch, Dauer etwa 1 Minute.
4. Kontrolle: Seite laden, keine Konsolenfehler. Am Handy die App vom Home Bildschirm einmal ganz schliessen und neu öffnen, damit die neue Version lädt.

## Rollback

1. Auf GitHub den Merge Commit des kaputten Pull Requests öffnen und "Revert" wählen, daraus einen Pull Request erstellen und mergen. Alternativ lokal `git revert -m 1 <merge sha>` und Push auf main.
2. pages.yml veröffentlicht automatisch den vorherigen Stand.
3. Daten unter data/ sind davon getrennt. Kaputte Daten einer Woche: betroffene Datei in data/ auf einen früheren Commit zurücksetzen (`git checkout <sha> -- data/<datei>`), committen, data.yml manuell starten.
4. Ein gesperrter Tipp darf beim Rollback nie verändert werden. Tippdateien nur auf einen Stand zurücksetzen, der die Sperren enthält.

## Datenbank

- Es gibt keine Datenbank. Alle Daten liegen als JSON unter data/ im Repo, validiert per zod (schemaVersion je Datei).
- Aus Null reproduzierbar: ja für Spielplan, Teams und Bilanz (Jobs mit --season --type --week neu laufen lassen). Nein für gesperrte Tipps und Grundtipps vergangener Wochen, da die Quoten vor Kickoff nicht mehr abrufbar sind. Diese existieren nur in der Git Historie.
- Letzter Test der Neuerstellung: 2026-11-02 durch QA (Spielplan und Tipps Week 9 in einer Kopie neu erzeugt).

## Backup

- Was: das ganze Repo inklusive data/.
- Wie oft: jeder Commit, also mindestens stündlich während der Saison.
- Wo: GitHub, zusätzlich jeder lokale Klon. Empfehlung: einmal pro Monat lokal `git pull` auf dem Mac, damit eine Kopie ausserhalb von GitHub existiert.
- Wiederherstellung zuletzt getestet am: 2026-11-02 (Klon aus GitHub, Build und Tests grün).

## Zugriffe und Keys

- GitHub Konto Laiken96: Owner des Repos, einziger Schreibzugriff ausser GitHub Actions.
- Secrets unter Settings, Secrets and variables, Actions:
  - VAPID_PRIVATE_KEY: privater Schlüssel für Web Push. Gegenstück ist VAPID_PUBLIC_KEY in src/core/push-config.ts.
  - PUSH_SUBSCRIPTION: Anmeldung des eigenen iPhone aus dem Onboarding.
  - Fein granulierter Token "cron-job NFL Dashboard": liegt nur bei cron-job.org in beiden Jobs (Header Authorization). Rechte nur Actions Read and write auf AMF-Helper. Ablauf 02.11.2027. Erneuern: neuen Token gleich anlegen, in beiden Jobs ersetzen, alten Token löschen.
- ESPN braucht keinen Key.
- Rotation:
  - PUSH_SUBSCRIPTION: nach "Neu anmelden" in den Einstellungen, nach Geräte Wechsel oder wenn push.yml "Anmeldung abgelaufen" meldet. Neue Anmeldung kopieren und Secret ersetzen.
  - VAPID Schlüsselpaar: nur bei Verdacht auf Abfluss. Neues Paar erzeugen (`npx web-push generate-vapid-keys`), öffentlichen Schlüssel in push-config.ts, privaten als Secret, mergen, danach am Handy "Neu anmelden" und PUSH_SUBSCRIPTION ersetzen.

## Störungen

| Symptom | Ursache | Vorgehen |
|---|---|---|
| Keine Erinnerung, keine neuen Daten | geplante Läufe starten nicht | Actions prüfen. Workflows manuell starten (Run workflow). Bleibt es länger aus: externer Auslöser über cron-job.org mit fein granuliertem Token, nur Actions Schreibrecht auf dieses Repo |
| data.yml rot mit Schemafehler | ESPN hat das Format geändert | Daten bleiben auf letztem Stand. Adapter in src/core/espn.ts anpassen, Fixture aktualisieren, Tests. Fallback laut D002 ist API-Sports |
| push.yml rot mit "Anmeldung abgelaufen" | iPhone Anmeldung ungültig | In der App unter Einstellungen "Neu anmelden", PUSH_SUBSCRIPTION ersetzen, Testlauf mit test true |
| Tippliste ohne Quoten | ESPN liefert noch keine Odds | Normal bis kurz vor der Woche. Spiel zeigt "offen", Grundtipp folgt mit der ersten Quote |
| Rangliste nicht übernommen | Formular Eingabe abgelehnt | Kommentar im Issue lesen, gleiche Woche korrigiert neu melden |
| Workflow deaktiviert, cron-job.org meldet Fehler | 60 Tage ohne Aktivität | Actions, Workflow wählen, "Enable workflow". Danach data.yml manuell starten, das Lebenszeichen folgt automatisch |
| current.json bleibt stehen | ruhende Woche (Preseason, Pro Bowl, Offseason) | Normal. Log von data.yml zeigt "ruhende Woche" |
| App zeigt altes Design | Service Worker oder Cache | App ganz schliessen und neu öffnen |
| Pages rot trotz zweitem Deploy | GitHub Pages gestört (Timeout, HTTP 400 in progress, HTTP 502) | githubstatus.com prüfen, später pages.yml manuell starten. Die Daten sind davon nicht betroffen |
| Warnung "Quelle ... fehlgeschlagen" im News Schritt | Quelle blockiert oder geändert | Bleibt es über Tage, Quelle prüfen (curl mit gleichem User Agent), Adapter in src/core/news.ts anpassen. Andere Quellen laufen weiter |

## Vertretung

Niemand. Bus Faktor 1, für ein privates Werkzeug akzeptiert. Fällt der Entwickler aus, laufen die Jobs weiter, solange GitHub sie startet. Die Tippgruppe nutzt die App nicht und ist nicht betroffen.

## Ausserbetriebnahme

- Daten löschen: Repo archivieren oder löschen. data/ enthält nur Kürzel, keine Namen.
- Backend Projekt löschen: keines vorhanden. GitHub Pages in den Settings deaktivieren.
- Keys rotieren: Secrets VAPID_PRIVATE_KEY und PUSH_SUBSCRIPTION löschen, am iPhone die App vom Home Bildschirm entfernen.
- Externe Auslöser (falls eingerichtet): cron-job.org Job und Token löschen.
- Nutzer informieren: entfällt, einziger Nutzer ist der Entwickler.
