-- Per-user read state for private conversations (DM unread badges in the server rail).
create table if not exists public.conversation_reads(
 user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 last_read_at timestamptz not null default now(),
 primary key(user_id,conversation_id)
);
create index if not exists conversation_reads_conversation_idx on public.conversation_reads(conversation_id);
alter table public.conversation_reads enable row level security;
revoke all on public.conversation_reads from anon,authenticated;
grant select on public.conversation_reads to authenticated;
drop policy if exists conversation_reads_own on public.conversation_reads;
create policy conversation_reads_own on public.conversation_reads for select to authenticated using(user_id=(select auth.uid()));

create or replace function public.mark_conversation_read(target uuid)returns timestamptz
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();stamp timestamptz:=now();
begin
 if me is null then raise exception 'Entre para continuar.' using errcode='42501';end if;
 if not exists(select 1 from public.conversations c where c.id=target and me in(c.user_a,c.user_b))then raise exception 'Conversa sem acesso.' using errcode='42501';end if;
 insert into public.conversation_reads(user_id,conversation_id,last_read_at)values(me,target,stamp)
 on conflict(user_id,conversation_id)do update set last_read_at=greatest(public.conversation_reads.last_read_at,excluded.last_read_at);
 return stamp;
end $$;

-- Unread counts per conversation for the caller; muted people (social_mutes) never badge.
create or replace function public.dm_unread_counts()returns table(conversation_id uuid,other_id uuid,unread integer,last_at timestamptz)
language sql stable security definer set search_path='' as $$
 select c.id,case when c.user_a=auth.uid() then c.user_b else c.user_a end,count(m.id)::integer,max(m.created_at)
 from public.conversations c
 left join public.conversation_reads r on r.conversation_id=c.id and r.user_id=auth.uid()
 join public.direct_messages m on m.conversation_id=c.id and m.author_id<>auth.uid() and m.thread_root is null
  and m.created_at>coalesce(r.last_read_at,'-infinity'::timestamptz) and m.created_at>now()-interval '30 days'
 where auth.uid() in(c.user_a,c.user_b)
  and not exists(select 1 from public.social_mutes s where s.user_id=auth.uid() and s.target_id=case when c.user_a=auth.uid() then c.user_b else c.user_a end and s.mode='mute')
 group by c.id
 having count(m.id)>0
 order by max(m.created_at) desc
 limit 20
$$;
revoke all on function public.mark_conversation_read(uuid),public.dm_unread_counts() from public,anon;
grant execute on function public.mark_conversation_read(uuid),public.dm_unread_counts() to authenticated;
