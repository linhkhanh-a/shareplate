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

## Phase 7: Budget dashboard ✅
- [x] Trip budget (admins), with spent, what's left and about how much a day
- [x] Day-by-day spending against each day's share of the budget, with the plan's numbers alongside
- [x] Personal daily allowances: set your own (admins can set anyone's, like a guest's)
- [x] Your share per day against your allowance, and everyone's share against theirs
- [x] Budget section on the trip screen
- [x] Works without trip dates (spending by date) and without a budget

## Phase 8: Quick-split and export ✅
- [x] Quick split: add everyone by name while creating it; guests don't need the app
- [x] Summary card to share as an image, or the whole summary as text, for iMessage or WhatsApp
- [x] A personal message for each person: their share, who to pay, and the Zelle info
- [x] Excel export (bills with everyone's share, scanned items, people, settle up, payments) and CSV of bills
- [ ] Google Sheets export: skipped for now; Google Sheets imports the Excel file (see decision 44)

## Phase 9: Polish and launch
- [x] Delete your account from your profile (needed for the App Store), with clear reasons when it's blocked
- [x] Leave trip (done in Phase 2)
- [x] In-app notifications: "What's new" in each trip, "3 new" badges on your trips
- [ ] Push notifications on iPhone (comes with the iOS build)
- [ ] End-to-end tests in CI
- [x] First-run tour, Getting started list for new trips, Help page with guides and FAQ (decision 64)
- [x] People who left stay at $0.00, Bring back, and safer payment removal (decisions 53 and 54)
- [x] Bill entry: one Add bill, blanks filled in, $ or % extras, rounding to the cent, trip days, scanner tabs and kept drafts, currency per trip (decisions 57 to 60)
- [x] Plan inputs: calendar and smart dates, AM/PM times, free OpenStreetMap place search (decision 61)
- [x] Website launch polish: app icon, link previews, add to home screen, "new version ready" banner, security headers
- [x] Picture tour, install button, What's new page, feedback form and inbox (decision 65)
- [x] Bills paid in another currency, with the day's exchange rate (decision 66)
- [x] Venmo, PayPal and Cash App links with the amount filled in; "By shares" split (decision 67)
- [ ] Web push notifications (new bills, payments to you, settle-up reminders)
- [ ] iPhone app: build setup, Sign in with Apple, TestFlight (waiting on an Apple Developer account)
