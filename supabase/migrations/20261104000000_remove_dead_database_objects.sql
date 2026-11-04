-- Remove objetos sem chamada depois da aposentadoria da transcrição.
drop function if exists public.reserve_luladroid(text,text);
drop function if exists orbita_private.reserve_luladroid(text,text);

-- (community_id,user_id) é prefixo exato da chave primária
-- (community_id,user_id,role_id); o índice extra só custa escrita.
drop index if exists public.community_member_roles_user;
