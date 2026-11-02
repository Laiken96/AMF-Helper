# NFL Dashboard

## Harte Regeln

1. Nach jedem Sprintschritt: commit und push, CLAUDE.md aktualisieren, DECISIONS.md ergänzen, REGRESSION.md ergänzen, Kontext leeren.
2. Kein neues Feature, solange die Definition of Done in PROJEKT.md offen ist.
3. Keine Änderung an der Datenbank ohne versionierte Migration im Repository.
4. Berechtigungen serverseitig durchsetzen, nie nur im UI ausblenden.
5. Bei Widerspruch zwischen Auftrag und DECISIONS.md: anhalten und nachfragen, nicht selbst entscheiden.

## Ziel

Siehe PROJEKT.md. Entscheide siehe DECISIONS.md. Nicht duplizieren.

## Stack

Next.js (TypeScript, App Router) auf Vercel, Supabase Postgres (Frankfurt), Python Jobs (nflreadpy) in GitHub Actions. Details D001 bis D006 in DECISIONS.md, Sprintplan in PLAN.md.

## Projektstruktur

- app/ Seiten und API Routes
- lib/espn/ Adapter mit zod Validierung
- lib/cache.ts Server Cache mit Single Flight
- jobs/ Python Batch Jobs (rss, elo, odds)
- supabase/migrations/ versionierte Migrationen

## Aktueller Stand

Kickoff. Noch kein Code.

## Nächster Schritt

Gate 1: Nutzer bestätigt PROJEKT.md. Danach Sprint 1 laut PLAN.md.
