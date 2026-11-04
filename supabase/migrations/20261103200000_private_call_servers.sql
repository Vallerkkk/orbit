-- Servidores privados de chamadas: criação guiada, convites do criador e acesso de ADM.
-- A interface cria o servidor com invite_only=true; a coluna precisa ser gravável.
grant insert(invite_only) on public.communities to authenticated;

-- O dono enxerga o próprio servidor mesmo antes do trigger de membresia rodar,
-- o que também mantém o INSERT ... RETURNING funcionando em servidor privado.
drop policy if exists communities_read on public.communities;
create policy communities_read on public.communities for select to authenticated
  using(not invite_only or created_by=(select auth.uid()) or orbita_private.is_community_member(id) or orbita_private.can_community(id,'manage_channels'));

-- Convites de servidor privado pertencem exclusivamente ao criador.
-- Em servidor público, mantém a permissão create_invite dos cargos e dos ADMs globais.
create or replace function orbita_private.can_manage_community_invites(target uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select auth.uid() is not null and exists(
  select 1 from public.communities c
  where c.id=target and not orbita_private.is_banned(target,auth.uid()) and (
    c.created_by=auth.uid()
    or (not c.invite_only and (
      exists(select 1 from public.site_roles s where s.user_id=auth.uid() and s.role in('creator','admin'))
      or exists(select 1 from public.community_member_roles mr join public.community_roles r on r.id=mr.role_id and r.community_id=mr.community_id
        where mr.community_id=target and mr.user_id=auth.uid() and 'create_invite'=any(r.permissions))
    ))
  )
) $$;
revoke all on function orbita_private.can_manage_community_invites(uuid) from public,anon;
grant execute on function orbita_private.can_manage_community_invites(uuid) to authenticated;

create or replace function orbita_private.create_community_invite(target uuid, expires_hours integer default 168, uses_limit integer default 100)
returns text language plpgsql security definer set search_path=''
as $$ declare uid uuid:=(select auth.uid()); token text; private_server boolean; begin
  if uid is null then raise exception 'Entre na sua conta.'; end if;
  select invite_only into private_server from public.communities where id=target;
  if private_server is null then raise exception 'Servidor não encontrado.'; end if;
  if not orbita_private.can_manage_community_invites(target) then
    if private_server then raise exception 'Somente o criador deste servidor pode criar convites.' using errcode='42501';
    else raise exception 'Sem permissão para criar convites.' using errcode='42501'; end if;
  end if;
  if expires_hours not between 1 and 720 or uses_limit not between 1 and 500 then raise exception 'Prazo ou limite de usos inválido.'; end if;
  token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  insert into public.community_invites(token_hash,community_id,created_by,expires_at,max_uses)
    values(encode(sha256(convert_to(token,'UTF8')),'hex'),target,uid,now()+make_interval(hours=>expires_hours),uses_limit);
  return token;
end $$;

-- ADM global entra em servidor privado sem convite, mas deixa registro de membresia
-- para que cargos, canais privados e o restante do RLS funcionem normalmente.
create or replace function orbita_private.join_community_as_admin(target uuid)
returns uuid language plpgsql security definer set search_path=''
as $$ declare uid uuid:=(select auth.uid()); begin
  if uid is null then raise exception 'Entre na sua conta.'; end if;
  if not exists(select 1 from public.site_roles r where r.user_id=uid and r.role in('creator','admin')) then
    raise exception 'Apenas administradores do Órbita podem entrar sem convite.' using errcode='42501';
  end if;
  if not exists(select 1 from public.communities where id=target) then raise exception 'Servidor não encontrado.'; end if;
  if orbita_private.is_banned(target,uid) then raise exception 'Você está banido deste servidor.'; end if;
  insert into public.community_members(community_id,user_id) values(target,uid) on conflict do nothing;
  return target;
end $$;
revoke all on function orbita_private.join_community_as_admin(uuid) from public,anon;
grant execute on function orbita_private.join_community_as_admin(uuid) to authenticated;
create or replace function public.join_community_as_admin(target uuid)
returns uuid language sql security invoker set search_path=''
as $$ select orbita_private.join_community_as_admin(target) $$;
revoke all on function public.join_community_as_admin(uuid) from public,anon;
grant execute on function public.join_community_as_admin(uuid) to authenticated;

-- Convites ganham identificador público para listagem e revogação, sem expor o token.
alter table public.community_invites add column if not exists id uuid not null default gen_random_uuid();
create unique index if not exists community_invites_id on public.community_invites(id);

create or replace function orbita_private.list_community_invites(target uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$ begin
  if not orbita_private.can_manage_community_invites(target) then raise exception 'Sem permissão para ver os convites.' using errcode='42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',i.id,'created_by',i.created_by,'created_at',i.created_at,
      'expires_at',i.expires_at,'max_uses',i.max_uses,'uses',i.uses,
      'active',i.expires_at>now() and i.uses<i.max_uses
    ) order by i.created_at desc)
    from public.community_invites i where i.community_id=target
  ),'[]'::jsonb);
end $$;
revoke all on function orbita_private.list_community_invites(uuid) from public,anon;
grant execute on function orbita_private.list_community_invites(uuid) to authenticated;
create or replace function public.list_community_invites(target uuid)
returns jsonb language sql security invoker set search_path=''
as $$ select orbita_private.list_community_invites(target) $$;
revoke all on function public.list_community_invites(uuid) from public,anon;
grant execute on function public.list_community_invites(uuid) to authenticated;

