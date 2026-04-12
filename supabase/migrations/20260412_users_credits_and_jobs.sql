create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  credits_balance integer not null default 0 check (credits_balance >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.summary_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  original_url text not null,
  normalized_url text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  provider_job_id text,
  video_title text,
  summary text,
  model text,
  transcript_language text,
  essence_frame jsonb,
  error_message text,
  credits_reserved integer not null default 1 check (credits_reserved in (0, 1)),
  refunded_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  summary_job_id uuid references public.summary_jobs (id) on delete set null,
  amount integer not null,
  transaction_type text not null check (transaction_type in ('signup_bonus', 'summary_debit', 'summary_refund')),
  description text,
  metadata jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists profiles_email_idx on public.profiles (email);
create index if not exists summary_jobs_user_created_idx on public.summary_jobs (user_id, created_at desc);
create index if not exists summary_jobs_user_status_idx on public.summary_jobs (user_id, status, created_at desc);
create unique index if not exists summary_jobs_provider_job_id_uidx on public.summary_jobs (provider_job_id) where provider_job_id is not null;
create index if not exists credit_transactions_user_created_idx on public.credit_transactions (user_id, created_at desc);
create index if not exists credit_transactions_job_idx on public.credit_transactions (summary_job_id);

create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_current_timestamp_updated_at();

drop trigger if exists set_summary_jobs_updated_at on public.summary_jobs;
create trigger set_summary_jobs_updated_at
before update on public.summary_jobs
for each row
execute function public.set_current_timestamp_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, credits_balance)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    5
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(excluded.full_name, public.profiles.full_name);

  insert into public.credit_transactions (user_id, amount, transaction_type, description, metadata)
  values (
    new.id,
    5,
    'signup_bonus',
    'Стартовые кредиты после регистрации',
    jsonb_build_object('source', 'auth_trigger')
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

create or replace function public.create_summary_job(
  p_original_url text,
  p_normalized_url text
)
returns table (
  job_id uuid,
  job_status text,
  provider_job_id text,
  video_title text,
  credits_remaining integer,
  was_created boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_existing_job public.summary_jobs%rowtype;
  v_created_job public.summary_jobs%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = v_user_id
  for update;

  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  select *
  into v_existing_job
  from public.summary_jobs
  where user_id = v_user_id
    and normalized_url = p_normalized_url
    and status in ('pending', 'processing')
  order by created_at desc
  limit 1
  for update;

  if found then
    return query
    select
      v_existing_job.id,
      v_existing_job.status,
      v_existing_job.provider_job_id,
      v_existing_job.video_title,
      v_profile.credits_balance,
      false;
    return;
  end if;

  if v_profile.credits_balance < 1 then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  update public.profiles
  set credits_balance = credits_balance - 1
  where id = v_user_id;

  insert into public.summary_jobs (
    user_id,
    original_url,
    normalized_url,
    status,
    credits_reserved
  )
  values (
    v_user_id,
    p_original_url,
    p_normalized_url,
    'pending',
    1
  )
  returning * into v_created_job;

  insert into public.credit_transactions (
    user_id,
    summary_job_id,
    amount,
    transaction_type,
    description,
    metadata
  )
  values (
    v_user_id,
    v_created_job.id,
    -1,
    'summary_debit',
    'Списание кредита за запуск обработки видео',
    jsonb_build_object('normalized_url', p_normalized_url)
  );

  return query
  select
    v_created_job.id,
    v_created_job.status,
    v_created_job.provider_job_id,
    v_created_job.video_title,
    v_profile.credits_balance - 1,
    true;
end;
$$;

create or replace function public.mark_summary_job_processing(
  p_job_id uuid,
  p_provider_job_id text,
  p_video_title text default null
)
returns table (
  job_id uuid,
  status text,
  video_title text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_job public.summary_jobs%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
  into v_job
  from public.summary_jobs
  where id = p_job_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'JOB_NOT_FOUND';
  end if;

  if v_job.status = 'completed' then
    return query select v_job.id, v_job.status, v_job.video_title;
    return;
  end if;

  update public.summary_jobs
  set status = 'processing',
      provider_job_id = coalesce(public.summary_jobs.provider_job_id, p_provider_job_id),
      video_title = coalesce(nullif(trim(p_video_title), ''), public.summary_jobs.video_title),
      error_message = null
  where id = p_job_id
  returning public.summary_jobs.id, public.summary_jobs.status, public.summary_jobs.video_title
  into v_job.id, v_job.status, v_job.video_title;

  return query select v_job.id, v_job.status, v_job.video_title;
end;
$$;

create or replace function public.complete_summary_job(
  p_job_id uuid,
  p_video_title text,
  p_summary text,
  p_model text,
  p_transcript_language text default null,
  p_essence_frame jsonb default null
)
returns table (
  job_id uuid,
  status text,
  credits_remaining integer
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_balance integer;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  perform 1
  from public.summary_jobs
  where id = p_job_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'JOB_NOT_FOUND';
  end if;

  update public.summary_jobs
  set status = 'completed',
      video_title = p_video_title,
      summary = p_summary,
      model = p_model,
      transcript_language = nullif(trim(coalesce(p_transcript_language, '')), ''),
      essence_frame = p_essence_frame,
      error_message = null,
      credits_reserved = 0,
      completed_at = coalesce(public.summary_jobs.completed_at, timezone('utc', now()))
  where id = p_job_id;

  select credits_balance into v_balance from public.profiles where id = v_user_id;

  return query select p_job_id, 'completed', coalesce(v_balance, 0);
end;
$$;

create or replace function public.fail_summary_job(
  p_job_id uuid,
  p_error_message text,
  p_refund_credit boolean default true
)
returns table (
  job_id uuid,
  status text,
  credits_remaining integer,
  refunded boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_job public.summary_jobs%rowtype;
  v_refunded boolean := false;
  v_balance integer;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
  into v_job
  from public.summary_jobs
  where id = p_job_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'JOB_NOT_FOUND';
  end if;

  if p_refund_credit and v_job.credits_reserved = 1 then
    update public.profiles
    set credits_balance = credits_balance + 1
    where id = v_user_id
    returning credits_balance into v_balance;

    insert into public.credit_transactions (
      user_id,
      summary_job_id,
      amount,
      transaction_type,
      description,
      metadata
    )
    values (
      v_user_id,
      p_job_id,
      1,
      'summary_refund',
      'Возврат кредита после неуспешной обработки видео',
      jsonb_build_object('reason', p_error_message)
    );

    v_refunded := true;
  end if;

  update public.summary_jobs
  set status = 'failed',
      error_message = p_error_message,
      credits_reserved = 0,
      refunded_at = case when p_refund_credit and v_refunded then coalesce(public.summary_jobs.refunded_at, timezone('utc', now())) else public.summary_jobs.refunded_at end
  where id = p_job_id;

  if v_balance is null then
    select credits_balance into v_balance from public.profiles where id = v_user_id;
  end if;

  return query select p_job_id, 'failed', coalesce(v_balance, 0), v_refunded;
end;
$$;

alter table public.profiles enable row level security;
alter table public.summary_jobs enable row level security;
alter table public.credit_transactions enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "summary_jobs_select_own" on public.summary_jobs;
create policy "summary_jobs_select_own"
on public.summary_jobs
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "summary_jobs_insert_own" on public.summary_jobs;
create policy "summary_jobs_insert_own"
on public.summary_jobs
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "summary_jobs_update_own" on public.summary_jobs;
create policy "summary_jobs_update_own"
on public.summary_jobs
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "credit_transactions_insert_own" on public.credit_transactions;
create policy "credit_transactions_insert_own"
on public.credit_transactions
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "credit_transactions_select_own" on public.credit_transactions;
create policy "credit_transactions_select_own"
on public.credit_transactions
for select
to authenticated
using (auth.uid() = user_id);

revoke all on function public.handle_new_user() from public;
grant execute on function public.create_summary_job(text, text) to authenticated;
grant execute on function public.mark_summary_job_processing(uuid, text, text) to authenticated;
grant execute on function public.complete_summary_job(uuid, text, text, text, text, jsonb) to authenticated;
grant execute on function public.fail_summary_job(uuid, text, boolean) to authenticated;
