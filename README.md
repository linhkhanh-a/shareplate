# Shareplate

Shareplate is a trip app for splitting bills
fairly, down to the last cent: scan a receipt, say who had what, and see who owes
whom in as few payments as possible. It also keeps the trip's day-by-day plan and
budget in one place.

One codebase runs on **iPhone, iPad, and the web**.

## Status

| Phase | What | Status |
|---|---|---|
| 0 | Project setup, database schema | ✅ Done |
| 1 | Money engine (splitting math) | ✅ Done |
| 2 | Sign in with Google, trips, members, guests | ✅ Done |
| 3 | Add bills by hand, ledger, Settle Up | Next |
| 4 | Real-time sync between phones | |
| 5 | Receipt scanner | |
| 6 | Itinerary planner and pinning bills | |
| 7 | Budget dashboard | |
| 8 | Quick-split mode, share card, spreadsheet export | |
| 9 | Polish and launch | |

The full plan is in [docs/roadmap.md](docs/roadmap.md), and the reasoning behind
each choice is in [docs/decisions.md](docs/decisions.md).

## How the money works

All amounts are stored as whole cents, and every split always adds up to exactly
the bill total. The rules, with a worked example, are in
[docs/money-engine.md](docs/money-engine.md).

## Tech stack

- **App:** [Expo](https://expo.dev) (React Native) + Expo Router + TypeScript, built for iOS, tablet and web
- **Backend:** [Supabase](https://supabase.com) — Postgres, Google sign-in, real-time updates, file storage
- **Tests:** Vitest with property-based tests (fast-check); the database schema is tested in an in-memory Postgres (PGlite)

## Project layout

```
src/app/          screens (every file is a route)
src/money/        the money engine: pure TypeScript, no UI, fully tested
src/lib/          sign-in, database queries, error messages
src/components/   shared building blocks (buttons, fields, rows)
supabase/         database migrations and schema tests
docs/             roadmap, decisions, money rules
```

## Running it locally

You need [Node.js 22](https://nodejs.org).

```bash
npm install
npm run web        # open the app in your browser
npm test           # run all tests
npm run check      # typecheck + lint + tests (what CI runs)
```

## Deploying

- **Database:** new files in `supabase/migrations/` are applied to the live
  Supabase project automatically when they're merged to `main`
  (`.github/workflows/deploy-database.yml`).
- **Website:** Vercel builds every pull request as a preview and `main` as the
  live site.

## Author

Built by Linh Bui.
