create table if not exists public.demo_two_columns (
  name text primary key,
  value integer not null
);

insert into public.demo_two_columns (name, value)
values
  ('row_1', 1),
  ('row_2', 2),
  ('row_3', 3),
  ('row_4', 4),
  ('row_5', 5),
  ('row_6', 6),
  ('row_7', 7),
  ('row_8', 8),
  ('row_9', 9),
  ('row_10', 10)
on conflict (name) do update
set value = excluded.value;
