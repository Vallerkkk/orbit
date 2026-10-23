begin;
create temporary table sp_fixture(owner_id uuid,member_id uuid,mod_id uuid,community_id uuid,role_id uuid,mod_role uuid) on commit drop;
insert into sp_fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
grant select on sp_fixture to authenticated;
insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
select uid,'authenticated','authenticated','qa-'||uid||'@example.invalid',jsonb_build_object('display_name','QA temporário'),'{"provider":"email","providers":["email"]}'::jsonb,now(),now()
from sp_fixture f cross join lateral unnest(array[f.owner_id,f.member_id,f.mod_id])uid;
insert into public.communities(id,name,created_by)select community_id,'QA perms',owner_id from sp_fixture;
insert into public.community_members(community_id,user_id)select community_id,member_id from sp_fixture union all select community_id,mod_id from sp_fixture;
insert into public.community_roles(id,community_id,name,self_assignable,permissions)select role_id,community_id,'cor',true,'{}' from sp_fixture;
insert into public.community_roles(id,community_id,name,self_assignable,permissions)select mod_role,community_id,'mod',false,'{manage_channels}' from sp_fixture;
insert into public.community_member_roles(community_id,user_id,role_id)select community_id,mod_id,mod_role from sp_fixture;
set local role authenticated;
do $$declare f record;n integer;denied boolean;admin_id uuid;begin
 select * into f from sp_fixture;
 -- membro comum
 perform set_config('request.jwt.claims',json_build_object('sub',f.member_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',f.member_id::text,true);
 if public.can_edit_community(f.community_id) then raise exception 'FAIL member can_edit';end if;
 update public.communities set name='hack',invite_only=true where id=f.community_id;get diagnostics n=row_count;if n<>0 then raise exception 'FAIL member updated community';end if;
 update public.channels set name='hack' where community_id=f.community_id;get diagnostics n=row_count;if n<>0 then raise exception 'FAIL member updated channel';end if;
 update public.community_roles set permissions='{manage_roles}' where community_id=f.community_id;get diagnostics n=row_count;if n<>0 then raise exception 'FAIL member updated role';end if;
 denied:=false;begin insert into public.community_member_roles(community_id,user_id,role_id)values(f.community_id,f.member_id,f.mod_role);exception when others then denied:=true;end;if not denied then raise exception 'FAIL member self-granted mod role';end if;
 insert into public.community_member_roles(community_id,user_id,role_id)values(f.community_id,f.member_id,f.role_id);
 denied:=false;begin insert into public.community_welcome(community_id,rules)values(f.community_id,'hack');exception when others then denied:=true;end;if not denied then raise exception 'FAIL member edited welcome';end if;
 delete from public.community_roles where community_id=f.community_id;get diagnostics n=row_count;if n<>0 then raise exception 'FAIL member deleted role';end if;
 -- moderador com manage_channels: não edita dados do servidor
 perform set_config('request.jwt.claims',json_build_object('sub',f.mod_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',f.mod_id::text,true);
 update public.communities set name='hack' where id=f.community_id;get diagnostics n=row_count;if n<>0 then raise exception 'FAIL mod updated community';end if;
 -- dono
 perform set_config('request.jwt.claims',json_build_object('sub',f.owner_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
 if not public.can_edit_community(f.community_id) then raise exception 'FAIL owner can_edit';end if;
 update public.communities set name='QA ok',invite_only=true where id=f.community_id;get diagnostics n=row_count;if n<>1 then raise exception 'FAIL owner update';end if;
 denied:=false;begin update public.community_roles set permissions='{manage_roles}' where id=f.role_id;exception when others then denied:=true;end;if not denied then raise exception 'FAIL self-assignable role got perms';end if;
 denied:=false;begin update public.community_roles set community_id=gen_random_uuid() where id=f.mod_role;exception when others then denied:=true;end;if not denied then raise exception 'FAIL role moved';end if;
 update public.community_roles set name='cor2' where id=f.role_id;get diagnostics n=row_count;if n<>1 then raise exception 'FAIL owner role edit';end if;
 -- ADM global
 select user_id into admin_id from public.site_roles where role in('creator','admin') limit 1;
 if admin_id is not null then
  perform set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  update public.communities set description='adm' where id=f.community_id;get diagnostics n=row_count;if n<>1 then raise exception 'FAIL site admin update';end if;
 end if;
 raise notice 'server permissions: all checks passed';
end $$;
rollback;
