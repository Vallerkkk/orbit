-- Corrige "permission denied" ao enviar mensagens (todos os canais).
-- Idempotente: pode ser executado mais de uma vez.
-- 1) Reaplica schema usage, grants de tabela/coluna e EXECUTE nas funções que as
--    políticas de INSERT/SELECT de mensagens chamam com o papel do usuário.
-- 2) Torna os gatilhos de validação SECURITY DEFINER, para que não dependam de
--    grants do papel authenticated em tabelas auxiliares (community_moderation etc.).
-- 3) Recria a política de INSERT de messages com a regra atual.

grant usage on schema public to authenticated;
grant usage on schema orbita_private to authenticated;

grant select on public.profiles, public.channels, public.communities, public.community_members,
  public.community_moderation, public.messages, public.direct_messages, public.attachments,
  public.reactions, public.poll_votes, public.conversations to authenticated;

grant insert (channel_id, author_id, content, attachment_id, reply_to, poll, thread_root) on public.messages to authenticated;
grant update (content, pinned) on public.messages to authenticated;
grant insert (conversation_id, author_id, content, attachment_id, reply_to, poll, thread_root) on public.direct_messages to authenticated;
grant update (content, pinned) on public.direct_messages to authenticated;

grant execute on function orbita_private.can_read_channel(uuid) to authenticated;
grant execute on function orbita_private.can_community(uuid, text) to authenticated;
grant execute on function orbita_private.is_banned(uuid, uuid) to authenticated;
grant execute on function orbita_private.is_community_member(uuid) to authenticated;
do $$ begin
  if to_regprocedure('orbita_private.can_send_dm(uuid,uuid)') is not null then
    execute 'grant execute on function orbita_private.can_send_dm(uuid,uuid) to authenticated';
  end if;
  if to_regprocedure('public.is_site_admin()') is not null then
    execute 'grant execute on function public.is_site_admin() to authenticated';
  end if;
end $$;

-- Gatilhos de validação rodam como dono (mantêm auth.uid() do usuário).
alter function orbita_private.guard_message() security definer;
alter function orbita_private.check_reply() security definer;
revoke all on function orbita_private.guard_message(), orbita_private.check_reply() from public, anon, authenticated;

alter table public.messages enable row level security;
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated with check(
  author_id = (select auth.uid())
  and exists(select 1 from public.channels c where c.id = channel_id and c.kind = 'text'
    and orbita_private.can_read_channel(c.id)
    and (not c.is_announcement or orbita_private.can_community(c.community_id, 'manage_messages')))
  and (attachment_id is null or exists(select 1 from public.attachments a
    where a.id = attachment_id and a.owner_id = author_id and a.channel_id = messages.channel_id)));

notify pgrst, 'reload schema';
