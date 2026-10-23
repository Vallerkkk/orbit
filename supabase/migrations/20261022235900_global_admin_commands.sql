-- Comandos de moderação do ADM GLOBAL do app (site_roles: 'admin' ou 'creator').
-- Toda checagem é feita aqui (SECURITY DEFINER) a partir de auth.uid(); nada vem do cliente.
-- Cada ação grava em public.site_admin_actions (quem, o quê, quando, alvo).
-- NÃO APLICADA AUTOMATICAMENTE: revisar e aplicar com o dono do projeto.

create table if not exists public.site_admin_actions(
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('delete_community','delete_channel','delete_message','remove_member','ban_member','unban_member','suspend_account','unsuspend_account','transfer_community','end_call','kick_participant')),
  target_type text not null check (target_type in ('community','channel','message','user')),
  target_id uuid not null,
  target_label text not null default '',
  community_id uuid,
  reason text not null default '' check (char_length(reason)<=500),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists site_admin_actions_created_idx on public.site_admin_actions(created_at desc);
alter table public.site_admin_actions enable row level security;
revoke all on public.site_admin_actions from anon, authenticated;
grant select on public.site_admin_actions to authenticated;
drop policy if exists site_admin_actions_read on public.site_admin_actions;
create policy site_admin_actions_read on public.site_admin_actions for select to authenticated using ((select public.is_site_admin()));

-- Exige ADM global vivo (relido do banco com trava de linha) e devolve o ator.
create or replace function orbita_private.require_site_admin() returns uuid
language plpgsql security definer set search_path to '' as $$
declare actor uuid:=auth.uid();
begin
  if actor is null then raise exception 'Entre na sua conta.' using errcode='42501'; end if;
  perform 1 from public.site_roles where user_id=actor and role in ('admin','creator') for share;
  if not found then raise exception 'Somente administradores do app podem usar este comando.' using errcode='42501'; end if;
  return actor;
end $$;

create or replace function orbita_private.admin_log(actor uuid, action_name text, ttype text, tid uuid, label text, community uuid, reason_text text, extra jsonb default '{}'::jsonb) returns void
language sql security definer set search_path to '' as $$
  insert into public.site_admin_actions(actor_id,action,target_type,target_id,target_label,community_id,reason,details)
  values(actor,action_name,ttype,tid,coalesce(label,''),community,left(coalesce(reason_text,''),500),coalesce(extra,'{}'::jsonb));
$$;

create or replace function orbita_private.admin_delete_community(community uuid, confirm_name text, reason_text text default '') returns boolean
language plpgsql security definer set search_path to '' as $$
declare actor uuid:=orbita_private.require_site_admin(); c record;
begin
  select id,name,is_default into c from public.communities where id=community for update;
  if not found then raise exception 'Servidor não encontrado.' using errcode='22023'; end if;
  if c.is_default then raise exception 'O servidor padrão da Órbita não pode ser excluído.' using errcode='42501'; end if;
  if confirm_name is distinct from c.name then raise exception 'Digite o nome exato do servidor para confirmar.' using errcode='22023'; end if;
  perform orbita_private.admin_log(actor,'delete_community','community',c.id,c.name,null,reason_text);
  delete from public.communities where id=c.id;
  return true;
end $$;

create or replace function orbita_private.admin_delete_channel(channel uuid, confirm_name text, reason_text text default '') returns boolean
language plpgsql security definer set search_path to '' as $$
declare actor uuid:=orbita_private.require_site_admin(); ch record;
begin
  select id,name,community_id into ch from public.channels where id=channel for update;
  if not found then raise exception 'Canal não encontrado.' using errcode='22023'; end if;
  if confirm_name is distinct from ch.name then raise exception 'Digite o nome exato do canal para confirmar.' using errcode='22023'; end if;
  perform orbita_private.admin_log(actor,'delete_channel','channel',ch.id,ch.name,ch.community_id,reason_text);
  delete from public.channels where id=ch.id;
  return true;
end $$;

create or replace function orbita_private.admin_delete_message(message uuid, reason_text text default '') returns boolean
language plpgsql security definer set search_path to '' as $$
declare actor uuid:=orbita_private.require_site_admin(); m record;
begin
  select ms.id,ms.author_id,left(ms.content,120) as preview,c.community_id into m from public.messages ms join public.channels c on c.id=ms.channel_id where ms.id=message for update of ms;
  if not found then raise exception 'Mensagem não encontrada.' using errcode='22023'; end if;
  perform orbita_private.admin_log(actor,'delete_message','message',m.id,coalesce(m.preview,''),m.community_id,reason_text,jsonb_build_object('author_id',m.author_id));
  delete from public.messages where id=m.id;
  return true;
end $$;

