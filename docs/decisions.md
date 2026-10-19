# Decisions

Why Shareplate is built the way it is. Newest decisions go at the bottom.

## 1. One codebase for iPhone, iPad and web: Expo

Expo (React Native) lets one TypeScript codebase run as an iOS app and as a
website. The website can launch first for free, and the iOS app follows from the
same code.

## 2. Supabase for the backend

Postgres for data, Google sign-in, real-time updates between phones, and file
storage for receipt photos, all on a free tier. The rules that protect the data
(who can see a trip, money integrity) live in the database itself, not only in
the app.

## 3. Money is stored as integer cents, rounded with the largest-remainder method

Decimal dollars cause rounding errors. Whole cents plus largest-remainder
rounding guarantee every split adds up to exactly the bill total, and nobody is
more than a cent from their exact share. See [money-engine.md](money-engine.md).

## 4. Guests are group members too

The original spec made the payer a `users` row, so a guest could never pay. Now
payers, debtors and payments all point at `group_members`. A member is either a
registered user or a guest (no account), and both can pay and owe.

## 5. Payments are recorded in a `settlements` table

Balances, the Settle Up screen, and the "can't leave while you owe money" rule
all need to know who has already paid whom.

## 6. No bill locking (Linh's call)

The spec's LOCKED status and "reopen request" flow are dropped. Any bill can be
edited at any time and balances recalculate automatically. If a bill changes
after people have paid, Settle Up simply shows the new amounts. A lightweight
edit history can be added later if it turns out to be needed.

## 7. Zelle is only stored and shown, never called (Linh's call)

Zelle has no public API for apps like this. Each profile stores a Zelle email or
phone number, and Settle Up shows it with a copy button. The app never moves
money.

## 8. Split inputs are stored per participant

Each bill has a `split_mode` (itemized, equal, percent, exact). Each person on the
bill has a `share_input` (their percentage or exact amount) and the computed
amounts. The money engine computes the shares; the database re-checks that they
add up.

## 9. Concurrent editing: "X is editing" indicators + last write wins

Full CRDTs are overkill for a trip app. Bills and itinerary items have a
`version` number that goes up on every edit, so the app can notice when someone
else changed something first and warn instead of silently overwriting.

## 10. Debt simplification is greedy

"Largest debtor pays largest creditor" gives at most N − 1 payments and removes
circular debts. A guaranteed-minimum solution is NP-hard and not worth the cost.

## 11. Sign in with Apple will be added for iOS

Apple requires a privacy-friendly sign-in option when an app offers Google
sign-in. The website launches with Google only.

## 12. CSV and Excel export first; Google Sheets later

Writing to someone's Google Drive needs Google's sensitive-scope review.
Downloadable files cover the need without it.

## 13. The schema is tested without a Supabase account

The migration runs in PGlite (Postgres compiled to WebAssembly) in every test
run, with a small stand-in for Supabase's auth functions. That's how the
row-level security rules, the money checks, and the membership guards are
tested on every change.

## 14. Each bill line is rounded separately

Items, discount, tax and tip are each split with largest-remainder rounding.
That keeps a per-person breakdown where every column matches the receipt and no
line ever goes negative, at the cost of a person's total possibly being off from
the unrounded math by a couple of cents.

## 15. Database privileges are set explicitly

Supabase projects can expose every new table to the API automatically. The
migration doesn't rely on that: signed-out visitors get no table access at all,
signed-in users get access filtered by row level security, and internal helper
functions can't be called from the app. The schema tests start from Supabase's
permissive defaults to prove the migration locks things down.

## 16. Public keys are committed; secrets never are

The Supabase project URL and publishable key live in `.env` in the repo. They're
sent to every visitor's browser anyway, and row level security is what protects
the data. The database password and access token exist only as GitHub Actions
secrets, used by the deploy workflow.

## 17. The website is a single-page app

Every screen is drawn in the browser rather than pre-built as HTML. Almost every
screen needs a signed-in user, so pre-building pages bought nothing and caused
mismatches between the pre-built page and the signed-in one. `vercel.json`
sends every address to the app, which then shows the right screen.

