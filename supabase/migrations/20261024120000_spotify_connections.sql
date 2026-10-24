-- Conexões com Spotify: tokens só no servidor. RLS ligada sem policies e sem grants para clientes;
-- apenas o backend (service role) lê/escreve.
create table if not exists public.spotify_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  access_token text,
  expires_at timestamptz,
  display_name text check (char_length(display_name) <= 80),
  show_on_profile boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.spotify_connections enable row level security;
revoke all on public.spotify_connections from anon, authenticated;
grant select, insert, update, delete on public.spotify_connections to service_role;