create or replace function orbita_private.admin_member_action(community uuid, member uuid, action_name text, reason_text text default '') returns boolean
language plpgsql security definer set search_path to '' as $$
declare actor uuid:=orbita_private.require_site_admin(); c record; who text;
begin
  if action_name not in ('remove','ban','unban') then raise exception 'Ação inválida.' using errcode='22023'; end if;
  select id,name,created_by into c from public.communities where id=community;
  if not found then raise exception 'Servidor não encontrado.' using errcode='22023'; end if;
  select username into who from public.profiles where id=member;
  if who is null then raise exception 'Conta não encontrada.' using errcode='22023'; end if;
  if member=actor then raise exception 'Você não pode aplicar isso a si mesmo.' using errcode='42501'; end if;
  if action_name<>'unban' and exists(select 1 from public.site_roles where user_id=member and role='creator') then raise exception 'Criadores do app estão protegidos.' using errcode='42501'; end if;
  if action_name<>'unban' and c.created_by=member then raise exception 'Transfira a posse do servidor antes de remover o dono.' using errcode='42501'; end if;
  if action_name in ('remove','ban') then delete from public.community_members where community_id=community and user_id=member; end if;
  if action_name in ('ban','unban') then
    insert into public.community_moderation(community_id,user_id,banned,reason,updated_by) values(community,member,action_name='ban',left(coalesce(reason_text,''),500),actor)
    on conflict(community_id,user_id) do update set banned=(action_name='ban'),timeout_until=case when action_name='unban' then null else public.community_moderation.timeout_until end,reason=excluded.reason,updated_by=actor,updated_at=now();
  end if;
  perform orbita_private.admin_log(actor,case action_name when 'remove' then 'remove_member' when 'ban' then 'ban_member' else 'unban_member' end,'user',member,who,community,reason_text,jsonb_build_object('community_name',c.name));
  return true;
end $$;

-- Suspensão de conta: usa auth.users.banned_until (bloqueia login e renovação de sessão).
-- hours=0 retira a suspensão. Criadores e outros ADMs não podem ser suspensos.
create or replace function orbita_private.admin_suspend_account(member uuid, confirm_username text, hours integer, reason_text text default '') returns boolean
language plpgsql security definer set search_path to '' as $$
declare actor uuid:=orbita_private.require_site_admin(); who text;
begin
  if hours is null or hours<0 or hours>87600 then raise exception 'Duração inválida (0 a 87600 horas).' using errcode='22023'; end if;
  select username into who from public.profiles where id=member;
  if who is null then raise exception 'Conta não encontrada.' using errcode='22023'; end if;
  if member=actor then raise exception 'Você não pode suspender a própria conta.' using errcode='42501'; end if;
  if exists(select 1 from public.site_roles where user_id=member) then raise exception 'Administradores e criadores não podem ser suspensos.' using errcode='42501'; end if;
  if hours>0 and lower(coalesce(confirm_username,'')) is distinct from lower(who) then raise exception 'Digite o @ exato da conta para confirmar.' using errcode='22023'; end if;
  update auth.users set banned_until=case when hours=0 then null else now()+make_interval(hours=>hours) end where id=member;
  perform orbita_private.admin_log(actor,case when hours=0 then 'unsuspend_account' else 'suspend_account' end,'user',member,who,null,reason_text,jsonb_build_object('hours',hours));
  return true;
end $$;

create or replace function orbita_private.admin_transfer_community(community uuid, new_owner uuid, confirm_name text, reason_text text default '') returns boolean
language plpgsql security definer set search_path to '' as $$
declare actor uuid:=orbita_private.require_site_admin(); c record; who text;
begin
  select id,name,created_by into c from public.communities where id=community for update;
  if not found then raise exception 'Servidor não encontrado.' using errcode='22023'; end if;
  if confirm_name is distinct from c.name then raise exception 'Digite o nome exato do servidor para confirmar.' using errcode='22023'; end if;
  select username into who from public.profiles where id=new_owner;
  if who is null then raise exception 'Novo dono não encontrado.' using errcode='22023'; end if;
  if exists(select 1 from public.community_moderation where community_id=community and user_id=new_owner and banned) then raise exception 'Essa pessoa está banida deste servidor.' using errcode='22023'; end if;
  insert into public.community_members(community_id,user_id) values(community,new_owner) on conflict do nothing;
  update public.communities set created_by=new_owner where id=community;
  perform orbita_private.admin_log(actor,'transfer_community','community',c.id,c.name,c.id,reason_text,jsonb_build_object('from',c.created_by,'to',new_owner,'to_username',who));
  return true;
end $$;

