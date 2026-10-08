import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { demoReport } from '../src/lib/data';
let db: PGlite;
const alice = '10000000-0000-4000-8000-000000000001',
  bob = '10000000-0000-4000-8000-000000000002';
let sid: string;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;insert into auth.users values('${alice}'),('${bob}');`,
  );
  await db.exec(readFileSync('supabase/migrations/001_speakbetter.sql', 'utf8'));
  const result = await db.query<{ start_session: string }>(
    `select public.start_session($1,$2::jsonb)`,
    [
      alice,
      JSON.stringify({
        topic: 'Cafe conversation',
        mode: 'Everyday life',
        difficulty: 'Comfortable',
        duration: 5,
        input_mode: 'hands-free',
      }),
    ],
  );
  sid = result.rows[0].start_session;
  await db.query(`select public.save_turns($1,$2,$3::jsonb)`, [
    alice,
    sid,
    JSON.stringify([
      {
        id: '00000000-0000-4000-8000-000000000002',
        role: 'user',
        text: 'Yesterday I go to a cafe.',
        sequence: 0,
      },
    ]),
  ]);
});
afterAll(async () => {
  await db?.close();
});
describe.sequential('PostgreSQL access policies and lifecycle', () => {
  it('prevents a second simultaneous session', async () => {
    await expect(
      db.query('select public.start_session($1,$2::jsonb)', [
        alice,
        JSON.stringify({
          topic: 'Second',
          mode: 'Free',
          difficulty: 'Comfortable',
          duration: 5,
          input_mode: 'hands-free',
        }),
      ]),
    ).rejects.toThrow('active session');
  });
  it('isolates sessions and transcripts by authenticated user', async () => {
    await db.exec(
      `set role authenticated;select set_config('request.jwt.claim.sub','${bob}',false)`,
    );
    expect((await db.query('select * from sessions')).rows).toHaveLength(0);
    expect((await db.query('select * from transcript_turns')).rows).toHaveLength(0);
    await db.exec(`select set_config('request.jwt.claim.sub','${alice}',false)`);
    expect((await db.query('select * from sessions')).rows).toHaveLength(1);
    expect((await db.query('select * from transcript_turns')).rows).toHaveLength(1);
    await db.exec('reset role');
  });
  it('denies browser access to privileged token/quota/session writes', async () => {
    await db.exec(
      `set role authenticated;select set_config('request.jwt.claim.sub','${alice}',false)`,
    );
    await expect(
      db.query(`select public.consume_usage($1,'token',999,60)`, [alice]),
    ).rejects.toThrow('permission denied');
    await expect(db.query(`update sessions set duration=20`)).rejects.toThrow('permission denied');
    await expect(db.query(`update transcript_turns set text='tampered'`)).rejects.toThrow(
      'permission denied',
    );
    await db.exec('reset role');
  });
  it('upserts transcript drafts without duplicating turns', async () => {
    await db.query('select public.save_turns($1,$2,$3::jsonb)', [
      alice,
      sid,
      JSON.stringify([
        {
          id: '00000000-0000-4000-8000-000000000002',
          role: 'user',
          text: 'Yesterday I go to a cafe before work.',
          sequence: 0,
        },
      ]),
    ]);
    expect((await db.query('select * from transcript_turns')).rows).toHaveLength(1);
  });
  it('ends a session idempotently', async () => {
    await db.query('select public.finish_session($1,$2)', [alice, sid]);
    const original = (await db.query<{ ended_at: Date }>('select ended_at from sessions')).rows[0]
      .ended_at;
    await db.query('select public.finish_session($1,$2)', [alice, sid]);
    expect(
      (await db.query<{ ended_at: Date }>('select ended_at from sessions')).rows[0].ended_at,
    ).toEqual(original);
  });
  it('serializes report generation and permits retries after failures', async () => {
    const first = (
      await db.query<{ claim_report: string }>('select public.claim_report($1,$2)', [alice, sid])
    ).rows[0].claim_report;
    expect(first).toBeTruthy();
    expect(
      (
        await db.query<{ claim_report: string | null }>('select public.claim_report($1,$2)', [
          alice,
          sid,
        ])
      ).rows[0].claim_report,
    ).toBeNull();
    await db.query(`update sessions set report_status='failed' where id=$1`, [sid]);
    const second = (
      await db.query<{ claim_report: string }>('select public.claim_report($1,$2)', [alice, sid])
    ).rows[0].claim_report;
    expect(second).not.toEqual(first);
    expect(
      (
        await db.query<{ commit_report: boolean }>(
          'select public.commit_report($1,$2,$3,$4::jsonb)',
          [alice, sid, first, JSON.stringify(demoReport)],
        )
      ).rows[0].commit_report,
    ).toBe(false);
    expect(
      (
        await db.query<{ commit_report: boolean }>(
          'select public.commit_report($1,$2,$3,$4::jsonb)',
          [alice, sid, second, JSON.stringify(demoReport)],
        )
      ).rows[0].commit_report,
    ).toBe(true);
    expect((await db.query('select * from reports')).rows).toHaveLength(1);
    expect((await db.query('select * from exercises')).rows).toHaveLength(3);
    expect((await db.query('select * from vocabulary')).rows).toHaveLength(2);
  });
  it('isolates reports, exercises, and vocabulary', async () => {
    await db.exec(
      `set role authenticated;select set_config('request.jwt.claim.sub','${bob}',false)`,
    );
    for (const table of ['reports', 'exercises', 'vocabulary'])
      expect((await db.query(`select * from ${table}`)).rows).toHaveLength(0);
    await db.exec('reset role');
  });
  it('rate limits atomically', async () => {
    expect(
      (await db.query<{ consume_usage: boolean }>(`select consume_usage($1,'test',2,60)`, [alice]))
        .rows[0].consume_usage,
    ).toBe(true);
    expect(
      (await db.query<{ consume_usage: boolean }>(`select consume_usage($1,'test',2,60)`, [alice]))
        .rows[0].consume_usage,
    ).toBe(true);
    expect(
      (await db.query<{ consume_usage: boolean }>(`select consume_usage($1,'test',2,60)`, [alice]))
        .rows[0].consume_usage,
    ).toBe(false);
  });
  it('prevents deleting another user’s session; own deletion cascades', async () => {
    await db.exec(
      `set role authenticated;select set_config('request.jwt.claim.sub','${bob}',false)`,
    );
    await db.query('delete from sessions where id=$1', [sid]);
    await db.exec('reset role');
    expect((await db.query('select * from sessions')).rows).toHaveLength(1);
    await db.exec(
      `set role authenticated;select set_config('request.jwt.claim.sub','${alice}',false)`,
    );
    await db.query('delete from sessions where id=$1', [sid]);
    await db.exec('reset role');
    for (const table of ['sessions', 'transcript_turns', 'reports', 'exercises', 'vocabulary'])
      expect((await db.query(`select * from ${table}`)).rows).toHaveLength(0);
  });
  it('keeps daily quota after sessions are deleted', async () => {
    const input = JSON.stringify({
      topic: 'Quota test',
      mode: 'Free conversation',
      difficulty: 'Comfortable',
      duration: 20,
      input_mode: 'hands-free',
    });
    for (let i = 0; i < 3; i++) {
      const s = (
        await db.query<{ start_session: string }>('select public.start_session($1,$2::jsonb)', [
          bob,
          input,
        ])
      ).rows[0].start_session;
      await db.query('delete from sessions where id=$1', [s]);
    }
    await expect(
      db.query('select public.start_session($1,$2::jsonb)', [bob, input]),
    ).rejects.toThrow('Daily practice limit reached');
  });
});
