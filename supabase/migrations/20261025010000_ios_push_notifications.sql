-- Notificações do app iOS (APNs). Um job por evento, entregue a todos os
-- aparelhos da pessoa (navegador e iPhone): os gatilhos passam a considerar
-- qualquer aparelho e push_take entrega o mesmo job às duas plataformas.

create table if not exists public.ios_push_subscriptions(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_token text not null unique check(device_token ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists ios_push_subscriptions_user_idx on public.ios_push_subscriptions(user_id);
alter table public.ios_push_subscriptions enable row level security;
grant select,delete on public.ios_push_subscriptions to authenticated;
drop policy if exists ios_push_own on public.ios_push_subscriptions;
create policy ios_push_own on public.ios_push_subscriptions for all to authenticated
  using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

-- O token pertence ao aparelho: quem está logado nele passa a recebê-lo, mesmo
-- que outra conta o tenha registrado antes no mesmo iPhone.
create or replace function public.register_ios_device(token text)
returns boolean language plpgsql security definer set search_path=''
as $$
begin
 if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
 if token is null or token !~ '^[0-9a-f]{64}$' then raise exception 'Aparelho inválido.'; end if;
 insert into public.ios_push_subscriptions(user_id,device_token) values(auth.uid(),token)
 on conflict(device_token) do update set user_id=excluded.user_id,last_seen_at=now();
 return true;
end $$;
revoke all on function public.register_ios_device(text) from public,anon;
grant execute on function public.register_ios_device(text) to authenticated;

create or replace function orbita_private.has_push_device(person uuid)
returns boolean language sql stable security definer set search_path=''
as $$select exists(select 1 from public.push_subscriptions where user_id=person)
          or exists(select 1 from public.ios_push_subscriptions where user_id=person)$$;
revoke all on function orbita_private.has_push_device(uuid) from public,anon,authenticated;

create or replace function orbita_private.message_activity()
returns trigger language plpgsql security definer set search_path=''
as $$ declare recipient record; community uuid; destination text; mentioned boolean; note jsonb; begin
 if tg_table_name='messages' then select community_id into community from public.channels where id=new.channel_id;destination:='/?channel='||new.channel_id||'&message='||new.id;
 else destination:='/?dm='||new.conversation_id||'&message='||new.id;end if;
 for recipient in
  select p.id,p.username,p.presence_status from public.profiles p where p.id<>new.author_id and (
   (tg_table_name='messages' and exists(select 1 from public.community_members cm where cm.community_id=community and cm.user_id=p.id))
   or (tg_table_name='direct_messages' and exists(select 1 from public.conversations c where c.id=(to_jsonb(new)->>'conversation_id')::uuid and p.id in(c.user_a,c.user_b))))
 loop
  if tg_table_name='messages' then
   if not coalesce(orbita_private.channel_access_for(recipient.id,new.channel_id),false) then continue;end if;
  end if;
  mentioned:=tg_table_name='direct_messages' or lower(new.content) ~ ('(^|[^a-z0-9_])@'||lower(recipient.username)||'([^a-z0-9_]|$)');
  note:=jsonb_build_object('id',new.id,'author_id',new.author_id,'scope',coalesce(to_jsonb(new)->>'channel_id',to_jsonb(new)->>'conversation_id'),'private',tg_table_name='direct_messages','mentioned',mentioned,'thread_root',new.thread_root,'created_at',new.created_at);
  perform realtime.send(note,'activity','user:'||recipient.id,true);
  if mentioned and recipient.presence_status<>'dnd' and orbita_private.has_push_device(recipient.id) then
   insert into orbita_private.push_jobs(author_id,recipient_id,payload)values(new.author_id,recipient.id,jsonb_build_object('title',case when tg_table_name='direct_messages' then 'Nova mensagem privada · Órbita' else 'Você foi mencionado · Órbita' end,'body','Abra a Órbita para ler a mensagem.','url',destination,'tag','orbita-'||new.id));
  end if;
 end loop;return new;
end $$;

create or replace function orbita_private.member_welcome_notify()
returns trigger language plpgsql security definer set search_path='' as $$
declare actor record; target record; msg text;
begin
 select id,display_name,username into actor from public.profiles where id=new.user_id;
 select id,presence_status into target from public.profiles where id=new.member_id;
 if actor.id is null or target.id is null then return new; end if;
 msg:=coalesce(nullif(btrim(actor.display_name),''),'@'||actor.username,'Alguém')||' te deu boas-vindas na Órbita';
 perform realtime.send(jsonb_build_object('actor_id',actor.id,'actor_name',coalesce(nullif(btrim(actor.display_name),''),actor.username),'text',msg,'created_at',new.created_at),'welcome','user:'||target.id,true);
 if coalesce(target.presence_status,'')<>'dnd' and orbita_private.has_push_device(target.id)
    and not exists(select 1 from orbita_private.push_jobs j where j.author_id=actor.id and j.recipient_id=target.id and j.payload->>'tag'='orbita-welcome-'||actor.id and j.created_at>now()-interval '1 day') then
  insert into orbita_private.push_jobs(author_id,recipient_id,payload)
  values(actor.id,target.id,jsonb_build_object('title','Boas-vindas · Órbita','body',msg,'url','/?members=1','tag','orbita-welcome-'||actor.id));
 end if;
 return new;
end $$;

create or replace function orbita_private.push_take(transport_key text)
returns jsonb language plpgsql security definer set search_path=''
as $$ declare result jsonb; begin
 if auth.uid() is null or not exists(select 1 from orbita_private.push_config where transport_hash=encode(sha256(convert_to(transport_key,'UTF8')),'hex')) then raise exception 'Transporte não autorizado.';end if;
 delete from orbita_private.push_jobs where created_at<now()-interval '2 days';
 with jobs as (select id from orbita_private.push_jobs where author_id=auth.uid() and not done and attempts<3 and created_at>now()-interval '10 minutes' and (lease_until is null or lease_until<now()) order by created_at for update skip locked limit 5), leased as (update orbita_private.push_jobs j set attempts=attempts+1,lease_until=now()+interval '90 seconds' from jobs where j.id=jobs.id returning j.*),
 deliveries as (
  select jsonb_build_object('job_id',j.id,'payload',j.payload,'subscription_id',s.id,'platform','web','endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth) as d from leased j join public.push_subscriptions s on s.user_id=j.recipient_id
  union all
  select jsonb_build_object('job_id',j.id,'payload',j.payload,'subscription_id',s.id,'platform','ios','device_token',s.device_token) from leased j join public.ios_push_subscriptions s on s.user_id=j.recipient_id)
 select coalesce(jsonb_agg(d),'[]'::jsonb) into result from deliveries;
 return result;
end $$;

create or replace function orbita_private.push_finish(transport_key text,job uuid,expired uuid default null,success boolean default true)
returns boolean language plpgsql security definer set search_path=''
as $$ begin
 if auth.uid() is null or not exists(select 1 from orbita_private.push_config where transport_hash=encode(sha256(convert_to(transport_key,'UTF8')),'hex')) then raise exception 'Transporte não autorizado.';end if;
 if expired is not null then
  delete from public.push_subscriptions s using orbita_private.push_jobs j where j.id=job and j.author_id=auth.uid() and s.id=expired and s.user_id=j.recipient_id;
  delete from public.ios_push_subscriptions s using orbita_private.push_jobs j where j.id=job and j.author_id=auth.uid() and s.id=expired and s.user_id=j.recipient_id;
 end if;
 update orbita_private.push_jobs set done=success,lease_until=case when success then null else now()+interval '20 seconds' end where id=job and author_id=auth.uid();return true;
end $$;
notify pgrst,'reload schema';
