-- 003: Session folders cloud archive table
-- Stores structured lesson packages (date, session number, videos, visuals, and summary)
-- when the user chooses Supabase as their storage destination.

create table if not exists public.session_folders (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  folder_name text not null,
  summary jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, session_id)
);

alter table public.session_folders enable row level security;

create policy "owners manage session folders" on public.session_folders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

revoke all on public.session_folders from anon;
grant select, insert, update, delete on public.session_folders to authenticated;

create index if not exists idx_session_folders_user_date
  on public.session_folders (user_id, updated_at desc);
