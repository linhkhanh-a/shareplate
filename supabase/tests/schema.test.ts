/// <reference types="node" />
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Runs the real migration against an in-memory Postgres and checks the
 * rules the app depends on: who can see what, money integrity, and the
 * leave / last-admin / delete-account guards.
 */

const here = __dirname;
const migrationsDir = join(here, '..', 'migrations');

const LINH = '00000000-0000-4000-8000-000000000001';
const AN = '00000000-0000-4000-8000-000000000002';
const OUTSIDER = '00000000-0000-4000-8000-000000000003';

let template: PGlite;
let db: PGlite;

async function freshDatabase() {
  const pg = new PGlite();
  await pg.exec(readFileSync(join(here, 'auth-stub.sql'), 'utf8'));
  for (const file of readdirSync(migrationsDir).sort()) {
    await pg.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }
  await pg.query(
    `insert into auth.users (id, email, raw_user_meta_data) values
      ($1, 'linh@example.com', '{"full_name":"Linh"}'),
      ($2, 'an@example.com', '{"full_name":"An"}'),
      ($3, 'stranger@example.com', '{"full_name":"Stranger"}')`,
    [LINH, AN, OUTSIDER],
  );
  return pg;
}

/** Runs `fn` as a signed-out visitor. */
async function asAnon<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec('set local role anon');
    return fn(tx);
  });
}

/** Runs `fn` as a signed-in user, with row level security applied. */
async function asUser<T>(userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await tx.exec('set local role authenticated');
    return fn(tx);
  });
}

async function createTrip(): Promise<{ groupId: string; linhId: string; anId: string; guestId: string }> {
  const groupId = await asUser(LINH, async (tx) => {
    const r = await tx.query<{ id: string }>(`insert into groups (name) values ('Da Lat trip') returning id`);
    return r.rows[0].id;
  });
  return asUser(LINH, async (tx) => {
    const linh = await tx.query<{ id: string }>(`select id from group_members where user_id = $1`, [LINH]);
    const an = await tx.query<{ id: string }>(
      `insert into group_members (group_id, user_id, display_name) values ($1, $2, 'An') returning id`,
      [groupId, AN],
    );
    const guest = await tx.query<{ id: string }>(
      `insert into group_members (group_id, display_name) values ($1, 'Minh (guest)') returning id`,
      [groupId],
    );
    return { groupId, linhId: linh.rows[0].id, anId: an.rows[0].id, guestId: guest.rows[0].id };
  });
}

/** Saves a bill and who owes what, in one transaction, like the app will. */
async function saveEqualBill(
  userId: string,
  groupId: string,
  payerId: string,
  shares: [memberId: string, cents: number][],
  totalOverride?: number,
) {
  const total = totalOverride ?? shares.reduce((a, [, c]) => a + c, 0);
  return asUser(userId, async (tx) => {
    const bill = await tx.query<{ id: string }>(
      `insert into bills (group_id, paid_by_member_id, split_mode, subtotal_cents, total_cents, vendor)
       values ($1, $2, 'equal', $3, $3, 'Pho shop') returning id`,
      [groupId, payerId, total],
    );
    for (const [memberId, cents] of shares) {
      await tx.query(
        `insert into bill_participants (bill_id, group_member_id, items_cents, amount_cents) values ($1, $2, $3, $3)`,
        [bill.rows[0].id, memberId, cents],
      );
    }
    return bill.rows[0].id;
  });
}

async function balances(userId: string, groupId: string) {
  return asUser(userId, async (tx) => {
    const r = await tx.query<{ display_name: string; balance_cents: string }>(
      `select display_name, balance_cents from member_balances where group_id = $1 order by display_name`,
      [groupId],
    );
    return Object.fromEntries(r.rows.map((x) => [x.display_name, Number(x.balance_cents)]));
  });
}

beforeAll(async () => {
  template = await freshDatabase();
});

// Every test starts from an identical, untouched copy of the database.
beforeEach(async () => {
  db = (await template.clone()) as PGlite;
});

// Each copy holds a whole database in memory; free it before the next test.
afterEach(async () => {
  await db.close();
});

