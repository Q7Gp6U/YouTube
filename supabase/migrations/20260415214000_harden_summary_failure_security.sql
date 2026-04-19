alter table public.summary_jobs
  add column if not exists refund_eligible boolean not null default true,
  add column if not exists cost_committed_at timestamptz,
  add column if not exists internal_error_message text;

update public.summary_jobs
set refund_eligible = false,
    cost_committed_at = coalesce(
      cost_committed_at,
      completed_at,
      case when provider_job_id is not null then updated_at else null end
    )
where provider_job_id is not null
   or status in ('completed', 'failed')
   or credits_reserved = 0;

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
security definer
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
      error_message = null,
      internal_error_message = null,
      refund_eligible = false,
      cost_committed_at = coalesce(public.summary_jobs.cost_committed_at, timezone('utc', now()))
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
security definer
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
      internal_error_message = null,
      credits_reserved = 0,
      refund_eligible = false,
      cost_committed_at = coalesce(public.summary_jobs.cost_committed_at, timezone('utc', now())),
      completed_at = coalesce(public.summary_jobs.completed_at, timezone('utc', now()))
  where id = p_job_id;

  select credits_balance into v_balance from public.profiles where id = v_user_id;

  return query select p_job_id, 'completed', coalesce(v_balance, 0);
end;
$$;

drop function if exists public.fail_summary_job(uuid, text, boolean);

create function public.fail_summary_job(
  p_job_id uuid,
  p_public_error_message text,
  p_refund_credit boolean default true,
  p_internal_error_message text default null
)
returns table (
  job_id uuid,
  status text,
  credits_remaining integer,
  refunded boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_job public.summary_jobs%rowtype;
  v_refunded boolean := false;
  v_balance integer;
  v_should_refund boolean := false;
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

  v_should_refund := p_refund_credit and v_job.credits_reserved = 1 and v_job.refund_eligible;

  if v_should_refund then
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
      jsonb_build_object('reason', p_public_error_message)
    );

    v_refunded := true;
  end if;

  update public.summary_jobs
  set status = 'failed',
      error_message = p_public_error_message,
      internal_error_message = nullif(trim(coalesce(p_internal_error_message, '')), ''),
      credits_reserved = 0,
      refund_eligible = false,
      refunded_at = case when v_refunded then coalesce(public.summary_jobs.refunded_at, timezone('utc', now())) else public.summary_jobs.refunded_at end
  where id = p_job_id;

  if v_balance is null then
    select credits_balance into v_balance from public.profiles where id = v_user_id;
  end if;

  return query select p_job_id, 'failed', coalesce(v_balance, 0), v_refunded;
end;
$$;

grant execute on function public.mark_summary_job_processing(uuid, text, text) to authenticated;
grant execute on function public.complete_summary_job(uuid, text, text, text, text, jsonb) to authenticated;
grant execute on function public.fail_summary_job(uuid, text, boolean, text) to authenticated;
