-- Endurecimento de privacidade e permissões (2026-11-03).
-- Aplicar no SQL Editor do Supabase antes (ou logo depois) do deploy do servidor.
-- É idempotente: pode ser executado mais de uma vez.

-- 1. Feed de novos membros: contas privadas aparecem, mas sem bio, pronomes,
-- aparência ou capa. Nome, @, cor e avatar continuam públicos para a lista.
create or replace function orbita_private.new_members(before_at timestamptz default null, before_id uuid default null, page_size int default 20)
returns table(id uuid, username text, display_name text, avatar_color text, avatar_url text, banner_url text, pronouns text, bio text, appearance jsonb, joined_at timestamptz, member_number bigint, welcomes bigint, welcomed boolean, following boolean)
language sql stable security definer set search_path='' as $$
  with me as (select auth.uid() uid), ranked as (
    select p.*, u.created_at joined, row_number() over(order by u.created_at, p.id) n
    from public.profiles p join auth.users u on u.id=p.id),
  flags as (
    select r.*, coalesce((select s.private_account from public.social_privacy s where s.user_id=r.id), false) restricted
    from ranked r),
  visible as (
    select f.id, f.username, f.display_name, f.avatar_color, f.avatar_url,
      case when f.restricted then '' else f.banner_url end banner_url,
      case when f.restricted then '' else f.pronouns end pronouns,
      case when f.restricted then '' else f.bio end bio,
      case when f.restricted then '{}'::jsonb else f.appearance end appearance,
      f.joined, f.n
    from flags f)
  select v.id, v.username, v.display_name, v.avatar_color, v.avatar_url, v.banner_url, v.pronouns, v.bio, v.appearance,
    v.joined, v.n,
    (select count(*) from public.member_welcomes w where w.member_id=v.id),
    exists(select 1 from public.member_welcomes w where w.member_id=v.id and w.user_id=(select uid from me)),
    exists(select 1 from public.social_follows f where f.follower_id=(select uid from me) and f.following_id=v.id)
  from visible v
  where (select uid from me) is not null
    and (before_at is null or (v.joined, v.id) < (before_at, before_id))
    and not exists(select 1 from public.social_blocks b where (b.blocker_id=(select uid from me) and b.blocked_id=v.id) or (b.blocker_id=v.id and b.blocked_id=(select uid from me)))
  order by v.joined desc, v.id desc
  limit least(greatest(coalesce(page_size,20),1),50)
$$;
revoke all on function orbita_private.new_members(timestamptz,uuid,int) from public, anon;
grant execute on function orbita_private.new_members(timestamptz,uuid,int) to authenticated;

-- 2. Uploads de perfil (pasta profiles/): só imagem, até 5 MB, no máximo 40 arquivos
-- por conta. Anexos e áudio continuam com as regras próprias.
drop policy if exists orbita_files_upload on storage.objects;
create policy orbita_files_upload on storage.objects for insert to authenticated with check(
  bucket_id='orbita-files' and (
    ((storage.foldername(name))[1]='channels' and (storage.foldername(name))[3]=(select auth.uid())::text and orbita_private.can_read_channel(((storage.foldername(name))[2])::uuid))
    or ((storage.foldername(name))[1]='conversations' and (storage.foldername(name))[3]=(select auth.uid())::text and exists(select 1 from public.conversations c where c.id=((storage.foldername(name))[2])::uuid and (select auth.uid()) in(c.user_a,c.user_b)))
    or ((storage.foldername(name))[1]='profiles' and (storage.foldername(name))[2]=(select auth.uid())::text
        and lower(coalesce(metadata->>'mimetype','')) in ('image/png','image/jpeg','image/webp','image/gif')
        and coalesce((metadata->>'size')::bigint,0) between 1 and 5242880)
    or ((storage.foldername(name))[1]='community-assets' and (storage.foldername(name))[3]=(select auth.uid())::text and orbita_private.can_community(((storage.foldername(name))[2])::uuid,'manage_roles')
        and lower(coalesce(metadata->>'mimetype','')) in ('image/png','image/jpeg','image/webp','image/gif'))
  )
);