## 18. Guests are allowed in both kinds of trips

"Everyone signs in" trips lead with the invite link, but an admin can still add
a guest for someone without a phone or account. "Quick split" trips lead with
guests and have no invite link.

## 19. Removing someone is a soft remove

Removing a person or leaving a trip sets `left_at` instead of deleting the
row, so bills they were on keep pointing at a real person. The database refuses
to hard-delete anyone who appears on a bill or payment, and a whole trip can
still be deleted cleanly (bills and payments go with it).

## 20. Trip mates see each other's name and Zelle info, not email

That matches the privacy page. Emails stay private between a person and the app.

## 21. Invite links are one per trip and last 30 days

Admins can reset the link, which stops the old one working. Rejoining after
leaving restores the same membership, so past bills stay attached.

## 22. A bill and its shares are saved in one step

The `save_bill` database function writes the bill and everyone's shares in a
single transaction, so a half-saved bill can't exist. It runs with the
person's own permissions, so trip privacy rules still apply.

## 23. Two people editing the same bill

Every save sends the version of the bill the person started editing. If
someone else saved in between, the database refuses with "someone else changed
this bill" instead of silently overwriting their change.

## 24. Balances are calculated in the app with the money engine

The trip screen and Settle Up calculate balances from the bills and payments
using the same tested code as `docs/money-engine.md`. The database has a
matching `member_balances` view, which it uses to enforce the leave and
delete-account rules.

## 25. Dates are typed as year-month-day, with Today and Yesterday shortcuts

Phones and browsers have very different date pickers. Most bills are added the
same day or the next, so two shortcuts cover the common case. A proper
calendar picker can come with the itinerary in Phase 6.

## 26. One "something changed" stamp per trip drives live updates

Supabase's live change feed can be filtered by trip for new and edited rows,
but not for deleted ones. Instead, every change in a trip (bills, payments,
people) bumps `groups.activity_at`, and each phone listens to its own trip's
row. That one signal covers inserts, edits and deletes, and row level security
decides who hears it. Phones then refetch, so they always show what the
database says.

## 27. Both live channels are private

`trip-data:<id>` (changes) and `trip:<id>` (who's editing) only accept trip
members, checked by `can_use_trip_channel` in the database.

## 28. Some actions update the screen before the database confirms

Deleting a bill, recording a payment and undoing a payment show up instantly
and roll back if the save fails. Saving a bill waits for the database, because
it's the step most likely to be refused (for example, a newer version exists).

## 29. Editing conflicts are shown, not silently merged

If someone saves a bill while you have it open, the editor says so and offers
"Load latest version". Your unsaved edits stay on screen until you choose,
and the database refuses to overwrite their version either way.

## 30. Receipts are read by Gemini's free tier, behind one small function

The `scan-receipt` edge function sends the photo to Google Gemini
(`gemini-3.8-flash` by default, changeable with the `GEMINI_MODEL` secret). It
tries Google's current Interactions API first and falls back to the older
generateContent API if the request shape is refused, so a change on Google's
side doesn't break scanning. Switching to another provider later only touches
`supabase/functions/scan-receipt/core.ts`.

## 31. The reader's answer is a draft, never the truth

Whatever the reader returns lands in an editable form with the photo on top.
Totals that don't match what the receipt printed are flagged, but the person
decides. The money engine does all the splitting; the database checks it adds up.

## 32. Receipt photos are shrunk and private

Photos are resized to at most 1600px and saved as JPEG before upload (usually
under 200 KB). They live in a private Supabase Storage bucket under the trip's
id, and storage rules let only that trip's members upload, view or delete them.
Deleting a bill deletes its photo.

## 33. The receipt reader checks who's calling

The function verifies the caller's sign-in itself (this works with both old and
new Supabase key formats) and downloads the photo with the caller's own
permissions, so storage rules decide whether they may read it. The Gemini key
never leaves Supabase.


