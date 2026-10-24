-- Canal de texto do Ouvir juntos: um canal 'text' com is_music=true aceita só comandos (/tocar, /pular…)
-- e links do YouTube. O resultado do comando fica salvo em messages.command_result (escrito pelo autor).
alter table public.channels add column if not exists is_music boolean not null default false;
grant insert(is_music), update(is_music) on public.channels to authenticated;

alter table public.messages add column if not exists command_result text;
alter table public.messages drop constraint if exists messages_command_result_len;
alter table public.messages add constraint messages_command_result_len check (command_result is null or char_length(command_result) <= 400);
grant update(command_result) on public.messages to authenticated;

create or replace function orbita_private.guard_music_message() returns trigger
language plpgsql set search_path = '' as $$
declare music boolean;
begin
  select c.is_music into music from public.channels c where c.id = new.channel_id;
  if tg_op = 'INSERT' and new.command_result is not null then
    raise exception using errcode = '42501', message = 'Resultado de comando não pode ser enviado junto da mensagem.';
  end if;
  if tg_op = 'UPDATE' and new.command_result is distinct from old.command_result then
    if not coalesce(music, false) then raise exception using errcode = '42501', message = 'Só mensagens do canal do Ouvir juntos têm resultado de comando.'; end if;
    if auth.uid() is distinct from old.author_id then raise exception using errcode = '42501', message = 'Só o autor do comando registra o resultado.'; end if;
  end if;
  if coalesce(music, false) and (tg_op = 'INSERT' or new.content is distinct from old.content) then
    if new.attachment_id is not null or new.poll is not null then
      raise exception using errcode = '22023', message = 'O canal do Ouvir juntos só aceita comandos e links do YouTube.';
    end if;
    if btrim(new.content) !~ '^/' and new.content !~* '(^|\s|//)((www|m|music)\.)?(youtube\.com|youtu\.be)/' then
      raise exception using errcode = '22023', message = 'Este canal só aceita comandos do Ouvir juntos (ex.: /tocar <link>, /pular, /ajuda) e links do YouTube.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists messages_music_guard on public.messages;
create trigger messages_music_guard before insert or update on public.messages for each row execute function orbita_private.guard_music_message();

-- Novos servidores ganham #ouvir-juntos; os existentes recebem um agora.
create or replace function orbita_private.add_music_channel() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.channels(name, kind, position, community_id, description, is_music, created_by)
  values ('ouvir-juntos', 'text', 50, new.id, 'Comandos do Ouvir juntos: /tocar, /pular, /fila, /ajuda…', true, new.created_by)
  on conflict do nothing;
  return new;
end $$;
revoke all on function orbita_private.add_music_channel() from public, anon, authenticated;
drop trigger if exists community_music_channel on public.communities;
create trigger community_music_channel after insert on public.communities for each row execute function orbita_private.add_music_channel();

insert into public.channels(name, kind, position, community_id, description, is_music, created_by)
select 'ouvir-juntos', 'text', coalesce((select max(x.position) from public.channels x where x.community_id = c.id), 0) + 1,
       c.id, 'Comandos do Ouvir juntos: /tocar, /pular, /fila, /ajuda…', true, c.created_by
from public.communities c
where not exists (select 1 from public.channels x where x.community_id = c.id and (x.is_music or lower(x.name) = 'ouvir-juntos'));
