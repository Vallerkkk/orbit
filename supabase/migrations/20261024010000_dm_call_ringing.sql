-- Private 1:1 calls (DM): ringing state, call kind and duration log.
-- Rows are created by the caller (existing insert policy) and only change through call_event_transition.
alter table public.call_events add column if not exists kind text not null default 'voice';
alter table public.call_events add column if not exists status text not null default 'ringing';
alter table public.call_events add column if not exists answered_at timestamptz;
alter table public.call_events add column if not exists ended_at timestamptz;
alter table public.call_events add column if not exists ended_by uuid references public.profiles(id) on delete set null;
do $$begin
 if not exists(select 1 from pg_constraint where conname='call_events_kind_check')then alter table public.call_events add constraint call_events_kind_check check(kind in('voice','video'));end if;
 if not exists(select 1 from pg_constraint where conname='call_events_status_check')then alter table public.call_events add constraint call_events_status_check check(status in('ringing','accepted','declined','canceled','missed','ended'));end if;
end $$;
-- Legacy rows predate ringing: never let them ring again.
update public.call_events set status='missed' where status='ringing' and created_at<now()-interval '2 minutes';
create index if not exists call_events_ended_by_idx on public.call_events(ended_by);
revoke insert on public.call_events from authenticated;
grant insert(conversation_id,caller_id,kind) on public.call_events to authenticated;
revoke update on public.call_events from authenticated;

create or replace function public.call_event_transition(event uuid,next text)returns public.call_events
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();ev public.call_events;callee uuid;
begin
 if me is null then raise exception 'Entre para continuar.' using errcode='42501';end if;
 select e.* into ev from public.call_events e where e.id=event for update;
 if not found then raise exception 'Chamada inexistente.' using errcode='P0002';end if;
 select case when c.user_a=ev.caller_id then c.user_b else c.user_a end into callee from public.conversations c
  where c.id=ev.conversation_id and me in(c.user_a,c.user_b);
 if callee is null then raise exception 'Chamada sem acesso.' using errcode='42501';end if;
 if next in('accepted','declined')then
  if me<>callee then raise exception 'Só quem recebe pode atender ou recusar.' using errcode='42501';end if;
  if ev.status<>'ringing' or ev.created_at<now()-interval '45 seconds' then raise exception 'Esta chamada já terminou.' using errcode='22023';end if;
  if next='accepted' and not orbita_private.can_call_conversation(ev.conversation_id)then raise exception 'Chamada sem acesso.' using errcode='42501';end if;
 elsif next='canceled' then
  if me<>ev.caller_id then raise exception 'Só quem ligou pode cancelar.' using errcode='42501';end if;
  if ev.status<>'ringing' then return ev;end if;
 elsif next='missed' then
  if ev.status<>'ringing' then return ev;end if;
  if me<>ev.caller_id and ev.created_at>now()-interval '25 seconds' then raise exception 'A chamada ainda está tocando.' using errcode='22023';end if;
 elsif next='ended' then
  if ev.status<>'accepted' then return ev;end if;
 else raise exception 'Estado de chamada inválido.' using errcode='22023';end if;
 update public.call_events set status=next,
  answered_at=case when next='accepted' then now() else answered_at end,
  ended_at=case when next<>'accepted' then now() else ended_at end,
  ended_by=case when next<>'accepted' then me else ended_by end
 where id=event returning * into ev;
 return ev;
end $$;
revoke all on function public.call_event_transition(uuid,text) from public,anon;
grant execute on function public.call_event_transition(uuid,text) to authenticated;
