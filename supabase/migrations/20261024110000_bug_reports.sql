-- Relatórios de bug: qualquer usuário autenticado envia e lê os seus; ADMs globais leem e mudam o status.
create sequence if not exists public.bug_report_seq;
create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('BUG-' || lpad(nextval('public.bug_report_seq')::text, 4, '0')),
  reporter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  description text not null check (char_length(btrim(description)) between 3 and 4000),
  attachments text[] not null default '{}' check (cardinality(attachments) <= 6),
  status text not null default 'aberto' check (status in ('aberto','em análise','resolvido','descartado')),
  app_version text check (char_length(app_version) <= 64),
  platform text check (char_length(platform) <= 64),
  user_agent text check (char_length(user_agent) <= 512),
  route text check (char_length(route) <= 256),
  created_at timestamptz not null default now()
);
create index if not exists bug_reports_reporter_idx on public.bug_reports(reporter_id, created_at desc);
alter table public.bug_reports enable row level security;
revoke all on public.bug_reports from anon, authenticated;
grant select on public.bug_reports to authenticated;
grant insert (description, attachments, app_version, platform, user_agent, route) on public.bug_reports to authenticated;
grant update (status) on public.bug_reports to authenticated;
grant usage on sequence public.bug_report_seq to authenticated;
create policy bug_reports_insert on public.bug_reports for insert to authenticated
  with check (reporter_id = (select auth.uid()) and not exists (select 1 from unnest(attachments) a where a !~ ('^bug-reports/' || (select auth.uid())::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif|mp4|webm|mov)$')));
create policy bug_reports_read on public.bug_reports for select to authenticated
  using (reporter_id = (select auth.uid()) or (select public.is_site_admin()));
create policy bug_reports_admin_update on public.bug_reports for update to authenticated
  using ((select public.is_site_admin())) with check ((select public.is_site_admin()));
-- Anexos em orbita-files/bug-reports/<uid>/<uuid>.<ext>
create policy orbita_files_bug_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'orbita-files' and (storage.foldername(name))[1] = 'bug-reports' and (storage.foldername(name))[2] = (select auth.uid())::text and name ~ '^bug-reports/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif|mp4|webm|mov)$');
create policy orbita_files_bug_read on storage.objects for select to authenticated
  using (bucket_id = 'orbita-files' and (storage.foldername(name))[1] = 'bug-reports' and ((storage.foldername(name))[2] = (select auth.uid())::text or (select public.is_site_admin())));