## 34. Discount lines printed as items become part of the discount

Stores print discounts as their own lines: Costco's "TPD/1234567", "Instant
Savings", coupons, and amounts with a minus sign (4.99-, -4.99, (4.99)). The
reader is told these are discounts, and the function moves any line that is
negative or named like a discount into the discount, with a note saying which
lines it moved. If one still slips through, the review screen marks it with a
**Move to discount** button.

Receipts print the subtotal either before or after discounts, so both count as
a match. When neither matches, the review screen says how far off the items are
and what to look for. A discount read as an item throws a printed-after-discount
subtotal off by twice its amount, so the message names both possible amounts.

## 35. The plan is days and activities; days come from the trip's dates

A trip shows every day between its first and last date, plus any later day that
has activities, and always at least one day. Empty days aren't stored, so
there's nothing to clean up when dates change. "Plan another day" opens a new
activity on the next day. Trip dates are set by admins (they already own the
trip's settings) and typed as year-month-day like bill dates; a calendar
picker is still for the polish phase. Plans are capped at 60 days.

## 36. Dragging is our own small component on React Native's touch system

Dragging uses a grip on each activity, so scrolling the page still works
anywhere else, and the page stops scrolling while a grip is held. It's built
on React Native's PanResponder, which behaves the same on iPhone, iPad and the
web, instead of adding a drag-and-drop library. Screen reader users get
"Move up" and "Move down" actions on each grip. Dragging works within a day;
the activity editor moves an activity to another day. A new order is saved in
one step (`arrange_itinerary`) and shown right away, and undone if saving fails.

## 37. Moving or pinning isn't editing

Activities and bills keep a version number to catch two people saving over each
other (decision 9). Dragging an activity, or pinning a bill to one, no longer
changes that version, so someone editing the activity or the bill at the same
time doesn't get a false "someone else changed this" warning. Real edits still
do.

## 38. Pinning is separate from saving a bill

A bill is pinned to at most one activity. The bill editors have a "Part of the
plan" picker (showing that day's activities when the trip has dates), and the
activity screen can pin existing bills or add a new one already pinned. The
pin is saved right after the bill, so the money functions stay unchanged.
Deleting an activity keeps its bills, just unpinned. Spent amounts are bill
totals; per-person budgets come in Phase 7.

## 39. Personal spending is your share, not what you paid

Allowances compare each person's share of the bills (what they used) with
their allowance. Who paid is a Settle Up question, not a budget one: if Linh
pays for a $60 dinner for three, she spent $20 of her allowance, not $60.

## 40. Budget charts are bullet bars, with the numbers written out

Each row has one colored bar for what was spent and a thin tick for the target
(the day's share of the trip budget, or the allowance). Past the target the
bar turns the warning color, and the row says "$X over" in words, so it never
relies on color alone (the jade and warning red are too close for some
color-blind readers on their own). The trip budget is split into days with the
same exact rounding as bills, so the days add up to the budget. Bills dated
outside the trip's dates still count toward the total and are called out.

## 41. People set their own allowance through one database function

Regular members can't edit their member row (it holds their role), so
`set_daily_allowance` lets anyone set their own allowance and admins set
anyone's, such as a guest's. The trip budget stays an admin setting, like the
trip's name and dates.

## 42. Sharing is a card, a message, and a note for each person

The Share screen has one summary card (trip, total, each person's share, the
payments to settle up with Zelle info) that can be shared as an image or as
text, plus a short personal message for each person. In a quick split, guests
are listed first since they're the ones who need a message. On phones these
open the share sheet; on the web, text is copied and images download (or open
the share sheet in phone browsers that support it).

## 43. Our own small Excel writer

An .xlsx file is a zip of a few XML files. Writing them directly (with the
small `fflate` zip library) keeps the app light and works the same on phones
and the web, instead of adding a large spreadsheet library. It supports text,
numbers, money and dates, bold frozen headers and column widths, and is checked
in tests by unzipping it and by opening it with a real spreadsheet reader.
Money is converted from cents to dollars only here, for display. The CSV has a
byte order mark so Excel shows Vietnamese names correctly, and text starting
with = + - @ is escaped so it can't run as a formula.

## 44. No direct Google Sheets export (for now)

Writing to someone's Google Drive needs an extra Google permission, which means
another round of Google's app verification. Google Sheets opens the Excel file
directly (File, Import), so that covers it without asking for more access.

## 45. New native pieces for the iPhone app

Sharing files and images on iPhone uses `expo-sharing`, `expo-file-system` and
`react-native-view-shot`. They're Expo-supported, so they just need to be in the
iOS build made in Phase 9.

## 46. Deleting an account is one database step

`delete_my_account` checks what blocks it (a balance or being the only admin in
a trip shared with others), deletes trips nobody else signed in can see, hands
the person's receipt photos to their trips, and removes the sign-in, all in
one transaction, so it either fully happens or nothing changes. The app shows
the blockers first (`account_deletion_blockers`). Trips no longer require
their creator to exist. In shared trips the person stays as a former member so
everyone's history and totals still add up, which the privacy page explains.

## 47. Notifications start in the app

The database writes a short event for each change worth knowing about (bills
added, edited or deleted; payments; people joining, being added or leaving;
plan activities added or removed). Moving or pinning things isn't news. The
trip screen shows "What's new", marking what changed since your last visit,
and the home screen shows "3 new" on each trip. When you last looked is kept in
its own table, so opening a trip doesn't send a live update to everyone. Push
notifications on iPhone can build on the same events once there's an iOS build.

## 48. The icon: a plate split three ways

Jade background, a light plate cut into three shares, one of them saffron:
splitting, in the app's two colors. The same drawing makes the website icons,
the Android adaptive icon (kept inside the safe zone), the splash screen and
the link-preview image. The placeholder Expo icon and Expo-blue splash are gone.

## 49. The website installs like an app, without offline caching

A web manifest, icons and Apple's home-screen tags let people add Shareplate
to their home screen, where it opens full screen. Android and desktop Chrome
get an Install button; iPhone gets the Share, Add to Home Screen steps. There's
deliberately no service worker: offline caching would make stale versions more
likely, and the app needs the network for live trips anyway.

## 50. Open pages offer the new version

A page left open keeps running the version it loaded (this caught us after
the scanner update). When the tab comes back into view, or every 10 minutes,
the site checks whether a newer version has been published and shows "A new
version of Shareplate is ready" with a Reload button.

## 51. Link previews and headers

`public/index.html` carries the page title, description and Open Graph tags,
so links shared in iMessage, WhatsApp or Messenger show the app's card. Every
page gets basic security headers (no framing by other sites, no content-type
sniffing, a strict referrer policy, camera only for the site itself), and
built files are cached for a year since their names change with each release.

## 52. Tax that's already in the prices isn't added again

Receipts in Europe, Asia and Australia often print tax that's already inside
the prices ("Incl. 7.6% MwSt", "VAT included", "TTC"). The reader now reports
whether tax is included, and the function also spots it from the numbers (the
total matches without the tax but not with it). Either way the tax is set to
0 and the note says why. On the review screen, if the total is off by exactly
the tax, the message says the tax looks included and offers a one-tap
"Tax is already included" fix.

## 53. People who leave a trip stay at $0.00, and can be brought back

Leaving or being removed already required a $0.00 balance, but nothing kept
it that way afterwards: undoing one of their payments, or editing or deleting
a bill they were on, quietly put money back on someone who was no longer in
the trip. The database now checks, at the end of every change to bills,
shares and payments, that everyone who has left is still at exactly $0.00,
and refuses the change otherwise. Edits that don't move their balance (a new
title, money moved between people still on the trip) still go through. An
admin can bring someone back (Settle up, People, or the bill itself), make
the change, and remove them again once they're back to $0.00. Older trips
already in this state show the people involved at the top of Settle up with
a Bring back button.

## 54. Payments are removed, not undone, and only by the people involved

Any member could delete any payment, and it vanished without a trace. Now
only the payer, the receiver, whoever recorded it, or an admin can remove a
payment (enforced in the database), nobody edits one in place, and every
removal is listed under "Removed payments" in Settle up with who did it.
Deleting a bill or a payment no longer hides it from the screen before the
database agrees, so a refusal is always explained.

## 55. Settle anytime, with a nudge about timing

Settling isn't limited to the end of the trip: some friends pay as they go,
and the math already handles payments made before later bills. When the trip
has dates, Settle up says "The trip isn't over yet…" until the last day, and
"The trip's over, time to settle up" after it.

## 56. Zelle info in every message, including for guests

Messages say "Please send $8.00 to me by Zelle at …" when the money is owed to
whoever sends the message, and use the person's whole name (a first word can
be a family name). If people owe you and you haven't added Zelle, Share asks
you to add it first. Guests have no account, so a trip admin can record a
guest's Zelle email or phone on the trip (stored on their place in the trip,
never on a profile). Every delete or remove now asks first, including scanned
bills, which can now be deleted, and new bills, which can be discarded.

