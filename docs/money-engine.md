# How Shareplate splits money

The money engine lives in `src/money/`. It is plain TypeScript with no screens and
no database, so every rule here is covered by automated tests.

## 1. Money is always whole cents

$12.34 is stored as `1234`. The app never does math on decimal dollars, because
computers can't represent most decimal fractions exactly (in JavaScript,
`0.1 + 0.2` is `0.30000000000000004`).

## 2. Rounding: the largest-remainder method

Splitting $10.00 three ways gives $3.333… each. Rounding each share on its own
gives $3.33 × 3 = $9.99, and a cent disappears.

Instead, the engine:

1. gives everyone the rounded-down amount ($3.33 each, $9.99 total), then
2. hands out the leftover cents one at a time to whoever had the biggest
   fraction cut off. Ties go to whoever is listed first.

Result: **$3.34, $3.33, $3.33**. This guarantees:

- the shares always add up to exactly the bill total;
- nobody is ever more than 1 cent away from their exact share.

## 3. Manual split modes

| Mode | You enter | Rule |
|---|---|---|
| Equal | who's in | Total ÷ number of people, rounded as above |
| Percent | a % per person | Must add up to exactly 100% (two decimals allowed, e.g. 33.33%) |
| Exact | a $ amount per person | Must add up to exactly the bill total. The app tells you how far off you are. |

## 4. Itemized bills (scanned receipts)

These are the formulas from the spec:

1. **Items.** Each item is split equally among the people who had it. A shared
   dish of $12.00 between 3 people is $4.00 each.
2. **Discount.** Spread in proportion to each person's items
   (discount ratio = discount ÷ subtotal).
3. **Tax.** Spread in proportion to each person's *discounted* items
   (tax ratio = tax ÷ discounted subtotal). Because everyone gets the same
   discount ratio, this works out to the same proportions as their items.
4. **Tip.** Split equally among everyone on the bill, no matter what they ordered.
   The tip group can be changed (for example, to add a friend who only shared the tip).

Each of the four lines is rounded with the largest-remainder method, so every
column adds up to exactly what's printed on the receipt.

### Worked example

| Item | Price | Who had it |
|---|---|---|
| Pho | $15.00 | Linh |
| Banh mi | $9.00 | An |
| Spring rolls | $12.00 | Linh, An, Minh |

Subtotal $36.00, voucher −$6.00, tax $2.40 (8% of $30.00), tip $9.00. Bill total: **$41.40**.

| | Items | Discount | Tax | Tip | **Owes** |
|---|---|---|---|---|---|
| Linh | $19.00 | −$3.17 | $1.27 | $3.00 | **$20.10** |
| An | $13.00 | −$2.17 | $0.87 | $3.00 | **$14.70** |
| Minh | $4.00 | −$0.66 | $0.26 | $3.00 | **$6.60** |
| **Total** | $36.00 | −$6.00 | $2.40 | $9.00 | **$41.40** |

Check for Linh using the spec formulas: her items are $19.00; after the 1/6
discount that's $15.83; tax at 8% adds $1.27; plus $3.00 tip = $20.10. ✓

Because each line is rounded separately, a person's total can differ from the
unrounded math by a couple of cents at most. The shares still always add up to
the bill total exactly.

## 5. Balances

For each person in a trip:

> balance = what they paid for bills − what they owe on bills + payments they sent − payments they received

Positive means the group owes them; negative means they owe. A trip's balances
always add up to exactly $0.00.

## 6. Settle Up

To turn balances into payments, the engine repeats one step: **the person who owes
the most pays the person who is owed the most, as much as possible.** Each payment
clears at least one person, so a trip with N people needs at most N − 1 payments,
and circular debts (A owes B, B owes C, C owes A) disappear entirely.

Finding the absolute fewest payments in every possible case is an NP-hard problem;
this greedy method is the standard practical approach and is usually optimal for
real trips.

## 7. What the database double-checks

Even if the app had a bug, the database refuses to save a bill unless:

- the bill total = subtotal − discount + tax + tip;
- everyone's shares add up to exactly the bill total;
- percent splits add up to 100%, and exact splits match what was typed;
- everyone on the bill belongs to the same trip.
