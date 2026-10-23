-- YouTube no Órbita: histórico e "Assistir depois" por usuário (RLS: só o dono lê/escreve)
-- e tokens OAuth do Google guardados criptografados (AES-GCM, chave YOUTUBE_TOKEN_KEY só no servidor)
-- numa tabela fora da API (schema orbita_private), acessada apenas por RPCs ligadas a auth.uid().
create table if not exists public.youtube_library(
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('history','later')),
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null default '' check (char_length(title)<=300),
  channel_title text not null default '' check (char_length(channel_title)<=200),
  channel_id text not null default '' check (char_length(channel_id)<=64),
  duration text not null default '' check (char_length(duration)<=16),
  position_seconds int not null default 0 check (position_seconds between 0 and 864000),
  updated_at timestamptz not null default now(),
  primary key(user_id,kind,video_id)
);
create index if not exists youtube_library_recent_idx on public.youtube_library(user_id,kind,updated_at desc);
alter table public.youtube_library enable row level security;
revoke all on public.youtube_library from anon, authenticated;
grant select, insert, update, delete on public.youtube_library to authenticated;
drop policy if exists youtube_library_own on public.youtube_library;
create policy youtube_library_own on public.youtube_library for all to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

create schema if not exists orbita_private;
create table if not exists orbita_private.youtube_tokens(
  user_id uuid primary key references auth.users(id) on delete cascade,
  ciphertext text not null check (char_length(ciphertext) between 20 and 8000),
  updated_at timestamptz not null default now()
);
alter table orbita_private.youtube_tokens enable row level security;
revoke all on orbita_private.youtube_tokens from public, anon, authenticated;

create or replace function public.youtube_token_put(ciphertext text) returns void
language sql volatile security definer set search_path='' as $$
  insert into orbita_private.youtube_tokens(user_id,ciphertext,updated_at)
  select auth.uid(), youtube_token_put.ciphertext, now() where auth.uid() is not null
  on conflict (user_id) do update set ciphertext=excluded.ciphertext, updated_at=now();
$$;
create or replace function public.youtube_token_get() returns text
language sql stable security definer set search_path='' as $$
  select t.ciphertext from orbita_private.youtube_tokens t where t.user_id=auth.uid();
$$;
create or replace function public.youtube_token_clear() returns void
language sql volatile security definer set search_path='' as $$
  delete from orbita_private.youtube_tokens where user_id=auth.uid();
$$;
revoke all on function public.youtube_token_put(text), public.youtube_token_get(), public.youtube_token_clear() from public, anon;
grant execute on function public.youtube_token_put(text), public.youtube_token_get(), public.youtube_token_clear() to authenticated;
