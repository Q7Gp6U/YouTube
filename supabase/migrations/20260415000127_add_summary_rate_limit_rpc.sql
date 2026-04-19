create table if not exists public.summary_rate_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null check (action in ('start', 'poll')),
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, action, window_started_at)
);

create index if not exists summary_rate_limits_user_updated_idx
on public.summary_rate_limits (user_id, updated_at desc);

drop trigger if exists set_summary_rate_limits_updated_at on public.summary_rate_limits;
create trigger set_summary_rate_limits_updated_at
before update on public.summary_rate_limits
for each row
execute function public.set_current_timestamp_updated_at();

revoke all on table public.summary_rate_limits from anon, authenticated;

create or replace function public.consume_summary_rate_limit(
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  retry_after_seconds integer,
  remaining integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_window_started_at timestamptz;
  v_window_ends_at timestamptz;
  v_request_count integer;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_action not in ('start', 'poll') then
    raise exception 'INVALID_ACTION';
  end if;

  if p_limit < 1 then
    raise exception 'INVALID_LIMIT';
  end if;

  if p_window_seconds < 1 then
    raise exception 'INVALID_WINDOW';
  end if;

  v_window_started_at := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);
  v_window_ends_at := v_window_started_at + make_interval(secs => p_window_seconds);

  insert into public.summary_rate_limits as summary_rate_limits (
    user_id,
    action,
    window_started_at,
    request_count
  )
  values (
    v_user_id,
    p_action,
    v_window_started_at,
    1
  )
  on conflict (user_id, action, window_started_at)
  do update
  set request_count = summary_rate_limits.request_count + 1,
      updated_at = timezone('utc', now())
  returning request_count into v_request_count;

  delete from public.summary_rate_limits
  where user_id = v_user_id
    and action = p_action
    and window_started_at < v_window_started_at - make_interval(secs => greatest(p_window_seconds * 2, 3600));

  if v_request_count > p_limit then
    return query
    select false, greatest(ceil(extract(epoch from v_window_ends_at - v_now))::integer, 1), 0;
    return;
  end if;

  return query
  select true, 0, greatest(p_limit - v_request_count, 0);
end;
$$;

grant execute on function public.consume_summary_rate_limit(text, integer, integer) to authenticated;
