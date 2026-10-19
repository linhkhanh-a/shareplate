/**
 * What changed in each release, in plain words, newest first. Add an entry
 * when something people will notice ships; the newest id is also the app
 * version sent with feedback.
 */
export interface Release {
  /** Unique and increasing, e.g. "2026-10-19". */
  id: string;
  date: string;
  title: string;
  items: string[];
}

export const CHANGELOG: Release[] = [
  {
    id: '2026-10-19c',
    date: 'Oct 19, 2026',
    title: 'Pay with Venmo, PayPal or Cash App, and split by shares',
    items: [
      'Add your Venmo, PayPal or Cash App in your profile. In Settle up, one tap opens the app with the amount filled in.',
      'Personal messages from Share and export include those one-tap links.',
      'A new By shares split: 2 shares for a couple, 0.5 for a child, and the bill is split in proportion.',
    ],
  },
  {
    id: '2026-10-19b',
    date: 'Oct 19, 2026',
    title: 'Bills in any currency',
    items: [
      'Add a bill paid in yen, francs, dong or 30 other currencies: the day’s exchange rate fills in by itself.',
      'Change the rate to what your card charged, if it was different.',
      'Everyone’s share is converted to the trip’s currency, and the bill still shows what was paid.',
    ],
  },
  {
    id: '2026-10-19',
    date: 'Oct 19, 2026',
    title: 'A picture tour, install the app, and send feedback',
    items: [
      'The tour now shows a small picture of each screen.',
      'Install Shareplate as an app on your computer or phone from Help or your profile. It updates by itself.',
      'Send ideas, problems or questions from Help with Send feedback.',
      'This "What’s new" page, so you can see what changed.',
    ],
  },
  {
    id: '2026-10-18c',
    date: 'Oct 18, 2026',
    title: 'Help, Getting started and safer bill changes',
    items: [
      'A Help page with step-by-step guides and answers to common questions.',
      'New trips show a Getting started list that ticks itself off.',
      'Deleting or editing a bill shows whose balance changes first.',
      'Admins can Start over: clear all bills and payments in a trip.',
    ],
  },
  {
    id: '2026-10-18b',
    date: 'Oct 18, 2026',
    title: 'Easier bills and plans',
    items: [
      'One Add bill button: upload a receipt, or type one total or item by item.',
      'Leave someone blank in a split and they get the rest.',
      'Discount, tax and tip in $ or %; amounts round to the cent by themselves.',
      'Calendar and AM/PM for dates and times, and place search for the plan.',
      'Trip tabs: Bills, Plan, People, Updates and Settings.',
    ],
  },
  {
    id: '2026-10-18a',
    date: 'Oct 18, 2026',
    title: 'Fairer money rules',
    items: [
      'People who leave a trip stay at $0.00, and admins can bring them back.',
      'Payments are removed (not undone), only by the people involved or an admin.',
      'Messages include Zelle info, and admins can add a guest’s Zelle.',
    ],
  },
];

export const APP_VERSION = CHANGELOG[0].id;

/** Releases newer than the one last seen (all of them if none was seen). */
export function unseenReleases(lastSeen: string | null): Release[] {
  return lastSeen ? CHANGELOG.filter((r) => r.id > lastSeen) : CHANGELOG;
}
