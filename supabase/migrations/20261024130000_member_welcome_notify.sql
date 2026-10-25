-- Boas-vindas notificam o membro: aviso em tempo real (in-app) + push (se houver inscrição) e entrada em social_activity.
create or replace function orbita_private.member_welcome_notify()
returns trigger language plpgsql security definer set search_path='' as $$
declare actor record; target record; msg text;
begin
 select id,display_name,username into actor from public.profiles where id=new.user_id;
 select id,presence_status into target from public.profiles where id=new.member_id;
 if actor.id is null or target.id is null then return new; end if;
 msg:=coalesce(nullif(btrim(actor.display_name),''),'@'||actor.username,'Alguém')||' te deu boas-vindas na Órbita';
 perform realtime.send(jsonb_build_object('actor_id',actor.id,'actor_name',coalesce(nullif(btrim(actor.display_name),''),actor.username),'text',msg,'created_at',new.created_at),'welcome','user:'||target.id,true);
 if coalesce(target.presence_status,'')<>'dnd' and exists(select 1 from public.push_subscriptions where user_id=target.id)
    and not exists(select 1 from orbita_private.push_jobs j where j.author_id=actor.id and j.recipient_id=target.id and j.payload->>'tag'='orbita-welcome-'||actor.id and j.created_at>now()-interval '1 day') then
  insert into orbita_private.push_jobs(author_id,recipient_id,payload)
  values(actor.id,target.id,jsonb_build_object('title','Boas-vindas · Órbita','body',msg,'url','/?members=1','tag','orbita-welcome-'||actor.id));
 end if;
 return new;
end $$;
revoke all on function orbita_private.member_welcome_notify() from public,anon,authenticated;
drop trigger if exists member_welcome_notify on public.member_welcomes;
create trigger member_welcome_notify after insert on public.member_welcomes for each row execute function orbita_private.member_welcome_notify();

create or replace function public.social_activity() returns jsonb language sql stable security invoker set search_path='' as $$
with events as (
 select l.user_id actor_id,l.post_id,l.created_at,'like'::text kind from public.social_likes l join public.social_posts p on p.id=l.post_id where p.author_id=auth.uid() and l.user_id<>auth.uid()
 union all select r.user_id,r.post_id,r.created_at,'repost' from public.social_reposts r join public.social_posts p on p.id=r.post_id where p.author_id=auth.uid() and r.user_id<>auth.uid()
 union all select r.author_id,r.id,r.created_at,'reply' from public.social_posts r join public.social_posts p on p.id=r.reply_to where p.author_id=auth.uid() and r.author_id<>auth.uid()
 union all select r.author_id,r.id,r.created_at,'quote' from public.social_posts r join public.social_posts p on p.id=r.quote_id where p.author_id=auth.uid() and r.author_id<>auth.uid()
 union all select f.follower_id,null::uuid,f.created_at,'follow' from public.social_follows f where f.following_id=auth.uid()
 union all select w.user_id,null::uuid,w.created_at,'welcome' from public.member_welcomes w where w.member_id=auth.uid() and w.user_id<>auth.uid()
),page as (select * from events where orbita_private.social_visible(actor_id) order by created_at desc,actor_id limit 50)
select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('actor',(select jsonb_build_object('id',u.id,'display_name',u.display_name,'username',u.username,'avatar_url',u.avatar_url,'avatar_color',u.avatar_color) from public.profiles u where u.id=e.actor_id)) order by e.created_at desc),'[]'::jsonb) from page e $$;
