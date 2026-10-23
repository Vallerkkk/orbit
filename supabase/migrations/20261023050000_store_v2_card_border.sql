-- Loja v2: coleções novas, "Borda de cartão" (card_border) e "Estilo de nome" (name_style) em profiles.appearance.
-- GERADO por scripts/appearance-sql.mjs. Só troca a função do trigger; itens de ADM seguem bloqueados no servidor.
create or replace function orbita_private.guard_appearance() returns trigger
language plpgsql security definer set search_path to '' as $$
declare a jsonb:=coalesce(new.appearance,'{}'::jsonb); k text; v text;
  items text[]:=array['cyberpunk-frame','cyberpunk-border','cyberpunk-effect','cyberpunk-server','cyberpunk-plate','anime-frame','anime-border','anime-effect','anime-server','anime-plate','espaco-frame','espaco-border','espaco-effect','espaco-server','espaco-plate','natureza-frame','natureza-border','natureza-effect','natureza-server','natureza-plate','halloween-frame','halloween-border','halloween-effect','halloween-server','halloween-plate','lofi-frame','lofi-border','lofi-effect','lofi-server','lofi-plate','retro-frame','retro-border','retro-effect','retro-server','retro-plate','oceano-frame','oceano-border','oceano-effect','oceano-server','oceano-plate','glitch-frame','glitch-border','glitch-effect','glitch-server','glitch-plate','orbita-staff-frame','orbita-staff-border','orbita-staff-effect','orbita-staff-server','orbita-staff-plate','nebulosa-frame','nebulosa-effect','nebulosa-card_border','nebulosa-name_style','nebulosa-server','cyber-tokyo-frame','cyber-tokyo-effect','cyber-tokyo-card_border','cyber-tokyo-name_style','cyber-tokyo-server','floresta-frame','floresta-effect','floresta-card_border','floresta-name_style','floresta-server','inferno-frame','inferno-effect','inferno-card_border','inferno-name_style','inferno-server','abissal-frame','abissal-effect','abissal-card_border','abissal-name_style','abissal-server','sakura-frame','sakura-effect','sakura-card_border','sakura-name_style','sakura-server','arcade-frame','arcade-effect','arcade-card_border','arcade-name_style','arcade-server','tempestade-frame','tempestade-effect','tempestade-card_border','tempestade-name_style','tempestade-server','aurora-frame','aurora-effect','aurora-card_border','aurora-name_style','aurora-server','gelo-frame','gelo-effect','gelo-card_border','gelo-name_style','gelo-server','ouro-real-frame','ouro-real-effect','ouro-real-card_border','ouro-real-name_style','ouro-real-server','vaporwave-frame','vaporwave-effect','vaporwave-card_border','vaporwave-name_style','vaporwave-server','holografica-frame','holografica-effect','holografica-card_border','holografica-name_style','holografica-server','noite-bruxas-frame','noite-bruxas-effect','noite-bruxas-card_border','noite-bruxas-name_style','noite-bruxas-server','equipe-orbita-frame','equipe-orbita-effect','equipe-orbita-card_border','equipe-orbita-name_style','equipe-orbita-server']::text[];
  fonts text[]:=array['orbitron','pressstart','pacifico','bungee','monoton','creepster','righteous','audiowide','caveat','cinzel','silkscreen','lobster','spacemono','shrikhand']::text[];
  effects text[]:=array['gradient','neon','glitch','shine','rainbow','fire','staff']::text[];
  admin_only text[]:=array['orbita-staff-frame','orbita-staff-border','orbita-staff-effect','orbita-staff-server','orbita-staff-plate','equipe-orbita-frame','equipe-orbita-effect','equipe-orbita-card_border','equipe-orbita-name_style','equipe-orbita-server','name:staff']::text[];
  admin boolean:=exists(select 1 from public.site_roles where user_id=new.id and role in ('admin','creator'));
begin
  if tg_op='UPDATE' and new.appearance is not distinct from old.appearance then return new; end if;
  for k,v in select key,value#>>'{}' from jsonb_each(a) loop
    if k in ('frame','border','effect','server','plate','card_border','name_style') then
      if jsonb_typeof(a->k)<>'string' then raise exception 'Item de personalização inválido.' using errcode='22023'; end if;
      if v<>'' and not (v=any(items) and v like '%-'||k) then raise exception 'Item de personalização inválido: %',v using errcode='22023'; end if;
      if v=any(admin_only) and not admin then raise exception 'Este item é exclusivo dos administradores do app.' using errcode='42501'; end if;
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
