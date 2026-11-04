-- Ferramentas de comunidade no estilo Discord:
-- categorias de canais, eventos com RSVP, modo lento e automoderação.

-- Categorias agrupam canais de texto e voz e guardam a ordem exibida na barra lateral.
create table if not exists public.channel_categories(
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  name text not null check(char_length(btrim(name)) between 1 and 40),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists channel_categories_order on public.channel_categories(community_id,position);
alter table public.channel_categories enable row level security;
grant select on public.channel_categories to authenticated;
grant insert(community_id,name,position),update(name,position),delete on public.channel_categories to authenticated;
drop policy if exists channel_categories_read on public.channel_categories;
create policy channel_categories_read on public.channel_categories for select to authenticated
  using(orbita_private.is_community_member(community_id) or orbita_private.can_community(community_id,'manage_channels'));
drop policy if exists channel_categories_insert on public.channel_categories;
create policy channel_categories_insert on public.channel_categories for insert to authenticated
  with check(orbita_private.can_community(community_id,'manage_channels'));
drop policy if exists channel_categories_update on public.channel_categories;
create policy channel_categories_update on public.channel_categories for update to authenticated
  using(orbita_private.can_community(community_id,'manage_channels'))
  with check(orbita_private.can_community(community_id,'manage_channels'));
drop policy if exists channel_categories_delete on public.channel_categories;
create policy channel_categories_delete on public.channel_categories for delete to authenticated
  using(orbita_private.can_community(community_id,'manage_channels'));

alter table public.channels
  add column if not exists category_id uuid references public.channel_categories(id) on delete set null,
  add column if not exists slowmode_seconds integer not null default 0
    check(slowmode_seconds between 0 and 21600);
create index if not exists channels_category on public.channels(category_id,position) where category_id is not null;
grant insert(category_id,slowmode_seconds),update(category_id,slowmode_seconds,position) on public.channels to authenticated;

-- Uma categoria só pode agrupar canais do mesmo servidor.
create or replace function orbita_private.check_channel_category()
returns trigger language plpgsql security definer set search_path=''
as $$ begin
  if new.category_id is not null and not exists(
    select 1 from public.channel_categories c
    where c.id=new.category_id and c.community_id=new.community_id
  ) then
    raise exception 'A categoria escolhida pertence a outro servidor.' using errcode='P0001';
  end if;
  return new;
end $$;
revoke all on function orbita_private.check_channel_category() from public,anon,authenticated;
drop trigger if exists channels_category_scope on public.channels;
create trigger channels_category_scope before insert or update on public.channels
  for each row execute function orbita_private.check_channel_category();

-- Eventos agendados do servidor. Qualquer membro confirma presença ou interesse;
-- quem administra canais cria, edita e remove eventos.
create table if not exists public.community_events(
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  channel_id uuid references public.channels(id) on delete set null,
  title text not null check(char_length(btrim(title)) between 1 and 80),
  description text not null default '' check(char_length(description)<=500),
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check(ends_at is null or ends_at>starts_at)
);
create index if not exists community_events_time on public.community_events(community_id,starts_at);
alter table public.community_events enable row level security;
grant select on public.community_events to authenticated;
grant insert(community_id,channel_id,title,description,starts_at,ends_at),update(title,description,starts_at,ends_at,channel_id),delete
  on public.community_events to authenticated;
drop policy if exists community_events_read on public.community_events;
create policy community_events_read on public.community_events for select to authenticated
  using(orbita_private.is_community_member(community_id) or orbita_private.can_community(community_id,'manage_channels'));
drop policy if exists community_events_insert on public.community_events;
create policy community_events_insert on public.community_events for insert to authenticated
  with check(created_by=(select auth.uid()) and orbita_private.can_community(community_id,'manage_channels'));
drop policy if exists community_events_update on public.community_events;
create policy community_events_update on public.community_events for update to authenticated
  using(orbita_private.can_community(community_id,'manage_channels'))
  with check(orbita_private.can_community(community_id,'manage_channels'));
drop policy if exists community_events_delete on public.community_events;
create policy community_events_delete on public.community_events for delete to authenticated
  using(orbita_private.can_community(community_id,'manage_channels'));

create table if not exists public.community_event_rsvps(
  event_id uuid not null references public.community_events(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  status text not null check(status in('going','interested')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(event_id,user_id)
);
create index if not exists community_event_rsvps_event on public.community_event_rsvps(event_id,status);
alter table public.community_event_rsvps enable row level security;
grant select on public.community_event_rsvps to authenticated;
grant insert(event_id,user_id,status,updated_at),update(status,updated_at),delete on public.community_event_rsvps to authenticated;
drop policy if exists community_event_rsvps_read on public.community_event_rsvps;
create policy community_event_rsvps_read on public.community_event_rsvps for select to authenticated
  using(exists(select 1 from public.community_events e where e.id=event_id
    and (orbita_private.is_community_member(e.community_id) or orbita_private.can_community(e.community_id,'manage_channels'))));
drop policy if exists community_event_rsvps_insert on public.community_event_rsvps;
create policy community_event_rsvps_insert on public.community_event_rsvps for insert to authenticated
  with check(user_id=(select auth.uid()) and exists(select 1 from public.community_events e where e.id=event_id
    and (orbita_private.is_community_member(e.community_id) or orbita_private.can_community(e.community_id,'manage_channels'))));
drop policy if exists community_event_rsvps_update on public.community_event_rsvps;
create policy community_event_rsvps_update on public.community_event_rsvps for update to authenticated
  using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
drop policy if exists community_event_rsvps_delete on public.community_event_rsvps;
create policy community_event_rsvps_delete on public.community_event_rsvps for delete to authenticated
  using(user_id=(select auth.uid()));

-- Interruptores de automoderação. O gatilho de mensagens lê estas colunas.
alter table public.communities
  add column if not exists automod_links boolean not null default false,
  add column if not exists automod_caps boolean not null default false,
  add column if not exists automod_spam boolean not null default false;
grant update(automod_links,automod_caps,automod_spam) on public.communities to authenticated;

-- Modo lento e automoderação valem para mensagens de canais públicos.
-- Webhooks e moderadores (manage_messages) passam direto; DMs não são afetadas.
create or replace function orbita_private.enforce_message_rules()
returns trigger language plpgsql security definer set search_path=''
as $$ declare channel public.channels; community public.communities; moderator boolean;
     letters integer; uppers integer; begin
  if new.webhook_id is not null then return new; end if;
  select * into channel from public.channels where id=new.channel_id;
  if not found then return new; end if;
  select * into community from public.communities where id=channel.community_id;
  if not found then return new; end if;
  moderator:=orbita_private.can_community(channel.community_id,'manage_messages');

  if channel.slowmode_seconds>0 and not moderator and exists(
    select 1 from public.messages m
    where m.channel_id=new.channel_id and m.author_id=new.author_id
      and m.created_at>now()-make_interval(secs=>channel.slowmode_seconds)
  ) then
    raise exception 'Modo lento ativo: aguarde % segundos antes de enviar outra mensagem.',channel.slowmode_seconds using errcode='P0001';
  end if;

  if auth.uid() is not null and not moderator then
    if community.automod_links and coalesce(new.content,'') ~* '(https?://|www\.)' then
      raise exception 'Links não são permitidos neste servidor pela automoderação.' using errcode='P0001';
    end if;
    if community.automod_caps and char_length(coalesce(new.content,''))>0 then
      letters:=char_length(regexp_replace(new.content,'[^A-Za-zÀ-ÿ]','','g'));
      uppers:=char_length(regexp_replace(new.content,'[^A-ZÀ-Ý]','','g'));
      if letters>=12 and uppers*10>=letters*7 then
        raise exception 'Evite escrever tudo em maiúsculas (automoderação).' using errcode='P0001';
      end if;
    end if;
    if community.automod_spam and coalesce(new.content,'')<>'' and exists(
      select 1 from public.messages m
      where m.channel_id=new.channel_id and m.author_id=new.author_id and m.content=new.content
        and m.created_at>now()-interval '30 seconds'
    ) then
      raise exception 'Mensagem repetida bloqueada pela automoderação.' using errcode='P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function orbita_private.enforce_message_rules() from public,anon,authenticated;
drop trigger if exists message_rules on public.messages;
create trigger message_rules before insert on public.messages
  for each row execute function orbita_private.enforce_message_rules();

create index if not exists messages_author_time on public.messages(channel_id,author_id,created_at desc);
notify pgrst,'reload schema';
