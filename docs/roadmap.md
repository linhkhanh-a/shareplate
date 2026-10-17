# Roadmap

Each phase ships as one pull request with a plain-English summary, a preview
link once hosting is set up, and a "try this" checklist.

## Phase 0: Setup ✅
- [x] Expo app for iOS, tablet and web, with TypeScript
- [x] Database schema with row-level security (`supabase/migrations`)
- [x] Schema tests in an in-memory Postgres
- [x] CI: typecheck, lint, tests, web build on every pull request
- [x] Connect the Supabase project; migrations deploy automatically when merged to main
- [x] Connect Vercel: live site plus a preview link for every pull request

## Phase 1: Money engine ✅
- [x] Whole-cent amounts, parsing and formatting
- [x] Largest-remainder rounding
- [x] Equal, percent and exact splits
- [x] Itemized bills: discount, tax, tip
- [x] Balances and debt simplification
- [x] Unit and property-based tests

## Phase 2: Sign-in and trips ✅
- [x] Google sign-in (Supabase Auth), first-time profile setup with Zelle
- [x] Create a trip (everyone signs in, or quick split with guests)
- [x] Invite by link, join, leave, rejoin; add guests
- [x] Admin and member roles; rename and delete trips
- [x] Privacy page (needed to publish the Google sign-in)
- [ ] Sign in with Google on the iPhone app (code is in; tested with the iOS launch)

## Phase 3: Bills, ledger, Settle Up ✅
- [x] Add and edit a bill by hand: equal, percent or exact, with a live preview of each share
- [x] Bill history on the trip screen, with your share of each bill
- [x] Your balance at a glance; full balances on Settle Up
- [x] Settle Up: fewest payments, with the recipient's Zelle info to copy
- [x] Record payments and undo them
- [x] Catch two people saving the same bill at once

## Phase 4: Real-time
- [ ] Live updates across phones (Supabase Realtime)
- [ ] Optimistic updates with rollback
- [ ] "X is editing" indicators and version-conflict warnings

## Phase 5: Receipt scanner
- [ ] Camera or upload, stored privately
- [ ] Vision model reads items, tax, tip, discount and vendor
- [ ] Three-step wizard: check items, check totals and category, assign people

## Phase 6: Itinerary
- [ ] Days, activities, times, places, planned budgets
- [ ] Drag to reorder
- [ ] Pin bills to activities; tap to see the bill

## Phase 7: Budget dashboard
- [ ] Trip and per-person daily allowances
- [ ] Planned vs. actual spending bars

## Phase 8: Quick-split and export
- [ ] Guest-only quick-split mode for a host
- [ ] Shareable summary card (image or text) for iMessage or WhatsApp
- [ ] CSV and Excel export
- [ ] Google Sheets export (optional)

## Phase 9: Polish and launch
- [ ] Leave-trip and delete-account flows (already enforced by the database)
- [ ] Notifications
- [ ] End-to-end tests
- [ ] Website launch, then TestFlight for iOS
