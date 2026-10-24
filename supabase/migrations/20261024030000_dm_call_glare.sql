-- One active private call per DM (fixes glare: A and B calling each other at once).
-- start_dm_call serialises starts per conversation, expires stale rings (35 s) and
-- returns the existing ringing/accepted call instead of creating a second one.
update public.call_events set status='missed',ended_at=coalesce(ended_at,now())
 where status='ringing' and created_at<now()-interval '35 seconds';
update public.call_events set status='ended',ended_at=coalesce(ended_at,now())
 where status='accepted' and coalesce(answered_at,created_at)<now()-interval '6 hours';
-- Any duplicates left from before the guard: keep only the newest active row.
update public.call_events e set status=case when e.status='ringing' then 'missed' else 'ended' end,ended_at=coalesce(e.ended_at,now())
 where e.status in('ringing','accepted') and exists(select 1 from public.call_events n
  where n.conversation_id=e.conversation_id and n.status in('ringing','accepted') and (n.created_at,n.id)>(e.created_at,e.id));
create unique index if not exists call_events_one_active_per_dm on public.call_events(conversation_id) where status in('ringing','accepted');

create or replace function public.start_dm_call(target uuid,call_kind text default 'voice')
returns table(event public.call_events,existing boolean,server_now timestamptz)
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();ev public.call_events;
begin
 if me is null then raise exception 'Entre para continuar.' using errcode='42501';end if;
 if call_kind not in('voice','video') then raise exception 'Tipo de chamada inválido.' using errcode='22023';end if;
 -- Row lock on the conversation makes simultaneous starts resolve to the first one.
 perform 1 from public.conversations c where c.id=target and me in(c.user_a,c.user_b) for update;
 if not found then raise exception 'Chamada sem acesso.' using errcode='42501';end if;
 if not orbita_private.can_call_conversation(target) then raise exception 'Chamada sem acesso.' using errcode='42501';end if;
 update public.call_events set status='missed',ended_at=now()
  where conversation_id=target and status='ringing' and created_at<now()-interval '35 seconds';
 update public.call_events set status='ended',ended_at=now()
  where conversation_id=target and status='accepted' and coalesce(answered_at,created_at)<now()-interval '6 hours';
 select e.* into ev from public.call_events e where e.conversation_id=target and e.status in('ringing','accepted') limit 1;
 if found then return query select ev,true,now();return;end if;
 insert into public.call_events(conversation_id,caller_id,kind) values(target,me,call_kind) returning * into ev;
 return query select ev,false,now();
end $$;
revoke all on function public.start_dm_call(uuid,text) from public,anon;
grant execute on function public.start_dm_call(uuid,text) to authenticated;

-- Ringing calls addressed to me (fallback when realtime missed the INSERT, e.g. a
-- background desktop tab), with the server clock so clients can ignore skew.
create or replace function public.dm_ringing_calls()
returns table(event public.call_events,server_now timestamptz)
language sql stable security definer set search_path='' as $$
 select e,now() from public.call_events e join public.conversations c on c.id=e.conversation_id
 where (select auth.uid()) in(c.user_a,c.user_b) and e.caller_id<>(select auth.uid())
  and e.status='ringing' and e.created_at>now()-interval '30 seconds'
 order by e.created_at desc limit 3
$$;
revoke all on function public.dm_ringing_calls() from public,anon;
grant execute on function public.dm_ringing_calls() to authenticated;
