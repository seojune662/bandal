-- Minimal Auth/profile/account-deletion fixture. No production project is used.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,nickname text not null,deleted_at timestamptz);
create table public.bandal_account_deletions(user_id uuid primary key);
create function public.bandal_account_write_guard() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if auth.uid() is not null then
   perform pg_advisory_xact_lock_shared(hashtextextended(auth.uid()::text,812));
   if exists(select 1 from public.bandal_account_deletions where user_id=auth.uid()) then raise exception 'account_deletion_in_progress' using errcode='42501'; end if;
 end if;
 return new;
end $$;
-- Reproduce Supabase's direct authenticated default EXECUTE privilege.
alter default privileges in schema public grant execute on functions to authenticated,anon,service_role;
insert into auth.users values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222'),('33333333-3333-4333-8333-333333333333'),('44444444-4444-4444-8444-444444444444'),('55555555-5555-4555-8555-555555555555');
insert into public.profiles(id,nickname) values('11111111-1111-4111-8111-111111111111','참여자'),('22222222-2222-4222-8222-222222222222','다른참여자'),('33333333-3333-4333-8333-333333333333','운영자'),('44444444-4444-4444-8444-444444444444','탈퇴예정'),('55555555-5555-4555-8555-555555555555','운영자2');
