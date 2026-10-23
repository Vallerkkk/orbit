// Gera supabase/migrations/20261023000500_profile_studio_badges.sql a partir dos catálogos do front.
import {writeFile} from 'node:fs/promises';
import {BADGES} from '../static/badges-catalog.js';
import {ITEMS,NAME_FONTS,NAME_EFFECTS,ADMIN_ONLY} from '../static/cosmetics.js';
const q=s=>`'${String(s).replace(/'/g,"''")}'`,arr=a=>`array[${a.map(q).join(',')}]::text[]`;
const catalog=BADGES.map(b=>`(${q(b.id)},${q(b.cat)},${q(b.metric)},array[${b.t.join(',')}]::int[],${q(b.rarity)},${b.exclusive?q(b.exclusive):'null'})`).join(',\n');
const sql=`-- Estúdio de perfil (aparência no banco), loja por pacotes e insígnias calculadas no servidor.
-- GERADO por scripts/badges-sql.mjs. NÃO APLICADA AUTOMATICAMENTE: revisar e aplicar com o dono do projeto.

-- 1) Aparência pública do perfil (antes ficava no localStorage e só ia pela presença).
alter table public.profiles add column if not exists appearance jsonb not null default '{}'::jsonb;
alter table public.profiles drop constraint if exists profiles_appearance_check;
alter table public.profiles add constraint profiles_appearance_check check (jsonb_typeof(appearance)='object' and pg_column_size(appearance)<=4096);

create or replace function orbita_private.guard_appearance() returns trigger
language plpgsql security definer set search_path to '' as $$
declare a jsonb:=coalesce(new.appearance,'{}'::jsonb); k text; v text;
  items text[]:=${arr(ITEMS.map(i=>i.id))};
  fonts text[]:=${arr(NAME_FONTS.map(f=>f.id))};
  effects text[]:=${arr(NAME_EFFECTS.map(e=>e.id))};
  admin_only text[]:=${arr(ADMIN_ONLY)};
  admin boolean:=exists(select 1 from public.site_roles where user_id=new.id and role in ('admin','creator'));
begin
  if tg_op='UPDATE' and new.appearance is not distinct from old.appearance then return new; end if;
  for k,v in select key,value#>>'{}' from jsonb_each(a) loop
    if k in ('frame','border','effect','server','plate') then
      if v<>'' and not (v=any(items) and v like '%-'||k) then raise exception 'Item de personalização inválido: %',v using errcode='22023'; end if;
      if v=any(admin_only) and not admin then raise exception 'Este item é exclusivo dos administradores do app.' using errcode='42501'; end if;
    elsif k='name_font' then if v<>'' and not v=any(fonts) then raise exception 'Fonte inválida.' using errcode='22023'; end if;
    elsif k='name_effect' then
      if v<>'' and not v=any(effects) then raise exception 'Efeito inválido.' using errcode='22023'; end if;
      if v<>'' and ('name:'||v)=any(admin_only) and not admin then raise exception 'Este efeito é exclusivo dos administradores do app.' using errcode='42501'; end if;
    elsif k='theme' then
      if jsonb_typeof(a->'theme')<>'array' or jsonb_array_length(a->'theme')<>2 or exists(select 1 from jsonb_array_elements_text(a->'theme') c where c !~ '^#[0-9a-fA-F]{6}$') then raise exception 'Tema de cor inválido.' using errcode='22023'; end if;
    elsif k='badges' then
      if jsonb_typeof(a->'badges')<>'array' or jsonb_array_length(a->'badges')>3 then raise exception 'Fixe no máximo 3 insígnias.' using errcode='22023'; end if;
    elsif k in ('legacy_frame','legacy_effect','banner_style') then
      if char_length(v)>48 or v !~ '^[a-z0-9-]*$' then raise exception 'Valor inválido.' using errcode='22023'; end if;
    else raise exception 'Campo de aparência desconhecido: %',k using errcode='22023';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists profiles_guard_appearance on public.profiles;
create trigger profiles_guard_appearance before insert or update of appearance on public.profiles for each row execute function orbita_private.guard_appearance();

-- 2) Nota pessoal sobre outro perfil (só quem escreveu lê).
create table if not exists public.profile_notes(
  owner_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  note text not null default '' check (char_length(note)<=256),
  updated_at timestamptz not null default now(),
  primary key(owner_id,target_id));
alter table public.profile_notes enable row level security;
revoke all on public.profile_notes from anon;
grant select,insert,update,delete on public.profile_notes to authenticated;
drop policy if exists profile_notes_own on public.profile_notes;
create policy profile_notes_own on public.profile_notes for all to authenticated using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));

-- 3) Insígnias.
create table if not exists public.badge_catalog(
  id text primary key, category text not null, metric text not null, thresholds int[] not null, rarity text not null, exclusive text);
alter table public.badge_catalog enable row level security;
grant select on public.badge_catalog to anon, authenticated;
drop policy if exists badge_catalog_read on public.badge_catalog;
create policy badge_catalog_read on public.badge_catalog for select using (true);
delete from public.badge_catalog;
insert into public.badge_catalog(id,category,metric,thresholds,rarity,exclusive) values
${catalog};

-- Eventos validados pelo backend (tempo em call, tela, câmera, Ouvir juntos, dia ativo). Só entram via record_badge_event.
create table if not exists orbita_private.badge_events(
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('active_day','call_minute','screenshare_minute','camera_minute','watch_party')),
  amount int not null default 1 check (amount between 1 and 5),
  day date not null default (now() at time zone 'America/Sao_Paulo')::date,
  created_at timestamptz not null default now());
create index if not exists badge_events_user_kind on orbita_private.badge_events(user_id,kind,created_at desc);
create unique index if not exists badge_events_daily on orbita_private.badge_events(user_id,kind,day) where kind in ('active_day');

-- Concessões manuais e permanentes (ex.: Dono). Ninguém escreve pelo cliente.
create table if not exists public.badge_grants(
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_id text not null references public.badge_catalog(id) on delete cascade,
  permanent boolean not null default false,
  granted_at timestamptz not null default now(),
  primary key(user_id,badge_id));
alter table public.badge_grants enable row level security;
revoke all on public.badge_grants from anon, authenticated;
grant select on public.badge_grants to authenticated;
drop policy if exists badge_grants_read on public.badge_grants;
create policy badge_grants_read on public.badge_grants for select to authenticated using (true);

create table if not exists public.badge_unlocks(
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_id text not null references public.badge_catalog(id) on delete cascade,
  level int not null check (level between 1 and 8),
  unlocked_at timestamptz not null default now(),
  primary key(user_id,badge_id,level));
alter table public.badge_unlocks enable row level security;
revoke all on public.badge_unlocks from anon, authenticated;
grant select on public.badge_unlocks to authenticated;
drop policy if exists badge_unlocks_read on public.badge_unlocks;
create policy badge_unlocks_read on public.badge_unlocks for select to authenticated using (true);

-- O backend (FastAPI) só registra depois de confirmar no LiveKit; exige a mesma chave de transporte do push.
create or replace function orbita_private.record_badge_event(transport_key text, event_kind text, event_amount int default 1) returns boolean
language plpgsql security definer set search_path to '' as $$
declare uid uuid:=auth.uid(); recent int;
begin
  if uid is null or not exists(select 1 from orbita_private.push_config where transport_hash=encode(sha256(convert_to(transport_key,'UTF8')),'hex')) then raise exception 'Transporte não autorizado.' using errcode='42501'; end if;
  if event_kind='active_day' then
    insert into orbita_private.badge_events(user_id,kind) values(uid,'active_day') on conflict do nothing; return true; end if;
  if event_kind not in ('call_minute','screenshare_minute','camera_minute','watch_party') then raise exception 'Evento inválido.' using errcode='22023'; end if;
  -- No máximo um registro por minuto e por tipo (watch_party: um a cada 30 min).
  select count(*) into recent from orbita_private.badge_events where user_id=uid and kind=event_kind and created_at>now()-case when event_kind='watch_party' then interval '30 minutes' else interval '55 seconds' end;
  if recent>0 then return false; end if;
  insert into orbita_private.badge_events(user_id,kind,amount) values(uid,event_kind,least(greatest(coalesce(event_amount,1),1),1));
  return true;
end $$;

create or replace function orbita_private.badge_metrics(target uuid) returns jsonb
language sql stable security definer set search_path to '' as $$
with p as (select pr.*, u.created_at as joined from public.profiles pr join auth.users u on u.id=pr.id where pr.id=target),
m as (select ms.content, ms.reply_to, ms.poll, ms.attachment_id, ms.edited_at, ms.pinned, ms.id, (ms.created_at at time zone 'America/Sao_Paulo') as local from public.messages ms where ms.author_id=target),
e as (select kind, amount, day from orbita_private.badge_events where user_id=target),
days as (select distinct day from e where kind='active_day'),
streak as (select count(*) n from (select day, day - (row_number() over (order by day))::int as grp from days) s
  where grp=(select day - (row_number() over (order by day))::int from days order by day desc limit 1)
  and (select max(day) from days)>=((now() at time zone 'America/Sao_Paulo')::date-1))
select jsonb_build_object(
 'account',1,
 'founder',(select (joined<'2026-12-01')::int from p),
 'join_days',(select greatest(1,extract(day from now()-joined)::int) from p),
 'active_days',(select count(*) from days),
 'streak',coalesce((select n from streak),0),
 'messages',(select count(*) from m),
 'reactions',(select count(*) from public.reactions where user_id=target),
 'emoji_variety',(select count(distinct emoji) from public.reactions where user_id=target),
 'mentions',(select count(*) from public.messages x, p where x.author_id<>target and p.username is not null and x.content ilike '%@'||p.username||'%'),
 'gifs',(select count(*) from m where content like '[gif%'),
 'stickers',(select count(*) from m where content like '[figurinha%'),
 'replies',(select count(*) from m where reply_to is not null),
 'polls',(select count(*) from m where poll is not null),
 'attachments',(select count(*) from m where attachment_id is not null),
 'edits',(select count(*) from m where edited_at is not null),
 'pinned',(select count(*) from m where pinned),
 'long_message',(select count(*) from m where char_length(content)>1000),
 'threads',(select count(distinct x.thread_root) from public.messages x join m on m.id=x.thread_root),
 'night',(select count(*) from m where extract(hour from local) between 2 and 4),
 'early',(select count(*) from m where extract(hour from local) between 5 and 6),
 'weekend',(select count(*) from m where extract(isodow from local) in (6,7)),
 'halloween',(select count(*) from m where (extract(month from local)=10 and extract(day from local)>=25) or (extract(month from local)=11 and extract(day from local)<=2)),
 'natal',(select count(*) from m where extract(month from local)=12 and extract(day from local) between 20 and 26),
 'ano_novo',(select count(*) from m where (extract(month from local)=12 and extract(day from local)=31) or (extract(month from local)=1 and extract(day from local)=1)),
 'carnaval',(select count(*) from m where extract(month from local)=2),
 'junina',(select count(*) from m where extract(month from local)=6),
 'ferias',(select count(*) from m where extract(month from local) in (1,7)),
 'orbita_day',((select count(*) from days where extract(month from day)=10 and extract(day from day)=19)+(select count(*) from m where extract(month from local)=10 and extract(day from local)=19)),
 'call_minutes',coalesce((select sum(amount) from e where kind='call_minute'),0),
 'long_call',(select count(*) from (select day from e where kind='call_minute' group by day having sum(amount)>=180) d),
 'screenshare',coalesce((select sum(amount) from e where kind='screenshare_minute'),0),
 'camera',coalesce((select sum(amount) from e where kind='camera_minute'),0),
 'watch_party',(select count(*) from e where kind='watch_party'),
 'posts',(select count(*) from public.social_posts where author_id=target and not is_reply),
 'likes_received',(select count(*) from public.social_likes l join public.social_posts s on s.id=l.post_id where s.author_id=target and l.user_id<>target),
 'reposts_received',(select count(*) from public.social_reposts r join public.social_posts s on s.id=r.post_id where s.author_id=target and r.user_id<>target),
 'followers',(select count(*) from public.social_follows where following_id=target),
 'following',(select count(*) from public.social_follows where follower_id=target),
 'friends',(select count(*) from public.friendships where status='accepted' and target in (requester_id,recipient_id)),
 'dms',(select count(*) from public.direct_messages where author_id=target),
 'conversations',(select count(*) from public.conversations where target in (user_a,user_b)),
 'communities_created',(select count(*) from public.communities where created_by=target),
 'communities_joined',(select count(*) from public.community_members where user_id=target),
 'invites',(select count(*) from public.community_invites where created_by=target),
 'decorations',(select count(*) from p, jsonb_each_text(p.appearance) j where j.key in ('frame','border','effect','server','plate','name_font','name_effect','banner_style') and j.value<>'')+(select (p.appearance ? 'theme')::int from p),
 'profile_complete',(select (coalesce(bio,'')<>'')::int+(coalesce(pronouns,'')<>'')::int+(avatar_url is not null)::int+(banner_url is not null)::int from p),
 'has_bio',(select (coalesce(bio,'')<>'')::int from p),
 'has_avatar',(select (avatar_url is not null)::int from p),
 'has_banner',(select (banner_url is not null)::int from p),
 'has_font',(select (coalesce(appearance->>'name_font','')<>'')::int from p),
 'early_member',(select (count(*)<100)::int from auth.users u, p where u.created_at<p.joined),
 'admin',(select count(*) from public.site_roles where user_id=target and role in ('admin','creator')),
 'creator',(select count(*) from public.site_roles where user_id=target and role='creator'),
 'owner',(select count(*) from public.badge_grants where user_id=target and badge_id='dono'))
$$;

-- Estado completo: nível de cada insígnia, progresso e vitrine. ADM global = tudo no nível máximo.
create or replace function public.badge_state(target uuid default null) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare who uuid:=coalesce(target,auth.uid()); metrics jsonb; admin boolean; result jsonb; pinned jsonb; cats int;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=who) then raise exception 'Perfil não encontrado.' using errcode='22023'; end if;
  metrics:=orbita_private.badge_metrics(who);
  admin:=(metrics->>'admin')::int>0;
  with lv as (
    select c.id,c.category,c.thresholds,c.exclusive,coalesce((metrics->>c.metric)::int,0) as value,
      case when admin then array_length(c.thresholds,1)
           when exists(select 1 from public.badge_grants g where g.user_id=who and g.badge_id=c.id) then array_length(c.thresholds,1)
           when c.exclusive is not null and c.exclusive<>'owner' then case when coalesce((metrics->>c.metric)::int,0)>0 then 1 else 0 end
           when c.exclusive='owner' then 0
           else (select count(*) from unnest(c.thresholds) t where t<=coalesce((metrics->>c.metric)::int,0)) end as level
    from public.badge_catalog c)
  select count(distinct category) into cats from lv where level>0 and category<>'secretas';
  metrics:=metrics||jsonb_build_object('all_categories',cats);
  select jsonb_agg(jsonb_build_object('id',c.id,'level',l.level,'max',array_length(c.thresholds,1),'value',l.value,
      'next',case when l.level<array_length(c.thresholds,1) then c.thresholds[l.level+1] end,
      'unlocked_at',(select min(u.unlocked_at) from public.badge_unlocks u where u.user_id=who and u.badge_id=c.id),
      'permanent',exists(select 1 from public.badge_grants g where g.user_id=who and g.badge_id=c.id and g.permanent)) order by c.id)
    into result
  from public.badge_catalog c cross join lateral (select coalesce((metrics->>c.metric)::int,0) as value,
      case when admin then array_length(c.thresholds,1)
           when exists(select 1 from public.badge_grants g where g.user_id=who and g.badge_id=c.id) then array_length(c.thresholds,1)
           when c.exclusive='owner' then 0
           when c.exclusive is not null then least(1,coalesce((metrics->>c.metric)::int,0))
           else (select count(*) from unnest(c.thresholds) t where t<=coalesce((metrics->>c.metric)::int,0))::int end as level) l;
  -- Vitrine: permanentes primeiro (Dono), depois as escolhidas pelo usuário que estiverem desbloqueadas; máximo 3.
  select coalesce(jsonb_agg(id),'[]'::jsonb) into pinned from (
    select id from (
      select g.badge_id as id, 0 as ord from public.badge_grants g where g.user_id=who and g.permanent
      union all
      select b.value#>>'{}', b.ordinality::int from public.profiles p, jsonb_array_elements(coalesce(p.appearance->'badges','[]'::jsonb)) with ordinality b where p.id=who
    ) x where exists(select 1 from jsonb_array_elements(result) r where r->>'id'=x.id and (r->>'level')::int>0)
    group by id order by min(ord) limit 3) s;
  return jsonb_build_object('user_id',who,'admin',admin,'badges',coalesce(result,'[]'::jsonb),'showcase',pinned,'metrics',case when who=auth.uid() then metrics else null end);
end $$;

-- Grava a data de desbloqueio de cada nível alcançado (chamado pelo backend no heartbeat).
create or replace function public.sync_my_badges() returns int
language plpgsql security definer set search_path to '' as $$
declare state jsonb:=public.badge_state(auth.uid()); r jsonb; n int:=0; lvl int;
begin
  for r in select * from jsonb_array_elements(state->'badges') loop
    for lvl in 1..least(8,(r->>'level')::int) loop
      insert into public.badge_unlocks(user_id,badge_id,level) values(auth.uid(),r->>'id',lvl) on conflict do nothing;
      if found then n:=n+1; end if;
    end loop;
  end loop;
  return n;
end $$;

create or replace function public.record_badge_event(transport_key text, event_kind text, event_amount int default 1) returns boolean
language sql set search_path to '' as $$select orbita_private.record_badge_event(transport_key,event_kind,event_amount)$$;

revoke all on function orbita_private.record_badge_event(text,text,int), orbita_private.badge_metrics(uuid), orbita_private.guard_appearance() from public, anon, authenticated;
grant execute on function orbita_private.record_badge_event(text,text,int) to authenticated;
revoke all on function public.badge_state(uuid), public.sync_my_badges(), public.record_badge_event(text,text,int) from public, anon;
grant execute on function public.badge_state(uuid), public.sync_my_badges(), public.record_badge_event(text,text,int) to authenticated;

-- 4) Insígnia de Dono, permanente: @kalioptha (50e5ae56-07e3-4023-9461-f653997fcc2e), conferido via leitura MCP.
insert into public.badge_grants(user_id,badge_id,permanent)
select id,'dono',true from public.profiles where id='50e5ae56-07e3-4023-9461-f653997fcc2e' and username='kalioptha'
on conflict (user_id,badge_id) do update set permanent=true;
`;
await writeFile(new URL('../supabase/migrations/20261023000500_profile_studio_badges.sql',import.meta.url),sql);console.log('ok',BADGES.length);
