-- 004: Atomic account-owned session history merge with persistent deletion tombstones
-- Adds deleted_ids column to session_history and RPC function sync_session_history

alter table public.session_history
  add column if not exists deleted_ids text[] not null default '{}';

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
