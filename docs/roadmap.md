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

## Phase 4: Real-time ✅
- [x] Live updates across phones: new, edited and deleted bills, payments and people
- [x] Instant updates on your own screen for deletes and payments, undone if saving fails
- [x] "Minh is editing" on bills, and a warning when someone saves a newer version first
- [x] Private live channels: only trip members can join
- [x] Catch up automatically after a dropped connection

## Phase 5: Receipt scanner ✅
- [x] Take or choose a photo; it's shrunk and stored privately for the trip
- [x] Gemini (free tier) reads items, discount, tax, tip, vendor, date and suggests a category
- [x] Step 1: photo on top, editable items below; warnings when numbers look off
- [x] Step 2: totals with tax rate, title, category, payer, date
- [x] Step 3: tap who had each item (shared dishes split equally); live per-person breakdown
- [x] Type the items instead when there's no photo or the reader can't help
- [x] Edit scanned bills item by item; receipt photo kept with the bill

## Phase 6: Itinerary ✅
- [x] Trip dates (admins), with each day labelled by its date
- [x] Activities per day: name, start and end times, place, notes, planned budget
- [x] Drag to reorder within a day; move to another day in the editor; "Sort by time"
- [x] Open a place in Apple Maps (iPhone, iPad) or Google Maps (web)
- [x] Pin bills to activities from the activity, or from the bill editor ("Part of the plan")
- [x] Planned vs. spent for each activity, each day and the whole trip; tap a pinned bill to open it
- [x] Live updates and "Minh is editing" for the plan, like bills

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
