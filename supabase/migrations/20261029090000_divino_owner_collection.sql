-- Loja v3 + coleções de dono único (Divino, exclusiva de @kalioptha): coleções clássicas refeitas (cada uma com moldura, efeito, borda de cartão, estilo de nome e tema)
-- + coleções novas. Ids antigos (-border, -plate e os de pacote) seguem aceitos como apelidos.
-- GERADO por scripts/appearance-sql.mjs. Só troca a função do trigger; itens de ADM seguem bloqueados no servidor.
create or replace function orbita_private.guard_appearance() returns trigger
language plpgsql security definer set search_path to '' as $$
declare a jsonb:=coalesce(new.appearance,'{}'::jsonb); k text; v text;
  items text[]:=array['cyberpunk-border','cyberpunk-plate','anime-border','anime-plate','espaco-border','espaco-plate','natureza-border','natureza-plate','halloween-border','halloween-plate','lofi-border','lofi-plate','retro-border','retro-plate','oceano-border','oceano-plate','glitch-border','glitch-plate','divino-border','divino-plate','sombrio-border','sombrio-plate','natal-border','natal-plate','romance-border','romance-plate','luxo-border','luxo-plate','zen-border','zen-plate','orbita-staff-border','orbita-staff-plate','nebulosa-frame','nebulosa-effect','nebulosa-card_border','nebulosa-name_style','nebulosa-server','cyber-tokyo-frame','cyber-tokyo-effect','cyber-tokyo-card_border','cyber-tokyo-name_style','cyber-tokyo-server','floresta-frame','floresta-effect','floresta-card_border','floresta-name_style','floresta-server','inferno-frame','inferno-effect','inferno-card_border','inferno-name_style','inferno-server','abissal-frame','abissal-effect','abissal-card_border','abissal-name_style','abissal-server','sakura-frame','sakura-effect','sakura-card_border','sakura-name_style','sakura-server','arcade-frame','arcade-effect','arcade-card_border','arcade-name_style','arcade-server','tempestade-frame','tempestade-effect','tempestade-card_border','tempestade-name_style','tempestade-server','aurora-frame','aurora-effect','aurora-card_border','aurora-name_style','aurora-server','gelo-frame','gelo-effect','gelo-card_border','gelo-name_style','gelo-server','ouro-real-frame','ouro-real-effect','ouro-real-card_border','ouro-real-name_style','ouro-real-server','vaporwave-frame','vaporwave-effect','vaporwave-card_border','vaporwave-name_style','vaporwave-server','holografica-frame','holografica-effect','holografica-card_border','holografica-name_style','holografica-server','noite-bruxas-frame','noite-bruxas-effect','noite-bruxas-card_border','noite-bruxas-name_style','noite-bruxas-server','equipe-orbita-frame','equipe-orbita-effect','equipe-orbita-card_border','equipe-orbita-name_style','equipe-orbita-server','graca-divina-frame','graca-divina-effect','graca-divina-card_border','graca-divina-name_style','graca-divina-server','cyberpunk-frame','cyberpunk-effect','cyberpunk-card_border','cyberpunk-name_style','cyberpunk-server','anime-frame','anime-effect','anime-card_border','anime-name_style','anime-server','espaco-frame','espaco-effect','espaco-card_border','espaco-name_style','espaco-server','natureza-frame','natureza-effect','natureza-card_border','natureza-name_style','natureza-server','halloween-frame','halloween-effect','halloween-card_border','halloween-name_style','halloween-server','lofi-frame','lofi-effect','lofi-card_border','lofi-name_style','lofi-server','retro-frame','retro-effect','retro-card_border','retro-name_style','retro-server','oceano-frame','oceano-effect','oceano-card_border','oceano-name_style','oceano-server','glitch-frame','glitch-effect','glitch-card_border','glitch-name_style','glitch-server','divino-frame','divino-effect','divino-card_border','divino-name_style','divino-server','sombrio-frame','sombrio-effect','sombrio-card_border','sombrio-name_style','sombrio-server','natal-frame','natal-effect','natal-card_border','natal-name_style','natal-server','romance-frame','romance-effect','romance-card_border','romance-name_style','romance-server','luxo-frame','luxo-effect','luxo-card_border','luxo-name_style','luxo-server','zen-frame','zen-effect','zen-card_border','zen-name_style','zen-server','orbita-staff-frame','orbita-staff-effect','orbita-staff-card_border','orbita-staff-name_style','orbita-staff-server','coroa-espinhos-frame']::text[];
  fonts text[]:=array['orbitron','pressstart','pacifico','bungee','monoton','creepster','righteous','audiowide','caveat','cinzel','silkscreen','lobster','spacemono','shrikhand']::text[];
  effects text[]:=array['gradient','neon','glitch','shine','rainbow','fire','staff']::text[];
  admin_only text[]:=array['orbita-staff-border','orbita-staff-plate','equipe-orbita-frame','equipe-orbita-effect','equipe-orbita-card_border','equipe-orbita-name_style','equipe-orbita-server','orbita-staff-frame','orbita-staff-effect','orbita-staff-card_border','orbita-staff-name_style','orbita-staff-server','name:staff']::text[];
  owner_items text[]:=array['graca-divina-frame','graca-divina-effect','graca-divina-card_border','graca-divina-name_style','graca-divina-server','coroa-espinhos-frame']::text[];
  owner_ids uuid[]:=array['50e5ae56-07e3-4023-9461-f653997fcc2e','50e5ae56-07e3-4023-9461-f653997fcc2e','50e5ae56-07e3-4023-9461-f653997fcc2e','50e5ae56-07e3-4023-9461-f653997fcc2e','50e5ae56-07e3-4023-9461-f653997fcc2e','50e5ae56-07e3-4023-9461-f653997fcc2e']::uuid[];
  admin boolean:=exists(select 1 from public.site_roles where user_id=new.id and role in ('admin','creator'));
