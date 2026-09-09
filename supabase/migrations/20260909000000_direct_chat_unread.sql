-- Counts are computed from visible incoming messages, never from sequence gaps.
-- This also corrects old cursors without discarding genuinely unread messages.
create or replace function public.direct_chat_summaries()
returns table (peer_id uuid, unread bigint, last_message_preview text, last_message_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select peer.user_id,
         (select count(*) from public.messages msg
           where msg.group_id = g.id and msg.seq > member.last_read_seq
             and msg.author_id <> auth.uid() and msg.kind = 'text'
             and msg.deleted_at is null),
         latest.body, latest.created_at
    from public.group_members member
    join public.study_groups g on g.id = member.group_id
    join public.group_members peer on peer.group_id = g.id
      and peer.user_id <> member.user_id and peer.left_at is null
    left join lateral (
      select left(msg.body, 160) as body, msg.created_at
        from public.messages msg where msg.group_id = g.id
          and msg.kind = 'text' and msg.deleted_at is null
        order by msg.seq desc limit 1
    ) latest on true
   where member.user_id = auth.uid() and member.left_at is null
     and g.kind = 'direct' and g.deleted_at is null
     and public.is_friend(auth.uid(), peer.user_id)
     and not public.is_blocked_either_way(auth.uid(), peer.user_id);
$$;
revoke all on function public.direct_chat_summaries() from public, anon;
grant execute on function public.direct_chat_summaries() to authenticated;

-- Sending advances an already caught-up cursor. It must not mark unseen earlier
-- incoming messages read when an offline/outbox message is delivered.
create or replace function public.direct_message_sender_read()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'text' and new.author_id = auth.uid() and exists (
    select 1 from public.study_groups where id = new.group_id and kind = 'direct'
  ) then
    update public.group_members set last_read_seq = new.seq
      where group_id = new.group_id and user_id = new.author_id
        and last_read_seq = new.seq - 1;
  end if;
  return new;
end;
$$;
revoke all on function public.direct_message_sender_read() from public, anon, authenticated;
create trigger direct_message_sender_read_trg after insert on public.messages
  for each row execute function public.direct_message_sender_read();
