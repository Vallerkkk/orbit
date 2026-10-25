-- Tema de servidor (item da Loja) salvo na comunidade, visível para todos os membros.
-- Quem pode alterar: a policy communities_manage (orbita_private.can_edit_community).
alter table public.communities add column if not exists theme text check (theme is null or theme ~ '^[a-z0-9-]{1,64}$');
grant update(theme) on public.communities to authenticated;