## 57. One way to add a bill

"Add bill" opens one screen with three choices: upload a receipt, one total,
or by item. "By item" is the scanner's item-by-item flow without a photo, and
both hand-entry screens have a One total / By item switch. Every amount box
accepts what people type ("12.345", "$1,234.5", "12,50", "1.234,56") and
rounds to the cent, half up, as soon as you leave the box, so the screen
always shows exactly what's saved. The database keeps storing whole cents.

## 58. Blank boxes get the rest

In "By percent" and "Exact amounts", anyone left blank gets what's left of the
bill (split equally if several are blank, to the exact cent or hundredth of a
percent, with the usual rounding). The filled-in value shows in grey with
"auto", and typing over it makes it yours. If the typed amounts are already
over the total, nothing is filled in and the screen says "Over by …". Each
person's final amount is saved; reopening a bill shows every box filled.

## 59. Discount, tax and tip as $ or %

Each can be typed as an amount or a percentage. A discount % is of the items,
a tax % of the items after discount, and a tip % of the items after discount,
before tax; each is rounded to the cent. The percentages typed are saved with
the bill (`discount_rate_bp`, `tax_rate_bp`, `tip_rate_bp`) so editing shows
"10%" again; the cents stay what everything adds up from. Switching between $
and % keeps the same money.

