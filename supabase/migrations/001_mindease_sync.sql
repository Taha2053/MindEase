create table if not exists public.learning_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.session_history (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sessions jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.session_feedback (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  feedback jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, session_id)
);

alter table public.learning_profiles enable row level security;
alter table public.session_history enable row level security;
alter table public.session_feedback enable row level security;

create policy "owners manage learning profiles" on public.learning_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owners manage session history" on public.session_history
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owners manage session feedback" on public.session_feedback
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

revoke all on public.learning_profiles from anon;
revoke all on public.session_history from anon;
revoke all on public.session_feedback from anon;
grant select, insert, update, delete on public.learning_profiles to authenticated;
grant select, insert, update, delete on public.session_history to authenticated;
grant select, insert, update, delete on public.session_feedback to authenticated;
