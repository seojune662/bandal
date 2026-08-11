-- 그룹↔과목 연결의 사용자별 서버 백업.
--
-- 과목은 로컬(기기) 소유 개념이므로 연결의 진실은 여전히 로컬 SQLite다.
-- 이 테이블은 "재로그인 시 로컬 그룹 캐시가 초기화되면서 연결이 전부
-- 풀리는" 문제를 막기 위한 사용자별 백업일 뿐이다. course_id 는 로컬
-- 과목 UUID 문자열이라 서버는 해석하지 않는다(다른 기기에서는 매칭되는
-- 과목이 없으면 그냥 무시된다).

create table public.group_course_links (
  user_id    uuid not null default auth.uid()
             references auth.users(id) on delete cascade,
  group_id   uuid not null
             references public.study_groups(id) on delete cascade,
  course_id  text not null check (char_length(course_id) between 1 and 128),
  updated_at timestamptz not null default now(),
  primary key (user_id, group_id)
);

alter table public.group_course_links enable row level security;

-- 본인 행만 읽고 쓴다. 그룹 멤버십과는 무관한 개인 메모 성격의 데이터.
create policy group_course_links_select on public.group_course_links
  for select using (user_id = (select auth.uid()));
create policy group_course_links_insert on public.group_course_links
  for insert with check (user_id = (select auth.uid()));
create policy group_course_links_update on public.group_course_links
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy group_course_links_delete on public.group_course_links
  for delete using (user_id = (select auth.uid()));

revoke all on public.group_course_links from public, anon;
grant select, insert, update, delete on public.group_course_links to authenticated;
