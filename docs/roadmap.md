# Roadmap

Each phase ships as one pull request with a plain-English summary, a preview
link once hosting is set up, and a "try this" checklist.

## Phase 0: Setup ✅
- [x] Expo app for iOS, tablet and web, with TypeScript
- [x] Database schema with row-level security (`supabase/migrations`)
- [x] Schema tests in an in-memory Postgres
- [x] CI: typecheck, lint, tests, web build on every pull request
- [x] Connect the Supabase project; migrations deploy automatically when merged to main
- [ ] Connect Vercel for preview links (needs Linh's account)

## Phase 1: Money engine ✅
- [x] Whole-cent amounts, parsing and formatting
- [x] Largest-remainder rounding
- [x] Equal, percent and exact splits
- [x] Itemized bills: discount, tax, tip
- [x] Balances and debt simplification
- [x] Unit and property-based tests

## Phase 2: Sign-in and trips
- [ ] Google sign-in (Supabase Auth), profile setup with Zelle
- [ ] Create a trip, invite by link, add guests
- [ ] Admin and member roles

## Phase 3: Bills, ledger, Settle Up
- [ ] Add a bill by hand with any split mode
- [ ] Ledger of all bills
- [ ] Live balances and the Settle Up screen with Zelle info
- [ ] Record payments

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
