-- leave_group 버그 수정: 마지막 멤버(오너)가 나가면 그룹을 소프트 삭제한 뒤
-- 'left' 시스템 메시지를 넣으려다 messages_before_insert 의 group_not_found 에
-- 걸려 탈퇴 트랜잭션 전체가 롤백됐다. 혼자 남은 그룹은 영원히 나갈 수 없었다.
-- 해산(disband)된 경우에는 읽을 사람도 없으므로 시스템 메시지를 생략한다.

create or replace function public.leave_group(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
  v_next uuid;
  v_disbanded boolean := false;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select m.role into v_role
    from public.group_members m
   where m.group_id = p_group_id and m.user_id = v_uid and m.left_at is null;
  if not found then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;

  if v_role = 'owner' then
    -- 오너 승계: admin 우선, 없으면 가장 오래된 member.
    select m.user_id into v_next
      from public.group_members m
     where m.group_id = p_group_id and m.user_id <> v_uid and m.left_at is null
     order by (m.role = 'admin') desc, m.joined_at asc
     limit 1;

    if v_next is null then
      -- 마지막 한 명이 나가면 그룹은 소프트 삭제된다.
      update public.study_groups set deleted_at = now() where id = p_group_id;
      v_disbanded := true;
    else
      update public.group_members set role = 'owner'
       where group_id = p_group_id and user_id = v_next;
      update public.study_groups set owner_id = v_next where id = p_group_id;
    end if;
  end if;

  update public.group_members
     set left_at = now(), role = 'member'
   where group_id = p_group_id and user_id = v_uid;

  if not v_disbanded then
    perform public.post_system_message(p_group_id, v_uid, 'left');
  end if;
  return jsonb_build_object('ok', true, 'ownerTransferredTo', v_next);
end;
$$;