begin
  if tg_op='UPDATE' and new.appearance is not distinct from old.appearance then return new; end if;
  for k,v in select key,value#>>'{}' from jsonb_each(a) loop
    if k in ('frame','border','effect','server','plate','card_border','name_style') then
      if jsonb_typeof(a->k)<>'string' then raise exception 'Item de personalização inválido.' using errcode='22023'; end if;
      if v<>'' and not (v=any(items) and v like '%-'||k) then raise exception 'Item de personalização inválido: %',v using errcode='22023'; end if;
      if v=any(admin_only) and not admin then raise exception 'Este item é exclusivo dos administradores do app.' using errcode='42501'; end if;
      if v=any(owner_items) and new.id is distinct from owner_ids[array_position(owner_items,v)] then raise exception 'Este item é exclusivo de outra conta.' using errcode='42501'; end if;
    elsif k='name_font' then if v<>'' and not v=any(fonts) then raise exception 'Fonte inválida.' using errcode='22023'; end if;
    elsif k='name_effect' then
      if v<>'' and not v=any(effects) then raise exception 'Efeito inválido.' using errcode='22023'; end if;
      if v<>'' and ('name:'||v)=any(admin_only) and not admin then raise exception 'Este efeito é exclusivo dos administradores do app.' using errcode='42501'; end if;
    elsif k='theme' then
      if jsonb_typeof(a->'theme')<>'array' or jsonb_array_length(a->'theme')<>2 or exists(select 1 from jsonb_array_elements_text(a->'theme') c where c !~ '^#[0-9a-fA-F]{6}$') then raise exception 'Tema de cor inválido.' using errcode='22023'; end if;
    elsif k='badges' then
      if jsonb_typeof(a->'badges')<>'array' or jsonb_array_length(a->'badges')>3 then raise exception 'Fixe no máximo 3 insígnias.' using errcode='22023'; end if;
    elsif k in ('legacy_frame','legacy_effect','banner_style') then
      if char_length(v)>48 or v !~ '^[a-z0-9-]*$' then raise exception 'Valor inválido.' using errcode='22023'; end if;
    else raise exception 'Campo de aparência desconhecido: %',k using errcode='22023';
    end if;
  end loop;
  return new;
end $$;
revoke all on function orbita_private.guard_appearance() from public, anon, authenticated;
-- Tema de servidor exclusivo: só o dono do item aplica numa comunidade.
create or replace function orbita_private.guard_community_theme() returns trigger
language plpgsql security definer set search_path to '' as $$
declare owner_items text[]:=array['graca-divina-frame','graca-divina-effect','graca-divina-card_border','graca-divina-name_style','graca-divina-server','coroa-espinhos-frame']::text[]; owner_ids uuid[]:=array['50e5ae56-07e3-4023-9461-f653997fcc2e','50e5ae56-07e3-4023-9461-f653997fcc2e','50e5ae56-07e3-4023-9461-f653997fcc2e','50e5ae56-07e3-4023-9461-f653997fcc2e','50e5ae56-07e3-4023-9461-f653997fcc2e','50e5ae56-07e3-4023-9461-f653997fcc2e']::uuid[];
begin
  if new.theme is not null and new.theme=any(owner_items) and (tg_op='INSERT' or new.theme is distinct from old.theme)
     and auth.uid() is distinct from owner_ids[array_position(owner_items,new.theme)] then
    raise exception 'Este tema é exclusivo de outra conta.' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function orbita_private.guard_community_theme() from public, anon, authenticated;
drop trigger if exists guard_community_theme on public.communities;
create trigger guard_community_theme before insert or update of theme on public.communities for each row execute function orbita_private.guard_community_theme();
