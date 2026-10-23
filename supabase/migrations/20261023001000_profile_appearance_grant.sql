-- Corrige a migration de insígnias: o authenticated não tinha UPDATE na coluna
-- profiles.appearance (o guard_appearance continua barrando itens de ADM), e
-- orbita_private.badge_events ficou sem RLS (só é acessada por funções SECURITY DEFINER).
grant update(appearance) on public.profiles to authenticated;
alter table orbita_private.badge_events enable row level security;
revoke all on orbita_private.badge_events from anon, authenticated;
