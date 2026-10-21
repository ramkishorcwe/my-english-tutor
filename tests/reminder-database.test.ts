import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
let db: PGlite;
const alice = '10000000-0000-4000-8000-000000000001';
const bob = '10000000-0000-4000-8000-000000000002';
const endpoint = 'https://fcm.googleapis.com/fcm/send/test';
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${alice}'),('${bob}');grant usage on schema public to authenticated,anon,service_role;`,
  );
  await db.exec(readFileSync('supabase/migrations/002_practice_reminders.sql', 'utf8'));
  await db.query('select save_practice_reminder($1,$2,$3,true,$4)', [
    alice,
    '19:30',
    'Asia/Kolkata',
    JSON.stringify({ endpoint, keys: { p256dh: 'key', auth: 'auth' } }),
  ]);
});
afterAll(async () => {
  await db?.close();
});
describe.sequential('daily reminder scheduling', () => {
  it('never fires before the selected time and claims at 7:30 PM IST', async () => {
    expect(
      (await db.query("select * from claim_practice_reminders('2026-10-21T13:59:00Z')")).rows,
    ).toHaveLength(0);
    const result = await db.query<{ user_id: string; token: string; local_date: string }>(
      "select * from claim_practice_reminders('2026-10-21T14:00:00Z')",
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].user_id).toBe(alice);
    expect(
      (await db.query("select * from claim_practice_reminders('2026-10-21T14:00:30Z')")).rows,
    ).toHaveLength(0);
    await db.query('select complete_practice_reminder($1,$2,$3,true)', [
      alice,
      result.rows[0].token,
      result.rows[0].local_date,
    ]);
    expect(
      (await db.query("select * from claim_practice_reminders('2026-10-21T14:05:00Z')")).rows,
    ).toHaveLength(0);
  });
  it('retries a temporary failure on the next tick, and does not let a stale lease mark it sent', async () => {
    const first = (
      await db.query<{ token: string; local_date: string }>(
        "select * from claim_practice_reminders('2026-10-22T14:00:00Z')",
      )
    ).rows[0];
    await db.query('select complete_practice_reminder($1,$2,$3,false)', [
      alice,
      first.token,
      first.local_date,
    ]);
    const second = (
      await db.query<{ token: string; local_date: string }>(
        "select * from claim_practice_reminders('2026-10-22T14:01:00Z')",
      )
    ).rows[0];
    expect(second.token).not.toBe(first.token);
    const stale = await db.query<{ complete_practice_reminder: boolean }>(
      'select complete_practice_reminder($1,$2,$3,true)',
      [alice, first.token, first.local_date],
    );
    expect(stale.rows[0].complete_practice_reminder).toBe(false);
    await db.query('select complete_practice_reminder($1,$2,$3,true)', [
      alice,
      second.token,
      second.local_date,
    ]);
  });
  it('handles a delivery retry just after local midnight without moving it to the wrong day', async () => {
    await db.query('select save_practice_reminder($1,$2,$3,true)', [
      alice,
      '23:55',
      'Asia/Kolkata',
    ]);
    const result = await db.query("select * from claim_practice_reminders('2026-10-23T18:32:00Z')");
    expect(result.rows).toHaveLength(1);
  });
  it('stops claiming after reminders are disabled and rejects unknown time zones', async () => {
    await db.query('select save_practice_reminder($1,$2,$3,false)', [
      alice,
      '19:30',
      'Asia/Kolkata',
    ]);
    expect(
      (await db.query("select * from claim_practice_reminders('2026-10-24T14:00:00Z')")).rows,
    ).toHaveLength(0);
    await expect(
      db.query('select save_practice_reminder($1,$2,$3,false)', [alice, '19:30', 'Bad/Zone']),
    ).rejects.toThrow('Invalid time zone');
  });
  it('denies browser roles direct access to push endpoints and privileged scheduler functions', async () => {
    await db.exec('set role authenticated');
    await expect(db.query('select * from push_subscriptions')).rejects.toThrow('permission denied');
    await expect(db.query('select * from claim_practice_reminders()')).rejects.toThrow(
      'permission denied',
    );
    await db.exec('reset role');
  });
});
