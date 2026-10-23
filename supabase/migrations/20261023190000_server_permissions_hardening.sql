-- Endurece permissões de servidor (comunidade).
-- Auditoria: o RLS de produção já barra membros comuns (communities_manage,
-- channels_*, community_roles_manage, member_roles_manage, self_roles_safe).
-- O relato veio do cliente (engrenagem visível a todos). Isto é defesa em
-- profundidade:
-- 1) Cargos self_assignable seguem sem permissões (já garantido por self_roles_safe).
-- 2) Cargos não podem ser movidos entre servidores nem ter id/created_at trocados.
-- 3) Edição dos dados do servidor (nome, descrição, convite) segue restrita ao
--    dono e aos ADMs globais; helper único para o RLS e para o cliente.

create or replace function orbita_private.guard_role_scope()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and new.community_id is distinct from old.community_id then
    raise exception 'Cargos não podem mudar de servidor.' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function orbita_private.guard_role_scope() from public,anon,authenticated;
drop trigger if exists community_roles_guard_scope on public.community_roles;
create trigger community_roles_guard_scope before update on public.community_roles
  for each row execute function orbita_private.guard_role_scope();

revoke update (id, community_id, created_at) on public.community_roles from authenticated;

create or replace function orbita_private.can_edit_community(target uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (
    exists(select 1 from public.communities c where c.id=target and c.created_by=auth.uid())
    or exists(select 1 from public.site_roles s where s.user_id=auth.uid() and s.role in('creator','admin')))
$$;
revoke all on function orbita_private.can_edit_community(uuid) from public,anon;
grant execute on function orbita_private.can_edit_community(uuid) to authenticated;

create or replace function public.can_edit_community(target uuid)
returns boolean language sql stable security invoker set search_path='' as $$select orbita_private.can_edit_community(target)$$;
revoke all on function public.can_edit_community(uuid) from public,anon;
grant execute on function public.can_edit_community(uuid) to authenticated;

drop policy if exists communities_manage on public.communities;
create policy communities_manage on public.communities for update to authenticated
  using (orbita_private.can_edit_community(id)) with check (orbita_private.can_edit_community(id));
