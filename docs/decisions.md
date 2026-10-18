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
