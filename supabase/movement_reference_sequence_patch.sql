create sequence if not exists public.movement_reference_number_seq;

alter table public.movements
  add column if not exists reference_number bigint;

alter table public.movements
  alter column reference_number set default nextval('public.movement_reference_number_seq');

with movement_ref_seed as (
  select coalesce(max(reference_number), 0) as max_ref
  from public.movements
),
movement_ref_backfill as (
  select
    m.id,
    (select max_ref from movement_ref_seed) + row_number() over (order by m.occurred_at asc, m.created_at asc, m.id asc) as next_ref
  from public.movements m
  where m.reference_number is null
)
update public.movements m
set reference_number = b.next_ref
from movement_ref_backfill b
where m.id = b.id;

select setval(
  'public.movement_reference_number_seq',
  coalesce((select max(reference_number) from public.movements), 0) + 1,
  false
);

alter table public.movements
  alter column reference_number set not null;

create unique index if not exists movements_reference_number_idx
  on public.movements (reference_number);
