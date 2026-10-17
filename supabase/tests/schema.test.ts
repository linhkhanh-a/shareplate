/// <reference types="node" />
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
  // Supabase grants these by default.
  await pg.exec(`
    grant usage on schema public to anon, authenticated, service_role;
    grant all on all tables in schema public to authenticated, service_role;
  `);
  await pg.query(
    `insert into auth.users (id, email, raw_user_meta_data) values
      ($1, 'linh@example.com', '{"full_name":"Linh"}'),
      ($2, 'an@example.com', '{"full_name":"An"}'),
      ($3, 'stranger@example.com', '{"full_name":"Stranger"}')`,
    [LINH, AN, OUTSIDER],
  );
  return pg;
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
