begin;
create temporary table pcs_users(owner_id uuid,member_id uuid) on commit drop;
insert into pcs_users values(gen_random_uuid(),gen_random_uuid());
grant select on pcs_users to authenticated;
insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
select uid,'authenticated','authenticated','qa-'||uid||'@example.invalid',jsonb_build_object('display_name','QA temporário'),'{"provider":"email","providers":["email"]}'::jsonb,now(),now()
from pcs_users f cross join lateral unnest(array[f.owner_id,f.member_id])uid;
set local role authenticated;
do $$declare f record;cid uuid;chid uuid;token text;token2 text;denied boolean;n integer;invites jsonb;admin_id uuid;begin
 select * into f from pcs_users;

 -- Dono cria o servidor fechado, o canal padrão e o primeiro convite.
 perform set_config('request.jwt.claims',json_build_object('sub',f.owner_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
 insert into public.communities(name,description,invite_only)values('Servidor privado QA','',true)returning id into cid;
 insert into public.channels(name,kind,position,community_id,default_for_new_members)values('geral','text',0,cid,true)returning id into chid;
 token:=public.create_community_invite(cid,24,2);
 if token is null then raise exception 'FAIL owner invite';end if;
 invites:=public.list_community_invites(cid);
 if jsonb_array_length(invites)<>1 then raise exception 'FAIL owner invite list';end if;

 -- Membro comum: não vê o servidor fechado, não lê canais e não cria/lista convites.
 perform set_config('request.jwt.claims',json_build_object('sub',f.member_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',f.member_id::text,true);
 if exists(select 1 from public.communities where id=cid) then raise exception 'FAIL member sees private server';end if;
 if exists(select 1 from public.channels where id=chid) then raise exception 'FAIL member reads private channel';end if;
 denied:=false;begin perform public.create_community_invite(cid,24,2);exception when others then denied:=true;end;
 if not denied then raise exception 'FAIL member created invite';end if;
 denied:=false;begin perform public.list_community_invites(cid);exception when others then denied:=true;end;
 if not denied then raise exception 'FAIL member listed invites';end if;

 -- Convite dá acesso e cada conta só consome uma entrada, mesmo reabrindo o link.
 if public.join_community_invite(token)<>cid then raise exception 'FAIL member join';end if;
 if not exists(select 1 from public.communities where id=cid) then raise exception 'FAIL member cannot see server after invite';end if;
 if not exists(select 1 from public.channels where id=chid) then raise exception 'FAIL member cannot read channel after invite';end if;
 perform public.join_community_invite(token);
 perform set_config('request.jwt.claims',json_build_object('sub',f.owner_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
 n:=(public.list_community_invites(cid)->0->>'uses')::int;
 if n<>1 then raise exception 'FAIL invite uses %',n;end if;

 -- Membro não consegue remover o dono pela tabela; o dono expulsa pela RPC auditada.
 perform set_config('request.jwt.claims',json_build_object('sub',f.member_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',f.member_id::text,true);
 delete from public.community_members where community_id=cid and user_id=f.owner_id;
 get diagnostics n=row_count;if n<>0 then raise exception 'FAIL member removed owner';end if;
 perform set_config('request.jwt.claims',json_build_object('sub',f.owner_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
 if not public.remove_community_member(cid,f.member_id) then raise exception 'FAIL owner kick';end if;
 if not exists(select 1 from public.audit_log where community_id=cid and action='kick' and target_id=f.member_id) then raise exception 'FAIL kick audit';end if;

 -- Banido não volta nem com convite novo.
 token2:=public.create_community_invite(cid,24,5);
 perform public.moderate_member(cid,f.member_id,'ban','QA');
 perform set_config('request.jwt.claims',json_build_object('sub',f.member_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',f.member_id::text,true);
 denied:=false;begin perform public.join_community_invite(token2);exception when others then denied:=true;end;
 if not denied then raise exception 'FAIL banned member rejoined';end if;

 -- ADM global entra sem convite e lê os canais, mas não cria convites do servidor fechado.
 select user_id into admin_id from public.site_roles where role in('creator','admin')limit 1;
 if admin_id is not null then
  perform set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  if public.join_community_as_admin(cid)<>cid then raise exception 'FAIL admin entry';end if;
  if not exists(select 1 from public.channels where id=chid) then raise exception 'FAIL admin cannot read channel';end if;
  denied:=false;begin perform public.create_community_invite(cid,24,2);exception when others then denied:=true;end;
  if not denied then raise exception 'FAIL admin created private invite';end if;
 end if;

 raise notice 'private call servers: all checks passed';
end $$;
rollback;
