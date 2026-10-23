-- Separa @nome de usuário (username) de nickname (display_name).
-- username: 3–24 [a-z0-9_], único sem diferenciar maiúsculas, nomes reservados
-- bloqueados e no máximo uma troca a cada 24h (ADM global isento).
-- display_name: 1–32 caracteres, emoji permitido, sem caracteres de controle.
-- Menções continuam usando o username, que não muda sem a pessoa pedir.

alter table public.profiles add column if not exists username_changed_at timestamptz;

create table if not exists public.reserved_usernames (name text primary key check (name ~ '^[a-z0-9_]{1,24}$'));
alter table public.reserved_usernames enable row level security;
revoke all on public.reserved_usernames from anon, authenticated;
insert into public.reserved_usernames(name) values
  ('admin'),('adm'),('administrador'),('root'),('suporte'),('support'),('orbita'),('sistema'),('system'),
  ('moderador'),('moderacao'),('mod'),('staff'),('equipe'),('oficial'),('official'),('null'),('undefined'),
  ('everyone'),('here'),('todos'),('api'),('www'),('help'),('ajuda'),('dono'),('owner'),('seguranca'),('security')
on conflict do nothing;

alter table public.profiles drop constraint if exists profiles_display_name_check;
alter table public.profiles add constraint profiles_display_name_check
  check (char_length(display_name) between 1 and 32 and display_name !~ '[[:cntrl:]]');

create or replace function orbita_private.unify_nickname()
returns trigger language plpgsql security definer set search_path to '' as $$
declare uid uuid:=(select auth.uid()); exempt boolean;
begin
  if new.display_name is distinct from old.display_name then
    new.display_name:=btrim(new.display_name);
    if char_length(new.display_name) not between 1 and 32 or new.display_name ~ '[[:cntrl:]]' then
      raise exception 'O nickname precisa ter de 1 a 32 caracteres, sem caracteres de controle.' using errcode='23514';
    end if;
  end if;
  if new.username is distinct from old.username then
    new.username:=lower(btrim(new.username));
    if new.username is not distinct from old.username then return new; end if;
    if new.username !~ '^[a-z0-9_]{3,24}$' then
      raise exception 'Use um @ de 3 a 24 letras minúsculas, números ou _.' using errcode='23514';
    end if;
    exempt:=uid is null or exists(select 1 from public.site_roles where user_id=uid and role in ('admin','creator'));
    if not exempt and exists(select 1 from public.reserved_usernames where name=new.username) then
      raise exception 'Este @ é reservado.' using errcode='23514';
    end if;
    if exists(select 1 from public.profiles where lower(username)=new.username and id<>new.id) then
      raise exception 'Este @ já está em uso.' using errcode='23505';
    end if;
    if not exempt and old.username_changed_at is not null and old.username_changed_at > now()-interval '24 hours' then
      raise exception 'Você só pode trocar o @ uma vez a cada 24 horas.' using errcode='P0001';
    end if;
    new.username_changed_at:=now();
  elsif new.username_changed_at is distinct from old.username_changed_at then
    new.username_changed_at:=old.username_changed_at;
  end if;
  return new;
end $$;
revoke all on function orbita_private.unify_nickname() from public, anon, authenticated;

-- Novas contas: nickname até 32 caracteres; o @ inicial vem do nickname quando
-- ele é um @ válido, livre e não reservado (senão fica o orbiter_* aleatório).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to '' as $$
declare nick text:=left(coalesce(nullif(regexp_replace(btrim(new.raw_user_meta_data->>'display_name'),'[[:cntrl:]]','','g'), ''), 'Participante'),32);
  handle text:=lower(nick);
begin
  if handle ~ '^[a-z0-9_]{3,24}$' and not exists(select 1 from public.profiles where lower(username)=handle)
     and not exists(select 1 from public.reserved_usernames where name=handle) then
    insert into public.profiles(id, display_name, username) values (new.id, nick, handle);
  else
    insert into public.profiles(id, display_name) values (new.id, nick);
  end if;
  return new;
end $$;

-- Disponibilidade do @ para a checagem ao vivo nas Configurações.
create or replace function public.username_available(candidate text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare u text:=lower(btrim(coalesce(candidate,''))); uid uuid:=(select auth.uid()); exempt boolean; last timestamptz;
begin
  if uid is null then return jsonb_build_object('ok',false,'reason','auth'); end if;
  if u !~ '^[a-z0-9_]{3,24}$' then return jsonb_build_object('ok',false,'reason','invalid'); end if;
  if exists(select 1 from public.profiles where id=uid and lower(username)=u) then return jsonb_build_object('ok',true,'reason','current'); end if;
  exempt:=exists(select 1 from public.site_roles where user_id=uid and role in ('admin','creator'));
  if not exempt and exists(select 1 from public.reserved_usernames where name=u) then return jsonb_build_object('ok',false,'reason','reserved'); end if;
  if exists(select 1 from public.profiles where lower(username)=u) then return jsonb_build_object('ok',false,'reason','taken'); end if;
  select username_changed_at into last from public.profiles where id=uid;
  if not exempt and last is not null and last > now()-interval '24 hours' then
    return jsonb_build_object('ok',false,'reason','rate_limit','retry_at',last+interval '24 hours');
  end if;
  return jsonb_build_object('ok',true,'reason','available');
end $$;
revoke all on function public.username_available(text) from public, anon;
grant execute on function public.username_available(text) to authenticated;
