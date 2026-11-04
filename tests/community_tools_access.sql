begin;
create temporary table ct_users(owner_id uuid,member_id uuid) on commit drop;
insert into ct_users values(gen_random_uuid(),gen_random_uuid());
grant select on ct_users to authenticated;
insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
select uid,'authenticated','authenticated','qa-'||uid||'@example.invalid',jsonb_build_object('display_name','QA temporário'),'{"provider":"email","providers":["email"]}'::jsonb,now(),now()
from ct_users f cross join lateral unnest(array[f.owner_id,f.member_id])uid;
set local role authenticated;
do $$declare f record;cid uuid;chid uuid;cat uuid;eid uuid;denied boolean;n integer;begin
 select * into f from ct_users;

 -- Dono cria servidor público, canal de texto e uma categoria.
 perform set_config('request.jwt.claims',json_build_object('sub',f.owner_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
 insert into public.communities(name,description)values('Categorias QA','')returning id into cid;
 insert into public.channels(name,kind,position,community_id)values('geral','text',0,cid)returning id into chid;
 insert into public.channel_categories(community_id,name,position)values(cid,'Projetos',1)returning id into cat;
 update public.channels set category_id=cat where id=chid;

 -- Membro entra e enxerga a categoria, mas não pode criar nem renomear.
 perform set_config('request.jwt.claims',json_build_object('sub',f.member_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',f.member_id::text,true);
 perform public.join_public_community(cid);
 if not exists(select 1 from public.channel_categories where id=cat) then raise exception 'FAIL member sees category';end if;
 denied:=false;begin insert into public.channel_categories(community_id,name,position)values(cid,'Intrusa',2);exception when others then denied:=true;end;
 if not denied then raise exception 'FAIL member created category';end if;
 update public.channel_categories set name='Invadida' where id=cat;
 get diagnostics n=row_count;if n<>0 then raise exception 'FAIL member renamed category';end if;

 -- Evento é criado pelo dono e visível ao membro; RSVP pertence a cada conta.
 perform set_config('request.jwt.claims',json_build_object('sub',f.owner_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
 insert into public.community_events(community_id,channel_id,title,description,starts_at)
 values(cid,chid,'Reunião QA','',now()+interval '1 day')returning id into eid;
 perform set_config('request.jwt.claims',json_build_object('sub',f.member_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',f.member_id::text,true);
 if not exists(select 1 from public.community_events where id=eid) then raise exception 'FAIL event not visible';end if;
 insert into public.community_event_rsvps(event_id,user_id,status)values(eid,f.member_id,'going');
 if not exists(select 1 from public.community_event_rsvps where event_id=eid and user_id=f.member_id) then raise exception 'FAIL member rsvp';end if;
 denied:=false;begin insert into public.community_event_rsvps(event_id,user_id,status)values(eid,f.owner_id,'going');exception when others then denied:=true;end;
 if not denied then raise exception 'FAIL rsvp for another member';end if;
 update public.community_events set title='Invadido' where id=eid;
 get diagnostics n=row_count;if n<>0 then raise exception 'FAIL member edited event';end if;
 denied:=false;begin insert into public.community_events(community_id,title,starts_at)values(cid,'Evento intruso',now()+interval '2 days');exception when others then denied:=true;end;
 if not denied then raise exception 'FAIL member created event';end if;

 -- Modo lento: o membro envia uma mensagem e a seguinte é bloqueada.
 perform set_config('request.jwt.claims',json_build_object('sub',f.owner_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
 update public.channels set slowmode_seconds=60 where id=chid;
 perform set_config('request.jwt.claims',json_build_object('sub',f.member_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',f.member_id::text,true);
 insert into public.messages(channel_id,author_id,content)values(chid,f.member_id,'primeira');
 denied:=false;begin insert into public.messages(channel_id,author_id,content)values(chid,f.member_id,'segunda');exception when others then denied:=true;end;
 if not denied then raise exception 'FAIL slowmode';end if;

 -- Automoderação de links: membro é bloqueado; moderador (dono) passa.
 perform set_config('request.jwt.claims',json_build_object('sub',f.owner_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
 update public.channels set slowmode_seconds=0 where id=chid;
 update public.communities set automod_links=true where id=cid;
 perform set_config('request.jwt.claims',json_build_object('sub',f.member_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',f.member_id::text,true);
 denied:=false;begin insert into public.messages(channel_id,author_id,content)values(chid,f.member_id,'olha https://example.invalid');exception when others then denied:=true;end;
 if not denied then raise exception 'FAIL automod link';end if;
 perform set_config('request.jwt.claims',json_build_object('sub',f.owner_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
 begin insert into public.messages(channel_id,author_id,content)values(chid,f.owner_id,'olha https://example.invalid');exception when others then raise exception 'FAIL moderator bypass';end;
end$$;
rollback;
