-- O realtime-js 2.15+ trata o tópico internamente como `realtime:<nome>`.
-- As políticas comparavam o nome cru, então presença e colaboração eram negadas
-- mesmo para membros autenticados. Aceitamos as duas formas.

create or replace function orbita_private.realtime_access(topic text, writing boolean default false)
returns boolean language plpgsql stable security definer set search_path=''
as $$ declare pieces text[];target uuid;begin
 if auth.uid() is null then return false;end if;
 pieces:=string_to_array(regexp_replace(coalesce(topic,''),'^realtime:','','i'),':');
 if array_length(pieces,1)=2 and pieces[1]='user' then return not writing and pieces[2]=auth.uid()::text;end if;
 if array_length(pieces,1)<>3 or pieces[1]<>'orbita' then return false;end if;
 begin target:=pieces[3]::uuid; exception when invalid_text_representation then return false;end;
 if pieces[2]='channel' then return orbita_private.can_read_channel(target);
 elsif pieces[2]='direct' then return exists(select 1 from public.conversations where id=target and auth.uid() in(user_a,user_b));end if;
 return false;
end $$;
revoke all on function orbita_private.realtime_access(text,boolean) from public,anon;
grant execute on function orbita_private.realtime_access(text,boolean) to authenticated;

drop policy if exists orbita_presence_read on realtime.messages;
create policy orbita_presence_read on realtime.messages for select to authenticated
  using(regexp_replace(coalesce((select realtime.topic()),''),'^realtime:','','i')='community:main');
drop policy if exists orbita_presence_write on realtime.messages;
create policy orbita_presence_write on realtime.messages for insert to authenticated
  with check(regexp_replace(coalesce((select realtime.topic()),''),'^realtime:','','i')='community:main');
