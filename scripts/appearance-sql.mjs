// Gera a migration da Loja v3 (antes v2): validação de profiles.appearance com as coleções novas,
// a borda de cartão (card_border) e o estilo de nome (name_style). Fonte: static/cosmetics.js.
import {writeFile} from 'node:fs/promises';
import {ITEMS,NAME_FONTS,NAME_EFFECTS,ADMIN_ONLY} from '../static/cosmetics.js';
const q=s=>`'${String(s).replace(/'/g,"''")}'`,arr=a=>`array[${a.map(q).join(',')}]::text[]`;
const sql=`-- Loja v3: coleções clássicas refeitas (cada uma com moldura, efeito, borda de cartão, estilo de nome e tema)
-- + coleções novas. Ids antigos (-border, -plate e os de pacote) seguem aceitos como apelidos.
-- GERADO por scripts/appearance-sql.mjs. Só troca a função do trigger; itens de ADM seguem bloqueados no servidor.
create or replace function orbita_private.guard_appearance() returns trigger
language plpgsql security definer set search_path to '' as $$
declare a jsonb:=coalesce(new.appearance,'{}'::jsonb); k text; v text;
  items text[]:=${arr(ITEMS.map(i=>i.id))};
  fonts text[]:=${arr(NAME_FONTS.map(f=>f.id))};
  effects text[]:=${arr(NAME_EFFECTS.map(e=>e.id))};
  admin_only text[]:=${arr(ADMIN_ONLY)};
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
`;
await writeFile(new URL('../supabase/migrations/20261023070000_store_v3_classics.sql',import.meta.url),sql);console.log('ok',ITEMS.length);
