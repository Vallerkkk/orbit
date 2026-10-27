-- Painel administrativo: leitura resumida, sem mensagens privadas ou IPs.
-- Execute após as migrações do projeto; não reaplique supabase.sql em produção.
create or replace function public.adm_member_summary()
returns table (
  id uuid, username text, display_name text, role text,
  created_at timestamptz, last_sign_in_at timestamptz,
  recent_login boolean
)
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.site_roles sr
    where sr.user_id = auth.uid() and sr.role in ('creator','admin')
  ) then
    raise exception 'Acesso administrativo negado' using errcode = '42501';
  end if;
  return query
  select u.id, p.username, p.display_name,
         coalesce(sr.role, 'member')::text,
         u.created_at, u.last_sign_in_at,
         (u.last_sign_in_at >= now() - interval '24 hours')
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.site_roles sr on sr.user_id = u.id
    order by u.created_at desc
    limit 2000;
end;
$$;
revoke all on function public.adm_member_summary() from public, anon;
grant execute on function public.adm_member_summary() to authenticated;
comment on function public.adm_member_summary() is
 'Somente admins globais. recent_login indica login nas últimas 24h, NÃO conexão em tempo real.';
