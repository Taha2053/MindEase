-- 002: Add stable per-installation device ID, media asset references, and
-- fix ownership model so cloud accounts own data while local profiles use
-- a non-fingerprint installation ID generated once at first run.

-- learning_profiles: add installation_id for device-local linkage
alter table public.learning_profiles
  add column if not exists installation_id text;

-- Allow lookup by installation_id (non-unique; one account may have many installs)
create index if not exists idx_learning_profiles_installation_id
  on public.learning_profiles (installation_id)
  where installation_id is not null;

-- session_history: add installation_id
alter table public.session_history
  add column if not exists installation_id text;

-- ── Media assets: persisted visual + video references ──────────────────

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text,
  asset_type text not null check (asset_type in ('visual', 'video')),
  source text not null,                     -- 'napkin', 'manim', 'flux'
  concept text,                             -- concept label if visual
  format text not null,                     -- 'svg', 'png', 'mp4'
  storage_key text not null,                -- data URL for visuals, video path/URL for videos
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.media_assets enable row level security;

create policy "owners manage media assets" on public.media_assets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

revoke all on public.media_assets from anon;
grant select, insert, update, delete on public.media_assets to authenticated;

create index if not exists idx_media_assets_user_session
  on public.media_assets (user_id, session_id);
