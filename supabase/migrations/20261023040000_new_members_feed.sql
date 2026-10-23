-- Feed "Novos membros": lista pública de quem entrou (só campos públicos de profiles + data de cadastro
-- vinda de auth.users) e boas-vindas (👋) com RLS. Nunca expõe e-mail nem metadados privados.
create table if not exists public.member_welcomes(
  member_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(member_id,user_id),
  constraint member_welcomes_not_self check(member_id<>user_id)
);
create index if not exists member_welcomes_user_idx on public.member_welcomes(user_id);
alter table public.member_welcomes enable row level security;
revoke all on public.member_welcomes from anon, authenticated;
grant select, delete on public.member_welcomes to authenticated;
grant insert(member_id) on public.member_welcomes to authenticated;
drop policy if exists member_welcomes_read on public.member_welcomes;
create policy member_welcomes_read on public.member_welcomes for select to authenticated using (true);
drop policy if exists member_welcomes_insert_own on public.member_welcomes;
create policy member_welcomes_insert_own on public.member_welcomes for insert to authenticated with check (user_id=(select auth.uid()));
drop policy if exists member_welcomes_delete_own on public.member_welcomes;
create policy member_welcomes_delete_own on public.member_welcomes for delete to authenticated using (user_id=(select auth.uid()));

-- Página da timeline (keyset por data de cadastro). Número do membro = ordem de cadastro.
create or replace function orbita_private.new_members(before_at timestamptz default null, before_id uuid default null, page_size int default 20)
returns table(id uuid, username text, display_name text, avatar_color text, avatar_url text, banner_url text, pronouns text, bio text, appearance jsonb, joined_at timestamptz, member_number bigint, welcomes bigint, welcomed boolean, following boolean)
language sql stable security definer set search_path='' as $$
  with me as (select auth.uid() uid), ranked as (
    select p.*, u.created_at joined, row_number() over(order by u.created_at, p.id) n
    from public.profiles p join auth.users u on u.id=p.id)
  select r.id, r.username, r.display_name, r.avatar_color, r.avatar_url, r.banner_url, r.pronouns, r.bio, r.appearance, r.joined, r.n,
    (select count(*) from public.member_welcomes w where w.member_id=r.id),
    exists(select 1 from public.member_welcomes w where w.member_id=r.id and w.user_id=(select uid from me)),
    exists(select 1 from public.social_follows f where f.follower_id=(select uid from me) and f.following_id=r.id)
  from ranked r
  where (select uid from me) is not null
    and (before_at is null or (r.joined, r.id) < (before_at, before_id))
    and not exists(select 1 from public.social_blocks b where (b.blocker_id=(select uid from me) and b.blocked_id=r.id) or (b.blocker_id=r.id and b.blocked_id=(select uid from me)))
  order by r.joined desc, r.id desc
  limit least(greatest(coalesce(page_size,20),1),50)
$$;
create or replace function orbita_private.new_members_stats()
returns jsonb language sql stable security definer set search_path='' as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'total',count(*),
    'week',count(*) filter(where u.created_at>=now()-interval '7 days'),
    'today',count(*) filter(where (u.created_at at time zone 'America/Sao_Paulo')::date=(now() at time zone 'America/Sao_Paulo')::date),
    'me_joined',max(u.created_at) filter(where u.id=auth.uid()),
    'me_number',(select n from (select u2.id, row_number() over(order by u2.created_at,u2.id) n from auth.users u2 join public.profiles p2 on p2.id=u2.id) x where x.id=auth.uid()))
  end from auth.users u join public.profiles p on p.id=u.id
$$;
create or replace function public.new_members(before_at timestamptz default null, before_id uuid default null, page_size int default 20)
returns table(id uuid, username text, display_name text, avatar_color text, avatar_url text, banner_url text, pronouns text, bio text, appearance jsonb, joined_at timestamptz, member_number bigint, welcomes bigint, welcomed boolean, following boolean)
language sql stable set search_path='' as $$ select * from orbita_private.new_members(before_at,before_id,page_size) $$;
create or replace function public.new_members_stats() returns jsonb language sql stable set search_path='' as $$ select orbita_private.new_members_stats() $$;
revoke all on function orbita_private.new_members(timestamptz,uuid,int), orbita_private.new_members_stats(), public.new_members(timestamptz,uuid,int), public.new_members_stats() from public, anon;
grant execute on function orbita_private.new_members(timestamptz,uuid,int), orbita_private.new_members_stats(), public.new_members(timestamptz,uuid,int), public.new_members_stats() to authenticated;
