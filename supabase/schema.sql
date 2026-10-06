-- ==============================================================================
-- MindEase: Complete Supabase Database Setup
-- Run this entire script in your Supabase SQL Editor (Dashboard -> SQL Editor).
-- It is completely idempotent (safe to run multiple times).
-- ==============================================================================

-- 1. Learning Profiles
create table if not exists public.learning_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb not null,
  installation_id text,
  updated_at timestamptz not null default now()
);

alter table public.learning_profiles add column if not exists installation_id text;
create index if not exists idx_learning_profiles_installation_id
  on public.learning_profiles (installation_id)
  where installation_id is not null;

-- 2. Session History
create table if not exists public.session_history (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sessions jsonb not null default '[]'::jsonb,
  deleted_ids text[] not null default '{}',
  installation_id text,
  updated_at timestamptz not null default now()
);

alter table public.session_history add column if not exists installation_id text;
alter table public.session_history add column if not exists deleted_ids text[] not null default '{}';

-- 3. Session Feedback
create table if not exists public.session_feedback (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  feedback jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, session_id)
);

-- 4. Media Assets (Visuals & Video references)
create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text,
  asset_type text not null check (asset_type in ('visual', 'video')),
  source text not null,
  concept text,
  format text not null,
  storage_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_media_assets_user_session
  on public.media_assets (user_id, session_id);

-- 5. Session Folders (Structured lesson archives: Date + Session Number / Videos, Visuals, History)
create table if not exists public.session_folders (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  folder_name text not null,
  summary jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, session_id)
);

create index if not exists idx_session_folders_user_date
  on public.session_folders (user_id, updated_at desc);

-- ==============================================================================
-- Row Level Security (RLS) & Policies
-- Ensures users can ONLY read and write their own data.
-- ==============================================================================

alter table public.learning_profiles enable row level security;
alter table public.session_history enable row level security;
alter table public.session_feedback enable row level security;
alter table public.media_assets enable row level security;
alter table public.session_folders enable row level security;

-- Drop existing policies first to allow clean idempotent re-runs
drop policy if exists "owners manage learning profiles" on public.learning_profiles;
create policy "owners manage learning profiles" on public.learning_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owners manage session history" on public.session_history;
create policy "owners manage session history" on public.session_history
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owners manage session feedback" on public.session_feedback;
create policy "owners manage session feedback" on public.session_feedback
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owners manage media assets" on public.media_assets;
create policy "owners manage media assets" on public.media_assets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owners manage session folders" on public.session_folders;
create policy "owners manage session folders" on public.session_folders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Grants
revoke all on public.learning_profiles from anon;
revoke all on public.session_history from anon;
revoke all on public.session_feedback from anon;
revoke all on public.media_assets from anon;
revoke all on public.session_folders from anon;

grant select, insert, update, delete on public.learning_profiles to authenticated;
grant select, insert, update, delete on public.session_history to authenticated;
grant select, insert, update, delete on public.session_feedback to authenticated;
grant select, insert, update, delete on public.media_assets to authenticated;
grant select, insert, update, delete on public.session_folders to authenticated;

-- ==============================================================================
-- RPC Functions
-- ==============================================================================

create or replace function public.sync_session_history(
  p_sessions jsonb default '[]'::jsonb,
  p_deleted_ids text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id pg_catalog.uuid;
  v_existing_sessions jsonb;
  v_existing_deleted_ids text[];
  v_merged_deleted_ids text[];
  v_merged_sessions jsonb;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Ensure row exists for caller under RLS
  insert into public.session_history (user_id, sessions, deleted_ids, updated_at)
  values (v_user_id, '[]'::jsonb, coalesce(p_deleted_ids, '{}'::text[]), pg_catalog.now())
  on conflict (user_id) do nothing;

  -- Select and lock existing sessions and deleted ids
  select sessions, deleted_ids
  into v_existing_sessions, v_existing_deleted_ids
  from public.session_history
  where user_id = v_user_id
  for update;

  -- Union deletion ids and remove nulls/blanks
  select coalesce(pg_catalog.array_agg(distinct elem), '{}'::text[])
  into v_merged_deleted_ids
  from pg_catalog.unnest(
    pg_catalog.array_cat(
      coalesce(v_existing_deleted_ids, '{}'::text[]),
      coalesce(p_deleted_ids, '{}'::text[])
    )
  ) as elem
  where elem is not null and elem <> '';

  -- Merge sessions: union by sessionId, last local wins (priority 2 > 1),
  -- exclude tombstones, order endTime desc limit 100
  with combined as (
    select value as session_obj, 2 as priority, ord
    from pg_catalog.jsonb_array_elements(
      case
        when pg_catalog.jsonb_typeof(p_sessions) = 'array' then p_sessions
        else '[]'::jsonb
      end
    ) with ordinality as t(value, ord)
    where (value->>'sessionId') is not null
      and not ((value->>'sessionId') = any(v_merged_deleted_ids))
    union all
    select value as session_obj, 1 as priority, ord
    from pg_catalog.jsonb_array_elements(
      case
        when pg_catalog.jsonb_typeof(v_existing_sessions) = 'array' then v_existing_sessions
        else '[]'::jsonb
      end
    ) with ordinality as t(value, ord)
    where (value->>'sessionId') is not null
      and not ((value->>'sessionId') = any(v_merged_deleted_ids))
  ),
  deduped as (
    select distinct on (session_obj->>'sessionId') session_obj
    from combined
    order by (session_obj->>'sessionId'), priority desc, ord desc
  ),
  limited as (
    select session_obj
    from deduped
    order by (
      case
        when (session_obj->>'endTime') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (session_obj->>'endTime')::numeric
        else 0
      end
    ) desc
    limit 100
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      session_obj
      order by (
        case
          when (session_obj->>'endTime') ~ '^-?[0-9]+(\.[0-9]+)?$'
          then (session_obj->>'endTime')::numeric
          else 0
        end
      ) desc
    ),
    '[]'::jsonb
  )
  into v_merged_sessions
  from limited;

  -- Update row with merged sessions, tombstones, and timestamp
  update public.session_history
  set sessions = v_merged_sessions,
      deleted_ids = v_merged_deleted_ids,
      updated_at = pg_catalog.now()
  where user_id = v_user_id;

  return v_merged_sessions;
end;
$$;

revoke all on function public.sync_session_history(jsonb, text[]) from public;
revoke all on function public.sync_session_history(jsonb, text[]) from anon;
grant execute on function public.sync_session_history(jsonb, text[]) to authenticated;
