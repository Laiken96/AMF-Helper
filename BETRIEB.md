# Betrieb NFL Dashboard

Stand 2026-11-02. Einziger Nutzer ist der Entwickler. Vor dem ersten weiteren Nutzer (Gate 2) diese Datei erneut prüfen.

## Umgebungen

- Lokal: Repo klonen, `npm ci`, `npm run dev`. Jobs lokal mit `npm run job:schedule`, `job:tips`, `job:review`, `job:watch`. Push wird lokal nie versendet (nur auf main mit Secrets).
- Produktion: GitHub Pages unter https://laiken96.github.io/AMF-Helper/, gebaut aus dem Branch main. Repo öffentlich: https://github.com/Laiken96/AMF-Helper
- Entwicklung: Branch claude/nfl-dashboard-plan-mcwlna, Übernahme nach main nur per Pull Request.

## Automatik (GitHub Actions)

| Workflow | Datei | Auslöser | Aufgabe |
|---|---|---|---|
| Daten Spielplan, Tipps und Bilanz | data.yml | stündlich Minute 17, manuell | ESPN Spielplan, Tippliste, Bilanz, Commit nach data/, danach Pages neu bauen |
| Push und Ausfall Wächter | push.yml | alle 10 Minuten (3, 13, 23 ...), manuell mit test true | Ausfälle prüfen, Push versenden, push-log.json committen |
| Rangliste übernehmen | standings.yml | Issue mit Label rangliste vom Owner | Ranglistenstand nach data/ übernehmen |
| Pages | pages.yml | Push auf main, manuell | Tests, Build, Veröffentlichung |

Externer Auslöser (D041): cron-job.org startet push.yml alle 10 Minuten und data.yml stündlich um Minute 47 per API, da GitHub die Zeitpläne nicht zuverlässig startet. Konto und Jobs beim Nutzer, Token fein granuliert nur Actions auf AMF-Helper, läuft ab am 02.11.2027.

Kontrolle: https://github.com/Laiken96/AMF-Helper/actions. Ein roter Lauf bedeutet, dass mindestens ein Schritt fehlschlug. Die Daten bleiben dann auf dem letzten gültigen Stand (D019).

Bekanntes Risiko: GitHub verzögert oder überspringt geplante Läufe bei hoher Last und deaktiviert sie nach 60 Tagen ohne Commit. Die Datenjobs committen regelmässig, in der Offseason aber nicht. Notlösung siehe Störungen.

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
| App zeigt altes Design | Service Worker oder Cache | App ganz schliessen und neu öffnen |

## Vertretung

Niemand. Bus Faktor 1, für ein privates Werkzeug akzeptiert. Fällt der Entwickler aus, laufen die Jobs weiter, solange GitHub sie startet. Die Tippgruppe nutzt die App nicht und ist nicht betroffen.

## Ausserbetriebnahme

- Daten löschen: Repo archivieren oder löschen. data/ enthält nur Kürzel, keine Namen.
- Backend Projekt löschen: keines vorhanden. GitHub Pages in den Settings deaktivieren.
- Keys rotieren: Secrets VAPID_PRIVATE_KEY und PUSH_SUBSCRIPTION löschen, am iPhone die App vom Home Bildschirm entfernen.
- Externe Auslöser (falls eingerichtet): cron-job.org Job und Token löschen.
- Nutzer informieren: entfällt, einziger Nutzer ist der Entwickler.