## 60. Scanning without losing anything, trip days and currency

The scanner has step tabs (Items, Totals, People) to jump anywhere, shows the
receipt photo on every step (smaller, bigger or hidden), keeps the unsaved
bill on the device and offers it back ("Continue where you left off?"), and
asks before you leave with unsaved changes. Bill dates offer the trip's days
("Day 2 · Sat, Oct 24") when the trip has dates, read typed dates like "10/23"
or "Oct 23" (US style, month first), and have a calendar button. Each trip
can show its amounts in one currency with cents (USD, EUR, CHF…); it only
changes the sign, nothing is converted. Currencies without cents (VND, JPY,
KRW) need their own rounding and come later.

## 61. Plan inputs: calendar, AM/PM, and free place search

Dates in the plan use the same date box as bills: type "10/23", "Oct 23" or
"tomorrow" (US style, month first), or open the calendar (the browser's own on
the website, the phone's own in the app). Times are a clock box plus an
AM | PM switch and a clock button; typing "7:30pm" or "19:30" sets the switch
by itself, and a bare "9" guesses AM (7 to 11) or PM (12 to 6) until you
choose. Places are searched with OpenStreetMap through our own `place-search`
function (Photon first, Nominatim if Photon doesn't answer): free, no API key
and no billing account, unlike Google's place search, which needs a card.
Picking a result saves the name, address and exact coordinates, so "Open in
Maps" lands on the spot; typing a name without picking still works. Results
favor places near others already in the plan. Selected chips and switches now
also tell screen readers they're selected on the website (`aria-checked`).

## 62. Step by step, tabs on the trip page, and Shareplate's own dialogs

Entering a bill by item goes 1 Items → 2 Totals → 3 People in order: a step
opens only once the ones before it are done (and you've been through them),
finished steps show a check and can be revisited, and trying to go on with an
empty or half-typed item says which one ("Item 2 is empty. Fill it in, or
remove it with ×.") and outlines it in red. The trip page keeps the money card
on top and puts the rest under tabs (Bills, Plan, People, Updates, Settings);
the open tab is in the address (`?tab=people`), so Back returns to it, and
Updates shows how many things are new. Every "are you sure?" question is now
Shareplate's own dialog instead of the browser's "this site says" pop-up, with
a red button for deleting, removing and leaving. The one browser pop-up left is
"Leave site?" when closing or reloading the tab with unsaved changes: browsers
don't let sites replace that one.

## 63. Changing a bill after people paid: say what happens, and a way to start over

Payments aren't tied to a bill: "1 paid 3 $50" just evens things out. So when
a bill is deleted or lowered after people paid, those payments stay and some
people are now owed money back. That's correct, but it surprised people. Now:
deleting a bill always lists whose balance changes ("2: settled → owes
$75.00"), and saving an edit does too once the trip has payments, with a line
saying payments already recorded stay as they are. Settle up explains when
recorded payments are more than the bills ask for ("Some of this is money going
back") and what to do: settle it back if the money really moved, or remove the
payments if they were mistakes or tests. Admins can also "Start over" in Trip
settings: after typing the trip's name, every bill and payment is cleared in
one step (people, the plan and settings stay), shown as a single line in
What's new. We don't delete payments along with a bill, since real money moved,
and we don't lock settled bills.

## 64. A tour, "Getting started" and a Help page

New people get a six-card tour the first time they reach their trips (Skip
anytime; remembered on the device). Each new trip shows a "Getting started"
list on the Bills tab (invite people, add your Zelle info, add the first bill,
set dates and plan, settle up) that ticks itself off as things happen and goes
away once someone pays, or when hidden. A Help page, reachable from the trips
list, the profile and each trip's Settings tab, has the tour again, a
step-by-step guide for every feature and common questions, searchable. All the
words live in `src/lib/help.ts`, so the tour, guides and FAQ stay consistent.

## 65. Picture tour, install instead of a download, What's new, and feedback

The tour shows a small picture of each screen, drawn with the app's own
colors so it follows light and dark mode and never goes stale like a
screenshot would. There's no separate desktop download: the website installs
as an app (Chrome and Edge on computers and Android, Safari's Add to Dock on
Mac, Add to Home Screen on iPhone), opens in its own window and always loads
the latest version, so there's nothing to update by hand. Release notes live
in `src/lib/changelog.ts`; returning users get a one-time "New in Shareplate"
note on their trips list and a What's new page, and new users get the tour
instead. Feedback (idea, problem or question) is stored in a `feedback` table:
people see only their own; owners listed in `app_admins` (added once in the
Supabase SQL editor, never through the app) read everything in a Feedback
inbox, with the sender's email only when they said it's OK to contact them.

## 66. Bills paid in another currency

A bill can be paid in a different currency from the trip's (30-plus,
including ones without cents like JPY, KRW and VND, where "1.200" means one
thousand two hundred). The day's rate comes from the European Central Bank
through Frankfurter, or from ExchangeRate-API's open feed for currencies the
ECB doesn't publish, both free with no key, through our own `fx-rate`
function; it can be changed to what a card actually charged. Everything on the
bill is converted to the trip's currency when it's saved, so balances,
settling up and the database rules don't change: one total is split again on
the converted total (equal stays equal), exact amounts are shared out in
proportion, and bills by item convert each price, discount, tax and tip and
spread each one like before, so everything still adds up for the bill and for
each person. The bill keeps the currency, rate, original total and what was
typed (`entry`), so it shows "Paid CHF 54.50" and edits in francs.