describe('sign-up and trips', () => {
  it('creates a profile on sign-up and makes the trip creator an admin', async () => {
    const { groupId } = await createTrip();
    const r = await asUser(LINH, (tx) =>
      tx.query<{ display_name: string; role: string }>(
        `select display_name, role from group_members where group_id = $1 and user_id = $2`,
        [groupId, LINH],
      ),
    );
    expect(r.rows).toEqual([{ display_name: 'Linh', role: 'admin' }]);
  });

  it('hides a trip and its bills from people who are not in it', async () => {
    const { groupId, linhId, anId } = await createTrip();
    await saveEqualBill(LINH, groupId, linhId, [
      [linhId, 500],
      [anId, 500],
    ]);
    const seen = await asUser(OUTSIDER, async (tx) => ({
      groups: (await tx.query(`select * from groups`)).rows.length,
      bills: (await tx.query(`select * from bills`)).rows.length,
      members: (await tx.query(`select * from group_members`)).rows.length,
    }));
    expect(seen).toEqual({ groups: 0, bills: 0, members: 0 });
  });

  it('lets trip mates see each other’s Zelle info', async () => {
    await createTrip();
    await asUser(AN, (tx) => tx.query(`update profiles set zelle_identifier = 'an@example.com' where id = $1`, [AN]));
    const linhSees = await asUser(LINH, (tx) =>
      tx.query<{ zelle_identifier: string }>(`select zelle_identifier from profiles where id = $1`, [AN]),
    );
    const strangerSees = await asUser(OUTSIDER, (tx) => tx.query(`select * from profiles where id = $1`, [AN]));
    expect(linhSees.rows[0].zelle_identifier).toBe('an@example.com');
    expect(strangerSees.rows).toHaveLength(0);
  });
});

describe('bills and balances', () => {
  it('computes balances, and a guest can pay', async () => {
    const { groupId, linhId, anId, guestId } = await createTrip();
    await saveEqualBill(LINH, groupId, linhId, [
      [linhId, 1000],
      [anId, 1000],
      [guestId, 1000],
    ]);
    await saveEqualBill(LINH, groupId, guestId, [
      [linhId, 600],
      [guestId, 600],
    ]);
    expect(await balances(AN, groupId)).toEqual({ An: -1000, Linh: 1400, 'Minh (guest)': -400 });
  });

  it('refuses a bill whose shares do not add up to the total', async () => {
    const { groupId, linhId, anId } = await createTrip();
    await expect(
      saveEqualBill(
        LINH,
        groupId,
        linhId,
        [
          [linhId, 500],
          [anId, 400],
        ],
        1000,
      ),
    ).rejects.toThrow(/SHARES_NOT_TOTAL/);
  });

  it('refuses a payer from another trip', async () => {
    const { groupId } = await createTrip();
    const otherTrip = await asUser(OUTSIDER, async (tx) => {
      await tx.query(`insert into groups (name) values ('Other trip')`);
      return (await tx.query<{ id: string }>(`select id from group_members where user_id = $1`, [OUTSIDER])).rows[0]
        .id;
    });
    await expect(saveEqualBill(LINH, groupId, otherTrip, [])).rejects.toThrow();
  });

  it('keeps a bill when the itinerary item it was pinned to is deleted', async () => {
    const { groupId, linhId } = await createTrip();
    const billId = await saveEqualBill(LINH, groupId, linhId, [[linhId, 2500]]);
    await asUser(AN, async (tx) => {
      const item = await tx.query<{ id: string }>(
        `insert into itinerary_items (group_id, day_number, title) values ($1, 2, 'Dinner at Seafood Bistro') returning id`,
        [groupId],
      );
      await tx.query(`update bills set itinerary_item_id = $1 where id = $2`, [item.rows[0].id, billId]);
      await tx.query(`delete from itinerary_items where id = $1`, [item.rows[0].id]);
    });
    const bill = await asUser(LINH, (tx) =>
      tx.query<{ itinerary_item_id: string | null; version: number }>(
        `select itinerary_item_id, version from bills where id = $1`,
        [billId],
      ),
    );
    expect(bill.rows[0].itinerary_item_id).toBeNull();
    expect(bill.rows[0].version).toBeGreaterThan(1);
  });
});

