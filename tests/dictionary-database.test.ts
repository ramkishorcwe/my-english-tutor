import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
let db: PGlite;
const alice = crypto.randomUUID(),
  bob = crypto.randomUUID();
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${alice}'),('${bob}');grant usage on schema public,auth to authenticated,anon;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`,
  );
  await db.exec(readFileSync('supabase/migrations/003_writing_chat.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/004_dictionary_long_messages.sql', 'utf8'));
  await db.query(
    'insert into personal_dictionary(user_id,term,term_key,target_language,source_language,translation,meaning,example) values($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      alice,
      'initiative',
      'a'.repeat(64),
      'Hindi',
      'English',
      'पहल',
      'Taking the first step.',
      'Show initiative at work.',
    ],
  );
  await db.query(
    'insert into personal_dictionary(user_id,term,term_key,target_language,source_language,translation,meaning,example) values($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      bob,
      'initiative',
      'a'.repeat(64),
      'Hindi',
      'English',
      'पहल',
      'Taking the first step.',
      'Show initiative at work.',
    ],
  );
});
afterAll(async () => {
  await db?.close();
});
describe.sequential('dictionary privacy and deduplication', () => {
  it('prevents duplicate lookups for one user and language while keeping users separate', async () => {
    expect((await db.query('select * from personal_dictionary')).rows).toHaveLength(2);
    await expect(
      db.query(
        'insert into personal_dictionary(user_id,term,term_key,target_language,source_language,translation,meaning,example) values($1,$2,$3,$4,$5,$6,$7,$8)',
        [alice, 'INITIATIVE', 'a'.repeat(64), 'Hindi', 'English', 'पहल', 'Meaning', 'Example'],
      ),
    ).rejects.toThrow('duplicate key');
  });
  it('only lets a signed-in user read their own dictionary and prevents browser writes', async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [alice]);
    await db.exec('set role authenticated');
    expect((await db.query('select user_id from personal_dictionary')).rows).toEqual([
      { user_id: alice },
    ]);
    await expect(db.query('delete from personal_dictionary')).rejects.toThrow('permission denied');
    await db.exec('reset role');
    await db.exec('set role anon');
    await expect(db.query('select * from personal_dictionary')).rejects.toThrow(
      'permission denied',
    );
    await db.exec('reset role');
  });
});
