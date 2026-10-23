-- Restaura o UPDATE por coluna em public.profiles para authenticated.
-- Causa: no banco, authenticated só tinha UPDATE em display_name, username, bio,
-- avatar_color, presence_status, custom_status e appearance. Faltavam avatar_url,
-- banner_url, pronouns e presence_activity (concedidos em community_invites_roles_profiles,
-- mas ausentes no banco). Qualquer update que envie uma dessas colunas (salvar perfil,
-- banner, avatar, atividade) falhava inteiro com "permission denied for table profiles".
-- Idempotente; não toca no trigger guard_appearance (itens de ADM continuam barrados)
-- nem na policy profiles_self_update (cada um só altera a própria linha).
grant update (display_name, username, bio, avatar_color, presence_status, custom_status,
  avatar_url, banner_url, pronouns, presence_activity, appearance)
  on public.profiles to authenticated;

-- Varredura: outros grants por coluna que o repositório concede (baseline e
-- fix_message_insert_permissions) mas que faltavam no banco e geram o mesmo 42501.
-- As policies de RLS e os gatilhos de guarda continuam decidindo quem pode o quê.
grant insert (thread_root) on public.messages, public.direct_messages to authenticated;
grant insert (storage_path) on public.attachments to authenticated;
grant insert (is_stage, is_private, is_announcement, default_for_new_members),
  update (is_stage, is_private, is_announcement, default_for_new_members)
  on public.channels to authenticated;
grant update (invite_only) on public.communities to authenticated;
