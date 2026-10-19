/**
 * Everything the in-app tour, the "Getting started" checklist and the Help
 * page say, in one place so the words stay consistent and can be searched.
 */

export interface TourSlide {
  title: string;
  body: string;
}

/** The short tour shown the first time, and any time from Help. */
export const TOUR: TourSlide[] = [
  {
    title: 'Welcome to Shareplate',
    body: 'Split trip costs with friends and plan the trip together. Everyone sees the same bills and balances, live.',
  },
  {
    title: 'Add bills your way',
    body: 'Tap Add bill to upload a receipt and let Shareplate read it, or type it in: one total, or item by item. Split equally, by percent or by exact amounts; leave someone blank and they get the rest.',
  },
  {
    title: 'Settle up with the fewest payments',
    body: 'Settle up works out who pays whom, with as few payments as possible, and shows each person’s Zelle info. Tap Mark as paid once the money is sent.',
  },
  {
    title: 'Plan the days',
    body: 'In the Plan tab, add activities with times and places (pick a place for its exact spot on the map), and set a budget to see spending day by day.',
  },
  {
    title: 'Bring everyone in',
    body: 'In the People tab, share the invite link, or add guests by name if they don’t want an account. The Updates tab shows what others changed since you last looked.',
  },
  {
    title: 'Help is always here',
    body: 'Find this tour, step-by-step guides and answers to common questions under Help: on your trips list, in your profile, and in each trip’s Settings tab.',
  },
];

export interface Guide {
  id: string;
  title: string;
  steps: string[];
}

/** Step-by-step guides for each feature. */
export const GUIDES: Guide[] = [
  {
    id: 'trip',
    title: 'Start a trip',
    steps: [
      'On Your trips, tap New trip.',
      'Pick Group trip if friends will sign in and see everything themselves, or Quick split to add people by name only.',
      'Give it a name and tap Create trip. You can add dates later in the Plan tab.',
    ],
  },
  {
    id: 'people',
    title: 'Invite friends or add guests',
    steps: [
      'Open the trip and go to the People tab.',
      'Copy the invite link and send it to your group chat. Friends sign in with Google and join.',
      'For someone without an account, type their name under Add a guest. An admin can tap a guest to save their Zelle info.',
    ],
  },
  {
    id: 'bill-receipt',
    title: 'Add a bill from a receipt',
    steps: [
      'Tap Add bill, then Upload a receipt, and take or choose a photo.',
      'Check the items (1 Items), then discount, tax and tip (2 Totals), then tap who had each item (3 People).',
      'The receipt photo stays on every step so you can compare numbers. Tap Add bill to save.',
    ],
  },
  {
    id: 'bill-manual',
    title: 'Type a bill in',
    steps: [
      'Tap Add bill, then One total (just the amount) or By item (each dish).',
      'One total: choose Equally, By percent or Exact amounts. Leave someone blank and they get what’s left, shown in grey as "auto".',
      'By item: add each item and price. Discount, tax and tip can each be in $ or %.',
      'Amounts round to the cent when you leave the box, so what you see is what’s saved.',
    ],
  },
  {
    id: 'settle',
    title: 'Settle up',
    steps: [
      'Tap Settle up on the trip page to see the fewest payments that clear everything.',
      'Send the money however you like; Zelle info is shown when people added it.',
      'Tap Mark as paid. If a payment was recorded by mistake, the payer, the receiver, whoever recorded it or an admin can remove it.',
    ],
  },
  {
    id: 'plan',
    title: 'Plan activities and places',
    steps: [
      'Go to the Plan tab and open the trip plan. Set the trip dates with the calendar or by typing, like 10/23.',
      'Add an activity: pick the day, type times like 7:30 and choose AM or PM.',
      'In Where, type a place and pick it from the list to save its exact spot. Open in Maps then lands right on it.',
    ],
  },
  {
    id: 'budget',
    title: 'Track the budget',
    steps: [
      'In the Plan tab, open the budget to see spending day by day.',
      'Bills land on a day by their date; when the trip has dates, the bill’s date chips are the trip days.',
      'Set a daily allowance for yourself to see how much is left each day.',
    ],
  },
  {
    id: 'share',
    title: 'Share the summary or a spreadsheet',
    steps: [
      'On the Bills tab, tap Share and export.',
      'Share the summary card or text with your group chat, or copy a personal message for each person with what they owe and where to send it.',
      'Download an Excel file or CSV with every bill, item, person and payment.',
    ],
  },
  {
    id: 'settings',
    title: 'Trip settings',
    steps: [
      'In the Settings tab, admins can rename the trip, choose the currency it’s shown in (nothing is converted), start over or delete the trip.',
      'Start over clears every bill and payment after you type the trip’s name; people and the plan stay.',
      'Anyone can leave a trip once they don’t owe or aren’t owed anything.',
    ],
  },
  {
    id: 'install',
    title: 'Put Shareplate on your home screen',
    steps: [
      'On iPhone, open the site in Safari, tap Share, then Add to Home Screen.',
      'On Android, open it in Chrome and tap Install when it’s offered (or Menu, then Add to Home screen).',
      'It then opens like an app, full screen.',
    ],
  },
];

export interface Faq {
  q: string;
  a: string;
}

