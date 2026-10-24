-- Ouvir juntos: /adicionar e /proxima enfileiram sem interromper. Nenhuma restrição do banco lista comandos
-- (o guard só exige "/" ou link do YouTube); aqui só atualizamos a descrição padrão do canal.
create or replace function orbita_private.add_music_channel() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.channels(name, kind, position, community_id, description, is_music, created_by)
  values ('ouvir-juntos', 'text', 50, new.id, 'Comandos do Ouvir juntos: /tocar, /adicionar, /proxima, /pular, /fila, /ajuda…', true, new.created_by)
  on conflict do nothing;
  return new;
end $$;
revoke all on function orbita_private.add_music_channel() from public, anon, authenticated;
update public.channels set description = 'Comandos do Ouvir juntos: /tocar, /adicionar, /proxima, /pular, /fila, /ajuda…'
where is_music and description = 'Comandos do Ouvir juntos: /tocar, /pular, /fila, /ajuda…';