create or replace function orbita_private.revoke_community_invite(target uuid, invitation uuid)
returns boolean language plpgsql security definer set search_path=''
as $$ begin
  if not orbita_private.can_manage_community_invites(target) then raise exception 'Sem permissão para revogar convites.' using errcode='42501'; end if;
  delete from public.community_invites where community_id=target and id=invitation;
  return found;
end $$;
revoke all on function orbita_private.revoke_community_invite(uuid,uuid) from public,anon;
grant execute on function orbita_private.revoke_community_invite(uuid,uuid) to authenticated;
create or replace function public.revoke_community_invite(target uuid, invitation uuid)
returns boolean language sql security invoker set search_path=''
as $$ select orbita_private.revoke_community_invite(target,invitation) $$;
revoke all on function public.revoke_community_invite(uuid,uuid) from public,anon;
grant execute on function public.revoke_community_invite(uuid,uuid) to authenticated;

-- Expulsar exige a mesma hierarquia da moderação. A remoção direta fica restrita
-- a sair do servidor por conta própria; cargos usam a RPC auditada abaixo.
create or replace function orbita_private.remove_community_member(target uuid, member uuid)
returns boolean language plpgsql security definer set search_path=''
as $$ begin
  if not orbita_private.moderation_allowed(target,member) then
    raise exception 'Sem permissão ou cargo de mesma hierarquia.' using errcode='42501';
  end if;
  delete from public.community_members where community_id=target and user_id=member;
  if found then
    insert into public.audit_log(community_id,actor_id,target_id,action,reason)
      values(target,auth.uid(),member,'kick','Removido do servidor');
  end if;
  return found;
end $$;
revoke all on function orbita_private.remove_community_member(uuid,uuid) from public,anon;
grant execute on function orbita_private.remove_community_member(uuid,uuid) to authenticated;
create or replace function public.remove_community_member(target uuid, member uuid)
returns boolean language sql security invoker set search_path=''
as $$ select orbita_private.remove_community_member(target,member) $$;
revoke all on function public.remove_community_member(uuid,uuid) from public,anon;
grant execute on function public.remove_community_member(uuid,uuid) to authenticated;

drop policy if exists community_members_leave on public.community_members;
create policy community_members_leave on public.community_members for delete to authenticated
  using(user_id=(select auth.uid()));

-- Banidos não recuperam acesso por convite nem por entrada pública.
create or replace function orbita_private.join_public_community(target uuid)
returns uuid language plpgsql security definer set search_path=''
as $$ declare uid uuid:=(select auth.uid()); begin
  if uid is null then raise exception 'Entre na sua conta.'; end if;
  if not exists(select 1 from public.communities where id=target and not invite_only) then raise exception 'Este servidor aceita apenas convites.'; end if;
  if orbita_private.is_banned(target,uid) then raise exception 'Você está banido deste servidor.'; end if;
  insert into public.community_members(community_id,user_id) values(target,uid) on conflict do nothing;
  return target;
end $$;

create or replace function orbita_private.join_community_invite(invitation text)
returns uuid language plpgsql security definer set search_path=''
as $$ declare uid uuid:=(select auth.uid()); invite public.community_invites; added integer; begin
  if uid is null then raise exception 'Entre na sua conta para aceitar o convite.'; end if;
  if invitation is null or char_length(invitation) not between 32 and 128 then raise exception 'Convite inválido ou expirado.'; end if;
  select * into invite from public.community_invites where token_hash=encode(sha256(convert_to(invitation,'UTF8')),'hex') for update;
  if not found or invite.expires_at<now() or invite.uses>=invite.max_uses then raise exception 'Convite inválido ou expirado.'; end if;
  if orbita_private.is_banned(invite.community_id,uid) then raise exception 'Você está banido deste servidor.'; end if;
  insert into public.community_members(community_id,user_id) values(invite.community_id,uid) on conflict do nothing;
  get diagnostics added=row_count;
  -- Reabrir um convite já usado pela mesma conta não consome uma entrada.
  if added>0 then update public.community_invites set uses=uses+1 where token_hash=invite.token_hash; end if;
  return invite.community_id;
end $$;

-- ADM global enxerga os canais do servidor privado sem precisar de convite.
-- O dono e administradores mantêm o mesmo acesso que já tinham a canais privados.
create or replace function orbita_private.channel_access_for(member uuid,target uuid)
returns boolean language sql stable security definer set search_path='' as $$ select member is not null and not orbita_private.is_banned(c.community_id,member)
 and (not co.invite_only or co.created_by=member or exists(select 1 from public.site_roles r where r.user_id=member and r.role in('creator','admin')) or exists(select 1 from public.community_members m where m.community_id=c.community_id and m.user_id=member))
 and (not exists(select 1 from public.community_welcome w where w.community_id=c.community_id and btrim(w.rules)<>'' and not exists(select 1 from public.community_rule_acceptances a where a.community_id=w.community_id and a.user_id=member and a.version=w.version)) or co.created_by=member or exists(select 1 from public.site_roles r where r.user_id=member))
 and (not c.is_private or co.created_by=member or exists(select 1 from public.site_roles r where r.user_id=member)
 or exists(select 1 from public.channel_members m where m.channel_id=c.id and m.user_id=member)
 or exists(select 1 from public.community_member_roles mr join public.community_roles r on r.id=mr.role_id and r.community_id=mr.community_id where mr.community_id=c.community_id and mr.user_id=member and 'manage_channels'=any(r.permissions)))
 from public.channels c join public.communities co on co.id=c.community_id where c.id=target $$;