-- Autoriza e registra ações de chamada (o backend executa no LiveKit só depois disto).
create or replace function orbita_private.admin_call_action(channel uuid, action_name text, member uuid default null, reason_text text default '') returns text
language plpgsql security definer set search_path to '' as $$
declare actor uuid:=orbita_private.require_site_admin(); ch record; who text;
begin
  if action_name not in ('end_call','kick_participant') then raise exception 'Ação inválida.' using errcode='22023'; end if;
  select id,name,kind,community_id into ch from public.channels where id=channel;
  if not found or ch.kind<>'voice' then raise exception 'Sala de voz não encontrada.' using errcode='22023'; end if;
  if action_name='kick_participant' then
    select username into who from public.profiles where id=member;
    if who is null then raise exception 'Participante não encontrado.' using errcode='22023'; end if;
    if exists(select 1 from public.site_roles where user_id=member and role='creator') then raise exception 'Criadores do app estão protegidos.' using errcode='42501'; end if;
  end if;
  perform orbita_private.admin_log(actor,action_name,case when action_name='end_call' then 'channel' else 'user' end,coalesce(member,ch.id),coalesce(who,ch.name),ch.community_id,reason_text,jsonb_build_object('channel_id',ch.id,'channel_name',ch.name));
  return ch.name;
end $$;

-- Wrappers públicos (invoker) — mesmo padrão de set_site_admin.
create or replace function public.admin_delete_community(community uuid, confirm_name text, reason_text text default '') returns boolean language sql set search_path to '' as $$select orbita_private.admin_delete_community(community,confirm_name,reason_text)$$;
create or replace function public.admin_delete_channel(channel uuid, confirm_name text, reason_text text default '') returns boolean language sql set search_path to '' as $$select orbita_private.admin_delete_channel(channel,confirm_name,reason_text)$$;
create or replace function public.admin_delete_message(message uuid, reason_text text default '') returns boolean language sql set search_path to '' as $$select orbita_private.admin_delete_message(message,reason_text)$$;
create or replace function public.admin_member_action(community uuid, member uuid, action_name text, reason_text text default '') returns boolean language sql set search_path to '' as $$select orbita_private.admin_member_action(community,member,action_name,reason_text)$$;
create or replace function public.admin_suspend_account(member uuid, confirm_username text, hours integer, reason_text text default '') returns boolean language sql set search_path to '' as $$select orbita_private.admin_suspend_account(member,confirm_username,hours,reason_text)$$;
create or replace function public.admin_transfer_community(community uuid, new_owner uuid, confirm_name text, reason_text text default '') returns boolean language sql set search_path to '' as $$select orbita_private.admin_transfer_community(community,new_owner,confirm_name,reason_text)$$;
create or replace function public.admin_call_action(channel uuid, action_name text, member uuid default null, reason_text text default '') returns text language sql set search_path to '' as $$select orbita_private.admin_call_action(channel,action_name,member,reason_text)$$;

do $$ declare f text; begin
  foreach f in array array[
    'orbita_private.require_site_admin()','orbita_private.admin_log(uuid,text,text,uuid,text,uuid,text,jsonb)',
    'orbita_private.admin_delete_community(uuid,text,text)','orbita_private.admin_delete_channel(uuid,text,text)','orbita_private.admin_delete_message(uuid,text)',
    'orbita_private.admin_member_action(uuid,uuid,text,text)','orbita_private.admin_suspend_account(uuid,text,integer,text)','orbita_private.admin_transfer_community(uuid,uuid,text,text)','orbita_private.admin_call_action(uuid,text,uuid,text)',
    'public.admin_delete_community(uuid,text,text)','public.admin_delete_channel(uuid,text,text)','public.admin_delete_message(uuid,text)','public.admin_member_action(uuid,uuid,text,text)',
    'public.admin_suspend_account(uuid,text,integer,text)','public.admin_transfer_community(uuid,uuid,text,text)','public.admin_call_action(uuid,text,uuid,text)']
  loop execute format('revoke all on function %s from public, anon', f); end loop;
end $$;
revoke all on function orbita_private.admin_log(uuid,text,text,uuid,text,uuid,text,jsonb) from authenticated;
grant execute on function orbita_private.require_site_admin(), orbita_private.admin_delete_community(uuid,text,text), orbita_private.admin_delete_channel(uuid,text,text), orbita_private.admin_delete_message(uuid,text), orbita_private.admin_member_action(uuid,uuid,text,text), orbita_private.admin_suspend_account(uuid,text,integer,text), orbita_private.admin_transfer_community(uuid,uuid,text,text), orbita_private.admin_call_action(uuid,text,uuid,text) to authenticated;
grant execute on function public.admin_delete_community(uuid,text,text), public.admin_delete_channel(uuid,text,text), public.admin_delete_message(uuid,text), public.admin_member_action(uuid,uuid,text,text), public.admin_suspend_account(uuid,text,integer,text), public.admin_transfer_community(uuid,uuid,text,text), public.admin_call_action(uuid,text,uuid,text) to authenticated;