describe('membership guards', () => {
  it('blocks leaving with an unpaid balance, then allows it after settling up', async () => {
    const { groupId, linhId, anId } = await createTrip();
    await saveEqualBill(LINH, groupId, linhId, [
      [linhId, 1000],
      [anId, 1000],
    ]);
    const leave = () => asUser(LINH, (tx) => tx.query(`update group_members set left_at = now() where id = $1`, [anId]));
    await expect(leave()).rejects.toThrow(/UNSETTLED_BALANCE/);

    await asUser(AN, (tx) =>
      tx.query(`insert into settlements (group_id, from_member_id, to_member_id, amount_cents) values ($1, $2, $3, 1000)`, [
        groupId,
        anId,
        linhId,
      ]),
    );
    await leave();
    expect(await balances(LINH, groupId)).toMatchObject({ An: 0, Linh: 0 });
  });

  it('never lets the last admin step down or leave', async () => {
    const { linhId, anId } = await createTrip();
    const demoteLinh = () =>
      asUser(LINH, (tx) => tx.query(`update group_members set role = 'member' where id = $1`, [linhId]));
    await expect(demoteLinh()).rejects.toThrow(/LAST_ADMIN/);

    await asUser(LINH, (tx) => tx.query(`update group_members set role = 'admin' where id = $1`, [anId]));
    await demoteLinh();
  });

  it('blocks deleting an account that still owes money', async () => {
    const { groupId, linhId, anId } = await createTrip();
    await saveEqualBill(LINH, groupId, linhId, [
      [linhId, 1000],
      [anId, 1000],
    ]);
    await expect(db.query(`delete from auth.users where id = $1`, [AN])).rejects.toThrow(/UNSETTLED_BALANCE/);
  });

  it('keeps history but frees the seat when a settled member deletes their account', async () => {
    const { groupId, anId } = await createTrip();
    await db.query(`delete from auth.users where id = $1`, [AN]);
    const row = await asUser(LINH, (tx) =>
      tx.query<{ user_id: string | null; left_at: string | null }>(
        `select user_id, left_at from group_members where id = $1 and group_id = $2`,
        [anId, groupId],
      ),
    );
    expect(row.rows[0].user_id).toBeNull();
    expect(row.rows[0].left_at).not.toBeNull();
  });

  it('stops a regular member from changing roles', async () => {
    const { anId } = await createTrip();
    const r = await asUser(AN, (tx) => tx.query(`update group_members set role = 'admin' where id = $1`, [anId]));
    expect(r.affectedRows).toBe(0);
  });
});

