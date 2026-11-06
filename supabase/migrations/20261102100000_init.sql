-- X Posting Tool: core schema
-- posts queue, single-row settings, single-row X credentials (service role only)

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Owner check. Only the confirmed owner account can read or change anything.
-- Change the email here if the dashboard login ever changes.
-- ---------------------------------------------------------------------------
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and lower(u.email) = 'martinmitovski17@gmail.com'
      and u.email_confirmed_at is not null
  );
$$;

revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Posts
-- parts[1] is the post itself, parts[2..n] are thread replies.
-- x_post_ids grows as each part goes live, so a failed thread can resume.
-- ---------------------------------------------------------------------------
create type public.post_status as enum ('draft', 'scheduled', 'publishing', 'posted', 'failed');

create table public.posts (
  id            uuid primary key default gen_random_uuid(),
  parts         text[] not null check (cardinality(parts) between 1 and 25),
  status        public.post_status not null default 'draft',
  scheduled_at  timestamptz,
  posted_at     timestamptz,
  x_post_ids    text[] not null default '{}',
  error         text,
  attempts      integer not null default 0,
  source        text not null default 'manual' check (source in ('manual', 'claude')),
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint scheduled_needs_time check (status <> 'scheduled' or scheduled_at is not null)
);

create index posts_due_idx on public.posts (scheduled_at) where status = 'scheduled';
create index posts_scheduled_at_idx on public.posts (scheduled_at desc nulls last);

create trigger posts_touch before update on public.posts
  for each row execute function public.touch_updated_at();

alter table public.posts enable row level security;

create policy "owner reads posts"   on public.posts for select to authenticated using ((select public.is_owner()));
create policy "owner inserts posts" on public.posts for insert to authenticated with check ((select public.is_owner()));
create policy "owner updates posts" on public.posts for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy "owner deletes posts" on public.posts for delete to authenticated using ((select public.is_owner()));

revoke all on public.posts from anon;

-- ---------------------------------------------------------------------------
-- Settings (single row). The owner may only change long_posts;
-- the rest is written by edge functions.
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id                     boolean primary key default true check (id),
  long_posts             boolean not null default false,
  x_username             text,
  x_name                 text,
  x_connected_at         timestamptz,
  publisher_last_run     timestamptz,
  publisher_last_result  text,
  updated_at             timestamptz not null default now()
);

insert into public.app_settings default values;

create trigger app_settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();

alter table public.app_settings enable row level security;

create policy "owner reads settings"   on public.app_settings for select to authenticated using ((select public.is_owner()));
create policy "owner updates settings" on public.app_settings for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to authenticated;
grant update (long_posts) on public.app_settings to authenticated;

-- ---------------------------------------------------------------------------
-- X credentials (single row). No policies and no grants: only the service
-- role used by edge functions can read it. The browser never sees the keys.
-- ---------------------------------------------------------------------------
create table public.x_credentials (
  id                   boolean primary key default true check (id),
  api_key              text not null,
  api_secret           text not null,
  access_token         text not null,
  access_token_secret  text not null,
  updated_at           timestamptz not null default now()
);

create trigger x_credentials_touch before update on public.x_credentials
  for each row execute function public.touch_updated_at();

alter table public.x_credentials enable row level security;
revoke all on public.x_credentials from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Claim due posts atomically so two publisher runs can never post twice.
-- Rows stuck in 'publishing' for 10+ minutes (a crashed run) become failed
-- instead of retrying blindly, because part of them may already be live.
-- ---------------------------------------------------------------------------
create or replace function public.claim_due_posts(max_posts integer default 5)
returns setof public.posts
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.posts
     set status = 'failed',
         error  = 'Publishing was interrupted. Check X before retrying, part of this may already be live.'
   where status = 'publishing'
     and updated_at < now() - interval '10 minutes';

  return query
  update public.posts p
     set status   = 'publishing',
         attempts = p.attempts + 1
   where p.id in (
     select id
       from public.posts
      where status = 'scheduled'
        and scheduled_at <= now()
      order by scheduled_at
      limit max_posts
      for update skip locked
   )
  returning p.*;
end;
$$;

revoke all on function public.claim_due_posts(integer) from public, anon, authenticated;
grant execute on function public.claim_due_posts(integer) to service_role;

-- Live updates in the dashboard
alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.app_settings;