/** Common questions, in plain words. */
export const FAQ: Faq[] = [
  {
    q: 'Does Shareplate move any money?',
    a: 'No. It only keeps track. You send money however you usually do (Zelle, cash, anything), then tap Mark as paid so everyone’s balance updates.',
  },
  {
    q: 'Is Zelle connected to Shareplate?',
    a: 'No. Zelle info is just shown so people know where to send money. Shareplate never sees your bank or Zelle account.',
  },
  {
    q: 'Why do I owe (or am I owed) money after a bill was deleted?',
    a: 'Payments aren’t tied to a single bill. If people paid for a bill and it’s later deleted or lowered, those payments stay, so some money needs to go back. Shareplate shows whose balance changes before you delete or save, and Settle up explains it. If the payments were mistakes or tests, remove them, or use Start over in Settings.',
  },
  {
    q: 'How does rounding work?',
    a: 'Everything is counted in whole cents. When a bill doesn’t split evenly, the leftover cents go one at a time to the people closest to the next cent, so shares always add up exactly to the total and nobody is off by more than 1 cent.',
  },
  {
    q: 'What does "auto" mean next to someone’s share?',
    a: 'In By percent or Exact amounts, anyone you leave blank gets what’s left of the bill, split equally if several are blank. Type over it to set it yourself.',
  },
  {
    q: 'How are discount, tax and tip split on a bill by item?',
    a: 'The discount and tax are shared in proportion to what each person had. The tip is split equally between everyone on the bill. As a percentage, a discount is of the items, tax is of the items after discount, and tip is of the items after discount, before tax.',
  },
  {
    q: 'What’s a guest?',
    a: 'Someone added by name who doesn’t sign in. Their share is tracked like everyone else’s; send them a personal message from Share and export. An admin can save a guest’s Zelle info.',
  },
  {
    q: 'Why can’t I remove someone from the trip?',
    a: 'People can only leave or be removed when they don’t owe or aren’t owed anything, so nobody’s money gets lost. Settle up with them first.',
  },
  {
    q: 'Why can’t I change a bill that someone who left is on?',
    a: 'People who left always stay at $0.00. If a change would give them money owed or owing, an admin brings them back first (Bring back), makes the change, and settles up with them.',
  },
  {
    q: 'Who can remove a recorded payment?',
    a: 'The person who paid, the person who received it, whoever recorded it, or a trip admin. Removed payments are listed in Settle up so nothing disappears silently.',
  },
  {
    q: 'Should we settle at the end or as we go?',
    a: 'Either works. Settling early is fine: bills added later just create new, smaller payments. After the trip’s last day, Settle up reminds everyone it’s time.',
  },
  {
    q: 'Can I use a different currency?',
    a: 'Yes, an admin can choose the trip’s currency in Settings (EUR, GBP, CHF and more). It only changes the sign; nothing is converted. Currencies without cents, like VND or JPY, aren’t supported yet.',
  },
  {
    q: 'What if I leave a bill halfway?',
    a: 'Bills typed item by item are kept on your device. Next time, Shareplate offers to continue where you left off.',
  },
  {
    q: 'How do I delete my account?',
    a: 'Open your profile and choose Delete account. You’ll need to settle up in your trips first, and make someone else an admin where you’re the only one.',
  },
];

/** Guides and questions matching a search, by any word in the title, steps, question or answer. */
export function searchHelp(query: string): { guides: Guide[]; faq: Faq[] } {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}%$]/gu, ''))
    .filter(Boolean);
  if (words.length === 0) return { guides: GUIDES, faq: FAQ };
  const has = (text: string) => {
    const t = text.toLowerCase();
    return words.every((w) => t.includes(w));
  };
  return {
    guides: GUIDES.filter((g) => has([g.title, ...g.steps].join(' '))),
    faq: FAQ.filter((f) => has(`${f.q} ${f.a}`)),
  };
}

export interface ChecklistInput {
  activePeople: number;
  bills: number;
  payments: number;
  hasDates: boolean;
  myZelle: boolean;
  quick: boolean;
}

export interface ChecklistItem {
  id: 'people' | 'zelle' | 'bill' | 'plan' | 'settle';
  title: string;
  detail: string;
  done: boolean;
}

/** "Getting started" for a new trip: what's done and what's next. */
export function tripChecklist(t: ChecklistInput): ChecklistItem[] {
  return [
    {
      id: 'people',
      title: t.quick ? 'Add the people' : 'Invite your friends',
      detail: t.quick ? 'Add each person by name.' : 'Share the invite link, or add guests by name.',
      done: t.activePeople > 1,
    },
    {
      id: 'zelle',
      title: 'Add your Zelle info',
      detail: 'So people know where to send you money.',
      done: t.myZelle,
    },
    {
      id: 'bill',
      title: 'Add the first bill',
      detail: 'Upload a receipt or type it in.',
      done: t.bills > 0,
    },
    {
      id: 'plan',
      title: 'Set the dates and plan',
      detail: 'Optional: days, activities and a budget.',
      done: t.hasDates,
    },
    {
      id: 'settle',
      title: 'Settle up',
      detail: 'When you’re ready, see the fewest payments.',
      done: t.payments > 0,
    },
  ];
}