describe('privileges', () => {
  it('gives signed-out visitors no access at all', async () => {
    await createTrip();
    await expect(asAnon((tx) => tx.query(`select * from groups`))).rejects.toThrow(/permission denied/);
    await expect(asAnon((tx) => tx.query(`select * from profiles`))).rejects.toThrow(/permission denied/);
  });

  it('keeps internal money functions private', async () => {
    const { linhId } = await createTrip();
    await expect(
      asUser(LINH, (tx) => tx.query(`select _member_balance_cents($1)`, [linhId])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(LINH, (tx) => tx.query(`select check_bill_integrity($1)`, [linhId])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('invite links, joining and leaving', () => {
  const STRANGER_JOINS = async (token: string) =>
    asUser(OUTSIDER, (tx) => tx.query<{ join_group: string }>(`select join_group($1)`, [token]));

  it('lets an admin create one stable invite link and anyone signed in join with it', async () => {
    const { groupId } = await createTrip();
    const token = await asUser(LINH, async (tx) => {
      const a = await tx.query<{ t: string }>(`select get_or_create_invite($1) as t`, [groupId]);
      const b = await tx.query<{ t: string }>(`select get_or_create_invite($1) as t`, [groupId]);
      expect(a.rows[0].t).toBe(b.rows[0].t);
      expect(a.rows[0].t).toMatch(/^[0-9a-f]{32}$/);
      return a.rows[0].t;
    });

    const preview = await asUser(OUTSIDER, (tx) =>
      tx.query<{ group_name: string; member_count: string; invited_by: string; already_member: boolean }>(
        `select group_name, member_count, invited_by, already_member from preview_invite($1)`,
        [token],
      ),
    );
    expect(preview.rows[0]).toMatchObject({ group_name: 'Da Lat trip', invited_by: 'Linh', already_member: false });
    expect(Number(preview.rows[0].member_count)).toBe(3);

    const joined = await STRANGER_JOINS(token);
    expect(joined.rows[0].join_group).toBe(groupId);
    const sees = await asUser(OUTSIDER, (tx) => tx.query(`select * from groups where id = $1`, [groupId]));
    expect(sees.rows).toHaveLength(1);
  });

  it('stops regular members from making invite links', async () => {
    const { groupId } = await createTrip();
    await expect(
      asUser(AN, (tx) => tx.query(`select get_or_create_invite($1)`, [groupId])),
    ).rejects.toThrow(/NOT_ADMIN/);
  });

  it('refuses an old link after the admin resets it', async () => {
    const { groupId } = await createTrip();
    const [oldToken, newToken] = await asUser(LINH, async (tx) => {
      const a = await tx.query<{ t: string }>(`select get_or_create_invite($1) as t`, [groupId]);
      const b = await tx.query<{ t: string }>(`select reset_invite($1) as t`, [groupId]);
      return [a.rows[0].t, b.rows[0].t];
    });
    expect(newToken).not.toBe(oldToken);
    await expect(STRANGER_JOINS(oldToken)).rejects.toThrow(/INVITE_INVALID/);
    await STRANGER_JOINS(newToken);
  });

  it('lets a settled member leave, and rejoin later as the same person', async () => {
    const { groupId, anId } = await createTrip();
    await asUser(AN, (tx) => tx.query(`select leave_group($1)`, [groupId]));
    const gone = await asUser(AN, (tx) => tx.query(`select * from groups where id = $1`, [groupId]));
    expect(gone.rows).toHaveLength(0);

    const token = await asUser(LINH, async (tx) =>
      (await tx.query<{ t: string }>(`select get_or_create_invite($1) as t`, [groupId])).rows[0].t,
    );
    const rejoined = await asUser(AN, async (tx) => {
      await tx.query(`select join_group($1)`, [token]);
      return tx.query<{ id: string }>(`select id from group_members where user_id = $1 and left_at is null`, [AN]);
    });
    expect(rejoined.rows[0].id).toBe(anId);
  });

  it('blocks leaving with money still owed, through the leave function too', async () => {
    const { groupId, linhId, anId } = await createTrip();
    await saveEqualBill(LINH, groupId, linhId, [
      [linhId, 500],
      [anId, 500],
    ]);
    await expect(asUser(AN, (tx) => tx.query(`select leave_group($1)`, [groupId]))).rejects.toThrow(
      /UNSETTLED_BALANCE/,
    );
  });

  it('deletes a whole trip, bills and all, when an admin deletes it', async () => {
    const { groupId, linhId, anId } = await createTrip();
    await saveEqualBill(LINH, groupId, linhId, [
      [linhId, 500],
      [anId, 500],
    ]);
    await asUser(LINH, (tx) => tx.query(`delete from groups where id = $1`, [groupId]));
    const left = await db.query<{ n: string }>(`select count(*) as n from bills`);
    expect(Number(left.rows[0].n)).toBe(0);
  });

  it('never hard-deletes someone who is on a bill; they can only leave', async () => {
    const { groupId, linhId, guestId } = await createTrip();
    await saveEqualBill(LINH, groupId, linhId, [
      [linhId, 500],
      [guestId, 500],
    ]);
    await expect(asUser(LINH, (tx) => tx.query(`delete from group_members where id = $1`, [guestId]))).rejects.toThrow(
      /HAS_HISTORY/,
    );
  });

  it('lets an admin delete a guest who was added by mistake', async () => {
    const { guestId } = await createTrip();
    const r = await asUser(LINH, (tx) => tx.query(`delete from group_members where id = $1`, [guestId]));
    expect(r.affectedRows).toBe(1);
  });

  it('updates someone’s name in their trips when they rename themselves', async () => {
    const { groupId } = await createTrip();
    await asUser(AN, (tx) => tx.query(`update profiles set full_name = 'An Nguyen' where id = $1`, [AN]));
    const r = await asUser(LINH, (tx) =>
      tx.query<{ display_name: string }>(`select display_name from group_members where group_id = $1 and user_id = $2`, [
        groupId,
        AN,
      ]),
    );
    expect(r.rows[0].display_name).toBe('An Nguyen');
  });
});

describe('saving bills', () => {
  async function save(userId: string, bill: Record<string, unknown>) {
    return asUser(userId, async (tx) => {
      const r = await tx.query<{ id: string }>(`select save_bill($1::jsonb) as id`, [JSON.stringify(bill)]);
      return r.rows[0].id;
    });
  }

  it('saves a bill and everyone’s shares together, and balances follow', async () => {
    const { groupId, linhId, anId, guestId } = await createTrip();
    await save(AN, {
      group_id: groupId,
      paid_by_member_id: anId,
      title: 'Hotpot',
      category: 'Food',
      split_mode: 'equal',
      total_cents: 1000,
      participants: [
        { member_id: linhId, amount_cents: 334 },
        { member_id: anId, amount_cents: 333 },
        { member_id: guestId, amount_cents: 333 },
      ],
    });
    expect(await balances(LINH, groupId)).toEqual({ An: 667, Linh: -334, 'Minh (guest)': -333 });
  });

  it('edits a bill by replacing its shares, and catches stale edits', async () => {
    const { groupId, linhId, anId } = await createTrip();
    const base = {
      group_id: groupId,
      paid_by_member_id: linhId,
      title: 'Taxi',
      split_mode: 'percent',
      total_cents: 2000,
      participants: [
        { member_id: linhId, share_input: 5000, amount_cents: 1000 },
        { member_id: anId, share_input: 5000, amount_cents: 1000 },
      ],
    };
    const id = await save(LINH, base);
    await save(AN, {
      ...base,
      id,
      expected_version: 1,
      split_mode: 'exact',
      participants: [
        { member_id: linhId, share_input: 500, amount_cents: 500 },
        { member_id: anId, share_input: 1500, amount_cents: 1500 },
      ],
    });
    expect(await balances(LINH, groupId)).toMatchObject({ An: -1500, Linh: 1500 });

    // Linh still has version 1 open and tries to save over An's change.
    await expect(save(LINH, { ...base, id, expected_version: 1 })).rejects.toThrow(/STALE_BILL/);
  });

  it('refuses shares that do not add up, and leaves nothing half-saved', async () => {
    const { groupId, linhId, anId } = await createTrip();
    await expect(
      save(LINH, {
        group_id: groupId,
        paid_by_member_id: linhId,
        split_mode: 'exact',
        total_cents: 1000,
        participants: [
          { member_id: linhId, share_input: 500, amount_cents: 500 },
          { member_id: anId, share_input: 400, amount_cents: 400 },
        ],
      }),
    ).rejects.toThrow(/SHARES_NOT_TOTAL/);
    const left = await db.query<{ n: string }>(`select count(*) as n from bills`);
    expect(Number(left.rows[0].n)).toBe(0);
  });

  it('only lets trip members save bills', async () => {
    const { groupId, linhId } = await createTrip();
    await expect(
      save(OUTSIDER, {
        group_id: groupId,
        paid_by_member_id: linhId,
        split_mode: 'equal',
        total_cents: 500,
        participants: [{ member_id: linhId, amount_cents: 500 }],
      }),
    ).rejects.toThrow(/row-level security|violates/);
  });

  it('rejects empty or zero bills with a clear reason', async () => {
    const { groupId, linhId } = await createTrip();
    const bill = { group_id: groupId, paid_by_member_id: linhId, split_mode: 'equal', participants: [] };
    await expect(save(LINH, { ...bill, total_cents: 500 })).rejects.toThrow(/NO_PARTICIPANTS/);
    await expect(
      save(LINH, { ...bill, total_cents: 0, participants: [{ member_id: linhId, amount_cents: 0 }] }),
    ).rejects.toThrow(/BAD_AMOUNT/);
  });
});

describe('live updates', () => {
  const activity = async (groupId: string) =>
    (await db.query<{ a: string }>(`select activity_at::text as a from groups where id = $1`, [groupId])).rows[0].a;
  const tick = () => new Promise((r) => setTimeout(r, 5));

  it('bumps the trip’s activity stamp for new bills, deleted bills, payments and people', async () => {
    const { groupId, linhId, anId } = await createTrip();
    let last = await activity(groupId);
    const expectBumped = async () => {
      const now = await activity(groupId);
      expect(now > last).toBe(true);
      last = now;
    };

    await tick();
    const billId = await saveEqualBill(LINH, groupId, linhId, [
      [linhId, 500],
      [anId, 500],
    ]);
    await expectBumped();

    await tick();
    await asUser(AN, (tx) =>
      tx.query(`insert into settlements (group_id, from_member_id, to_member_id, amount_cents) values ($1, $2, $3, 500)`, [
        groupId,
        anId,
        linhId,
      ]),
    );
    await expectBumped();

    await tick();
    await asUser(LINH, (tx) => tx.query(`delete from bills where id = $1`, [billId]));
    await expectBumped();

    await tick();
    await asUser(LINH, (tx) => tx.query(`insert into group_members (group_id, display_name) values ($1, 'Tuấn')`, [groupId]));
    await expectBumped();
  });

  it('publishes trip changes to Supabase Realtime', async () => {
    const r = await db.query(
      `select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'groups'`,
    );
    expect(r.rows).toHaveLength(1);
  });

  it('only lets trip members join a trip’s live channel', async () => {
    const { groupId } = await createTrip();
    const can = (userId: string, topic: string) =>
      asUser(userId, async (tx) => {
        const r = await tx.query<{ ok: boolean }>(`select can_use_trip_channel($1) as ok`, [topic]);
        return r.rows[0].ok;
      });
    expect(await can(LINH, `trip:${groupId}`)).toBe(true);
    expect(await can(LINH, `trip-data:${groupId}`)).toBe(true);
    expect(await can(OUTSIDER, `trip:${groupId}`)).toBe(false);
    expect(await can(OUTSIDER, `trip-data:${groupId}`)).toBe(false);
    expect(await can(LINH, 'trip:not-a-uuid')).toBe(false);
    expect(await can(LINH, `room:${groupId}`)).toBe(false);
  });

  it('enforces the channel rule on Realtime messages', async () => {
    const { groupId } = await createTrip();
    const send = (userId: string) =>
      db.transaction(async (tx) => {
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
        await tx.query(`select set_config('realtime.topic', $1, true)`, [`trip:${groupId}`]);
        await tx.exec('set local role authenticated');
        await tx.query(`insert into realtime.messages (topic, extension, payload) values ($1, 'presence', '{}')`, [
          `trip:${groupId}`,
        ]);
      });
    await send(AN);
    await expect(send(OUTSIDER)).rejects.toThrow(/row-level security/);
  });
});

describe('scanned (itemized) bills and receipt photos', () => {
  async function saveItemized(userId: string, bill: Record<string, unknown>) {
    return asUser(userId, async (tx) => {
      const r = await tx.query<{ id: string }>(`select save_itemized_bill($1::jsonb) as id`, [JSON.stringify(bill)]);
      return r.rows[0].id;
    });
  }

  // The worked example from docs/money-engine.md.
  const dinner = (ids: { linhId: string; anId: string; guestId: string; groupId: string }) => ({
    group_id: ids.groupId,
    paid_by_member_id: ids.linhId,
    title: 'Dinner in Hội An',
    vendor: 'Bếp Việt',
    category: 'Food',
    image_path: `${ids.groupId}/receipt.jpg`,
    discount_cents: 600,
    tax_cents: 240,
    tip_cents: 900,
    items: [
      { name: 'Pho', price_cents: 1500, member_ids: [ids.linhId] },
      { name: 'Banh mi', price_cents: 900, member_ids: [ids.anId] },
      { name: 'Spring rolls', price_cents: 1200, member_ids: [ids.linhId, ids.anId, ids.guestId] },
    ],
    participants: [
      { member_id: ids.linhId, items_cents: 1900, discount_cents: 317, tax_cents: 127, tip_cents: 300, amount_cents: 2010 },
      { member_id: ids.anId, items_cents: 1300, discount_cents: 217, tax_cents: 87, tip_cents: 300, amount_cents: 1470 },
      { member_id: ids.guestId, items_cents: 400, discount_cents: 66, tax_cents: 26, tip_cents: 300, amount_cents: 660 },
    ],
  });

  it('saves items, who had them and each person’s breakdown, with totals worked out by the database', async () => {
    const trip = await createTrip();
    const id = await saveItemized(LINH, dinner(trip));
    const bill = await asUser(AN, (tx) =>
      tx.query<{ split_mode: string; subtotal_cents: string; total_cents: string; vendor: string }>(
        `select split_mode, subtotal_cents, total_cents, vendor from bills where id = $1`,
        [id],
      ),
    );
    expect(bill.rows[0]).toMatchObject({ split_mode: 'itemized', vendor: 'Bếp Việt' });
    expect(Number(bill.rows[0].subtotal_cents)).toBe(3600);
    expect(Number(bill.rows[0].total_cents)).toBe(4140);

    const shared = await asUser(AN, (tx) =>
      tx.query<{ n: string }>(
        `select count(*) as n from bill_item_mappings m join bill_items i on i.id = m.bill_item_id
         where i.bill_id = $1 and i.name = 'Spring rolls'`,
        [id],
      ),
    );
    expect(Number(shared.rows[0].n)).toBe(3);
    expect(await balances(LINH, trip.groupId)).toEqual({ An: -1470, Linh: 2130, 'Minh (guest)': -660 });
  });

  it('edits a scanned bill by replacing its items, and catches stale edits', async () => {
    const trip = await createTrip();
    const id = await saveItemized(LINH, dinner(trip));
    await saveItemized(AN, {
      ...dinner(trip),
      id,
      expected_version: 1,
      discount_cents: 0,
      tax_cents: 0,
      tip_cents: 0,
      items: [{ name: 'Pho', price_cents: 1500, member_ids: [trip.linhId] }],
      participants: [{ member_id: trip.linhId, items_cents: 1500, amount_cents: 1500 }],
    });
    const items = await asUser(LINH, (tx) => tx.query(`select name from bill_items where bill_id = $1`, [id]));
    expect(items.rows).toEqual([{ name: 'Pho' }]);
    await expect(saveItemized(LINH, { ...dinner(trip), id, expected_version: 1 })).rejects.toThrow(/STALE_BILL/);
  });

  it('refuses an item nobody had, and breakdowns that do not add up', async () => {
    const trip = await createTrip();
    const bill = dinner(trip);
    await expect(
      saveItemized(LINH, { ...bill, items: [...bill.items, { name: 'Tea', price_cents: 300, member_ids: [] }] }),
    ).rejects.toThrow(/ITEM_UNASSIGNED/);
    await expect(
      saveItemized(LINH, { ...bill, participants: bill.participants.slice(0, 2) }),
    ).rejects.toThrow(/SHARES_NOT_TOTAL/);
  });

  it('keeps receipt photos private to the trip', async () => {
    const { groupId } = await createTrip();
    const upload = (userId: string, name: string) =>
      asUser(userId, (tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [name]));
    await upload(AN, `${groupId}/dinner.jpg`);
    await expect(upload(OUTSIDER, `${groupId}/sneaky.jpg`)).rejects.toThrow(/row-level security/);
    await expect(upload(AN, `../${groupId}/x.jpg`)).rejects.toThrow(/row-level security/);

    const seen = (userId: string) =>
      asUser(userId, async (tx) => (await tx.query(`select name from storage.objects`)).rows.length);
    expect(await seen(LINH)).toBe(1);
    expect(await seen(OUTSIDER)).toBe(0);
  });

  it('creates the private receipts bucket', async () => {
    const r = await db.query<{ public: boolean }>(`select public from storage.buckets where id = 'receipts'`);
    expect(r.rows).toEqual([{ public: false }]);
  });
});
