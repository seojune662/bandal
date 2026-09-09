import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'

// Opt-in local PostgreSQL integration. Never connects to a user/production DB.
test.skipIf(process.env.BANDAL_TEST_POSTGRES !== '1')('direct-chat SQL counts only unseen incoming text, protects peers, and advances only caught-up senders', () => {
  const root = mkdtempSync(join(tmpdir(), 'bandal-pg-test-'))
  const data = join(root, 'data'), socket = join(root, 'socket')
  mkdirSync(socket)
  let started = false
  try {
    execFileSync('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres'], { stdio: 'pipe' })
    execFileSync('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-h '' -k ${socket} -p 55493`, '-w', 'start'], { stdio: 'pipe' })
    started = true
    const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20260909000000_direct_chat_unread.sql'), 'utf8')
    const sql = `
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;
      create table study_groups(id uuid primary key, kind text, deleted_at timestamptz);
      create table group_members(group_id uuid, user_id uuid, left_at timestamptz, last_read_seq bigint not null default 0);
      create table messages(group_id uuid, author_id uuid, seq bigint, kind text, body text, created_at timestamptz default now(), deleted_at timestamptz);
      create table friendships(user_a uuid, user_b uuid, status text);
      create table blocks(blocker_id uuid, blocked_id uuid);
      create function public.is_friend(a uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.friendships where status='accepted' and ((user_a=a and user_b=b) or (user_a=b and user_b=a))) $$;
      create function public.is_blocked_either_way(a uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.blocks where (blocker_id=a and blocked_id=b) or (blocker_id=b and blocked_id=a)) $$;
      ${migration}
      insert into study_groups values ('00000000-0000-0000-0000-000000000001','direct',null);
      insert into group_members(group_id,user_id) values
        ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a'),
        ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b');
      insert into friendships values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b','accepted');
      select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
      insert into messages(group_id,author_id,seq,kind,body) values
        ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a',1,'text','own'),
        ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b',2,'system','joined'),
        ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b',3,'text','incoming'),
        ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a',4,'text','offline outgoing'),
        ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b',5,'text','deleted');
      update messages set deleted_at=now() where seq=5;
      do $$ begin
        if (select last_read_seq from group_members where user_id=auth.uid()) <> 1 then raise exception 'sender cursor skipped unseen incoming'; end if;
      end $$;
      set role authenticated;
      do $$ begin
        if (select unread from direct_chat_summaries()) <> 1 then raise exception 'count included own/system/deleted messages'; end if;
        if (select last_message_preview from direct_chat_summaries()) <> 'offline outgoing' then raise exception 'preview incorrect'; end if;
      end $$;
      select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
      do $$ begin if exists(select 1 from direct_chat_summaries()) then raise exception 'outsider data leak'; end if; end $$;
      reset role;
      select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
      update group_members set last_read_seq=5 where user_id=auth.uid();
      insert into messages(group_id,author_id,seq,kind,body) values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a',6,'text','caught up');
      do $$ begin if (select last_read_seq from group_members where user_id=auth.uid()) <> 6 then raise exception 'caught-up sender cursor failed'; end if; end $$;
      insert into blocks values ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000a');
      set role authenticated;
      do $$ begin if exists(select 1 from direct_chat_summaries()) then raise exception 'blocked peer data leak'; end if; end $$;
      select 'PASS';
    `
    expect(execFileSync('psql', ['-h', socket, '-p', '55493', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: sql, encoding: 'utf8' })).toContain('PASS')
  } finally {
    if (started) execFileSync('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' })
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