create or replace function orbita_private.limit_profile_files() returns trigger
language plpgsql security definer set search_path='' as $$
declare folder text; total integer;
begin
  if new.bucket_id='orbita-files' and (storage.foldername(new.name))[1]='profiles' then
    folder := (storage.foldername(new.name))[2];
    select count(*) into total from storage.objects
      where bucket_id='orbita-files' and name like 'profiles/'||folder||'/%';
    if total >= 40 then
      raise exception 'Limite de arquivos de perfil atingido.';
    end if;
  end if;
  return new;
end $$;
revoke all on function orbita_private.limit_profile_files() from public, anon, authenticated;
drop trigger if exists limit_profile_files on storage.objects;
create trigger limit_profile_files before insert on storage.objects
  for each row execute function orbita_private.limit_profile_files();

-- 3. Anexos: ler e criar só em canal ou conversa a que a pessoa tem acesso.
drop policy if exists attachment_scope_read on public.attachments;
create policy attachment_scope_read on public.attachments for select to authenticated using(
  (channel_id is not null and orbita_private.can_read_channel(channel_id))
  or (conversation_id is not null and exists(select 1 from public.conversations c where c.id=conversation_id and (select auth.uid()) in(c.user_a,c.user_b)))
);
drop policy if exists attachment_scope_insert on public.attachments;
create policy attachment_scope_insert on public.attachments for insert to authenticated with check(
  owner_id=(select auth.uid()) and num_nonnulls(channel_id,conversation_id)=1 and (
    (channel_id is not null and orbita_private.can_read_channel(channel_id))
    or (conversation_id is not null and exists(select 1 from public.conversations c where c.id=conversation_id and (select auth.uid()) in(c.user_a,c.user_b)))
  )
);

-- 4. Música (Ouvir juntos): quem não participa do canal/conversa não lê nem altera a fila.
drop policy if exists music_read on public.music_state;
create policy music_read on public.music_state for select to authenticated using(
  (channel_id is not null and orbita_private.can_read_channel(channel_id))
  or (conversation_id is not null and exists(select 1 from public.conversations c where c.id=conversation_id))
);
drop policy if exists music_insert on public.music_state;
create policy music_insert on public.music_state for insert to authenticated with check(
  updated_by=(select auth.uid())
  and exists(select 1 from public.attachments a where a.id=attachment_id and a.mime_type like 'audio/%' and (a.channel_id=music_state.channel_id or a.conversation_id=music_state.conversation_id))
  and ((channel_id is not null and orbita_private.can_read_channel(channel_id))
       or (conversation_id is not null and exists(select 1 from public.conversations c where c.id=conversation_id)))
);
drop policy if exists music_update on public.music_state;
create policy music_update on public.music_state for update to authenticated using(
  (channel_id is not null and orbita_private.can_read_channel(channel_id))
  or (conversation_id is not null and exists(select 1 from public.conversations c where c.id=conversation_id))
) with check(
  updated_by=(select auth.uid())
  and exists(select 1 from public.attachments a where a.id=attachment_id and a.mime_type like 'audio/%' and (a.channel_id=music_state.channel_id or a.conversation_id=music_state.conversation_id))
  and ((channel_id is not null and orbita_private.can_read_channel(channel_id))
       or (conversation_id is not null and exists(select 1 from public.conversations c where c.id=conversation_id)))
);

-- 5. Emojis da comunidade: gerenciar conteúdo exige manage_messages, não manage_roles.
drop policy if exists community_emojis_manage on public.community_emojis;
create policy community_emojis_manage on public.community_emojis for all to authenticated
  using(orbita_private.can_community(community_id,'manage_messages'))
  with check(orbita_private.can_community(community_id,'manage_messages') and created_by=(select auth.uid()));
