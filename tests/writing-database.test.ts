import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
let db: PGlite;
const alice = crypto.randomUUID(),
  bob = crypto.randomUUID(),
  chat = crypto.randomUUID();
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${alice}'),('${bob}');grant usage on schema public to authenticated,anon;`,
  );
  await db.exec(readFileSync('supabase/migrations/003_writing_chat.sql', 'utf8'));
  await db.query('insert into writing_chats(id,user_id,topic) values($1,$2,$3)', [
    chat,
    alice,
    'Surprise me',
  ]);
});
afterAll(async () => {
  await db?.close();
});
async function claim(request: string, text: string | null, user = alice) {
  const r = await db.query<{ claim_writing_reply: { state: string; lease: string } }>(
    'select claim_writing_reply($1,$2,$3,$4)',
    [user, chat, request, text],
  );
  return r.rows[0].claim_writing_reply;
}
async function complete(request: string, lease: string, text: string) {
  const r = await db.query<{ complete_writing_reply: boolean }>(
    'select complete_writing_reply($1,$2,$3,$4,$5)',
    [alice, chat, request, lease, text],
  );
  return r.rows[0].complete_writing_reply;
}
describe.sequential('private chat lifecycle and idempotency', () => {
  it('allows one tutor opening, and caches the same request without another message', async () => {
    const first = await claim(chat, null);
    expect(first.state).toBe('claimed');
    expect((await claim(chat, null)).state).toBe('busy');
    expect(await complete(chat, first.lease, 'I’m your AI tutor. What did you do yesterday?')).toBe(
      true,
    );
    expect((await claim(chat, null)).state).toBe('complete');
    expect((await db.query('select * from writing_chat_turns')).rows).toHaveLength(1);
  });
  it('persists a learner message once, protects pending retries, and rejects stale completions', async () => {
    const request = crypto.randomUUID();
    const first = await claim(request, 'Yesterday I go to shop.');
    expect((await claim(request, 'Yesterday I go to shop.')).state).toBe('busy');
    await expect(claim(request, 'changed payload')).rejects.toThrow('does not match');
    await db.query(
      "update writing_chat_requests set lease_until=now()-interval '1 second' where request_id=$1",
      [request],
    );
    await expect(claim(crypto.randomUUID(), 'Another message')).rejects.toThrow('pending reply');
    const retry = await claim(request, 'Yesterday I go to shop.');
    expect(retry.lease).not.toBe(first.lease);
    expect(await complete(request, first.lease, 'Stale reply')).toBe(false);
    expect(await complete(request, retry.lease, 'What did you buy there?')).toBe(true);
    expect(
      (await db.query("select * from writing_chat_turns where role='user'")).rows,
    ).toHaveLength(1);
    expect((await claim(request, 'Yesterday I go to shop.')).state).toBe('complete');
  });
  it('enforces ownership and keeps chat internals inaccessible to browser roles', async () => {
    await expect(claim(crypto.randomUUID(), 'Read another user', bob)).rejects.toThrow('not found');
    await db.exec('set role authenticated');
    await expect(db.query('select * from writing_chat_turns')).rejects.toThrow('permission denied');
    await expect(
      db.query('select claim_writing_reply($1,$2,$3,null)', [alice, chat, chat]),
    ).rejects.toThrow('permission denied');
    await db.exec('reset role');
  });
  it('ends the chat, prevents new turns, and permits only one review lease', async () => {
    await db.query('select end_writing_chat($1,$2)', [alice, chat]);
    await expect(claim(crypto.randomUUID(), 'After ending')).rejects.toThrow('has ended');
    const first = await db.query<{ claim_writing_review: string | null }>(
      'select claim_writing_review($1,$2)',
      [alice, chat],
    );
    expect(first.rows[0].claim_writing_review).toBeTruthy();
    const next = await db.query<{ claim_writing_review: string | null }>(
      'select claim_writing_review($1,$2)',
      [alice, chat],
    );
    expect(next.rows[0].claim_writing_review).toBeNull();
  });
});
