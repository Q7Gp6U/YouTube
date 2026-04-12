do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'credit_transactions_transaction_type_check'
      and conrelid = 'public.credit_transactions'::regclass
  ) then
    alter table public.credit_transactions
      drop constraint credit_transactions_transaction_type_check;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'credit_transactions_transaction_type_check'
      and conrelid = 'public.credit_transactions'::regclass
  ) then
    alter table public.credit_transactions
      add constraint credit_transactions_transaction_type_check
      check (transaction_type in ('signup_bonus', 'summary_debit', 'summary_refund', 'migration_adjustment'));
  end if;
end;
$$;

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
    10
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(excluded.full_name, public.profiles.full_name);

  insert into public.credit_transactions (user_id, amount, transaction_type, description, metadata)
  values (
    new.id,
    10,
    'signup_bonus',
    'Стартовые кредиты после регистрации',
    jsonb_build_object('source', 'auth_trigger', 'startup_credits', 10)
  );

  return new;
end;
$$;

with balances_to_adjust as (
  select
    p.id as user_id,
    10 - p.credits_balance as amount_delta
  from public.profiles as p
  where p.credits_balance <> 10
    and not exists (
      select 1
      from public.credit_transactions as ct
      where ct.user_id = p.id
        and ct.transaction_type = 'migration_adjustment'
        and ct.metadata ->> 'migration_key' = 'startup_credits_10_backfill_v1'
    )
),
inserted_adjustments as (
  insert into public.credit_transactions (
    user_id,
    amount,
    transaction_type,
    description,
    metadata
  )
  select
    b.user_id,
    b.amount_delta,
    'migration_adjustment',
    'Компенсационная корректировка стартового баланса до 10 кредитов',
    jsonb_build_object(
      'migration_key', 'startup_credits_10_backfill_v1',
      'target_balance', 10,
      'applied_from_balance', 10 - b.amount_delta
    )
  from balances_to_adjust as b
  returning user_id, amount
)
update public.profiles as p
set credits_balance = p.credits_balance + ia.amount
from inserted_adjustments as ia
where p.id = ia.user_id;
