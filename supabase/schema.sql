-- Produce Inventory (Kardex) schema for Supabase/Postgres.
-- Goal: immutable movement ledger + proof attachments, inventory always computed from deltas (kg).

create extension if not exists pgcrypto;
create extension if not exists citext;

do $$
begin
  create type public.movement_type as enum (
    'entrada',
    'venta',
    'merma',
    'traspaso_sku',
    'traspaso_calidad',
    'ajuste'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter type public.movement_type add value if not exists 'traspaso_sku';
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.price_model as enum ('per_kg', 'per_box');
exception
  when duplicate_object then null;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Master data (owned by the signed-in user)
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name citext not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);

drop trigger if exists trg_products_set_updated_at on public.products;
create trigger trg_products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create table if not exists public.qualities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name citext not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);

drop trigger if exists trg_qualities_set_updated_at on public.qualities;
create trigger trg_qualities_set_updated_at
before update on public.qualities
for each row execute function public.set_updated_at();

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name citext not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);

drop trigger if exists trg_employees_set_updated_at on public.employees;
create trigger trg_employees_set_updated_at
before update on public.employees
for each row execute function public.set_updated_at();

-- SKUs: user-facing codes/presentations that map to a base (product, quality).
-- This allows multiple SKUs (e.g., "Papaya 2da KG" and "Papaya 2da Caja") to share the same inventory bucket.
create table if not exists public.skus (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code integer not null,
  name text not null,
  product_id uuid not null references public.products(id),
  quality_id uuid not null references public.qualities(id),
  default_price_model public.price_model,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, code),
  unique (owner_id, name)
);

create index if not exists skus_owner_code_idx
  on public.skus (owner_id, code);

drop trigger if exists trg_skus_set_updated_at on public.skus;
create trigger trg_skus_set_updated_at
before update on public.skus
for each row execute function public.set_updated_at();

-- Movements (immutable; corrections should be new movements of type "ajuste")
create table if not exists public.movements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  movement_type public.movement_type not null,
  occurred_at timestamptz not null default now(),
  notes text,
  currency text not null default 'MXN',
  reported_by_employee_id uuid references public.employees(id),
  -- For traspaso_sku (presentation transfer), store direction explicitly for UI/reporting.
  from_sku_id uuid references public.skus(id),
  to_sku_id uuid references public.skus(id),
  -- For traspaso_calidad, store direction explicitly for reporting/UI.
  from_quality_id uuid references public.qualities(id),
  to_quality_id uuid references public.qualities(id),
  -- Optional link for adjustments/corrections
  reference_movement_id uuid references public.movements(id),
  created_at timestamptz not null default now(),
  constraint traspaso_sku_valid check (
    (
      movement_type <> 'traspaso_sku'
      and from_sku_id is null
      and to_sku_id is null
    )
    or (
      movement_type = 'traspaso_sku'
      and from_sku_id is not null
      and to_sku_id is not null
      and from_sku_id <> to_sku_id
    )
  ),
  constraint traspaso_qualities_valid check (
    (
      movement_type <> 'traspaso_calidad'
      and from_quality_id is null
      and to_quality_id is null
    )
    or (
      movement_type = 'traspaso_calidad'
      and from_quality_id is not null
      and to_quality_id is not null
      and from_quality_id <> to_quality_id
    )
  )
);

alter table public.movements
  add column if not exists reported_by_employee_id uuid references public.employees(id);

alter table public.movements
  add column if not exists from_sku_id uuid references public.skus(id);

alter table public.movements
  add column if not exists to_sku_id uuid references public.skus(id);

create index if not exists movements_owner_occurred_idx
  on public.movements (owner_id, occurred_at desc);

create index if not exists movements_owner_type_occurred_idx
  on public.movements (owner_id, movement_type, occurred_at desc);

-- Signed inventory deltas. For most movement types:
-- - entrada: delta_weight_kg > 0
-- - venta/merma: delta_weight_kg < 0
-- - ajuste: either
-- - traspaso_calidad: create TWO lines per product (negative from_quality, positive to_quality)
create table if not exists public.movement_lines (
  id uuid primary key default gen_random_uuid(),
  movement_id uuid not null references public.movements(id) on delete cascade,
  sku_id uuid references public.skus(id),
  product_id uuid not null references public.products(id),
  quality_id uuid not null references public.qualities(id),
  delta_weight_kg numeric(12, 3) not null,
  boxes integer,
  price_model public.price_model,
  unit_price numeric(12, 2),
  line_total numeric(12, 2),
  created_at timestamptz not null default now(),
  constraint delta_weight_nonzero check (delta_weight_kg <> 0),
  constraint boxes_nonnegative check (boxes is null or boxes >= 0),
  constraint unit_price_nonnegative check (unit_price is null or unit_price >= 0),
  constraint line_total_nonnegative check (line_total is null or line_total >= 0)
);

alter table public.movement_lines
  add column if not exists sku_id uuid references public.skus(id);

create index if not exists movement_lines_movement_id_idx
  on public.movement_lines (movement_id);

create index if not exists movement_lines_product_quality_idx
  on public.movement_lines (product_id, quality_id);

create index if not exists movement_lines_sku_id_idx
  on public.movement_lines (sku_id);

-- Proof attachments (stored in Supabase Storage)
create table if not exists public.movement_attachments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  movement_id uuid not null references public.movements(id) on delete cascade,
  storage_bucket text not null default 'movement-proofs',
  storage_path text not null,
  original_filename text,
  content_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create index if not exists movement_attachments_movement_id_idx
  on public.movement_attachments (movement_id);

-- Views
create or replace view public.inventory_on_hand
with (security_invoker = true)
as
select
  p.id as product_id,
  p.name::text as product_name,
  q.id as quality_id,
  q.name::text as quality_name,
  sum(ml.delta_weight_kg) as on_hand_kg
from public.movement_lines ml
join public.movements m on m.id = ml.movement_id
join public.products p on p.id = ml.product_id
join public.qualities q on q.id = ml.quality_id
group by p.id, p.name, q.id, q.name;

-- Atomic insert for a movement + lines + attachments metadata.
-- Upload the files to Storage first, then call this RPC with the resulting paths.
create or replace function public.create_movement_with_lines(
  movement jsonb,
  lines jsonb,
  attachments jsonb
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_movement_id uuid;
  v_employee_id uuid;
  v_mt public.movement_type;
  v_from_sku_id uuid;
  v_to_sku_id uuid;
  v_from_sku_code integer;
  v_to_sku_code integer;
  v_from_product_id uuid;
  v_from_quality_id uuid;
  v_to_product_id uuid;
  v_to_quality_id uuid;
  v_sum_delta numeric;
  v_sum_from numeric;
  v_sum_to numeric;
begin
  if movement is null or jsonb_typeof(movement) <> 'object' then
    raise exception 'movement_required';
  end if;

  if lines is null or jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) < 1 then
    raise exception 'lines_required';
  end if;

  if attachments is null then
    attachments := '[]'::jsonb;
  end if;
  if jsonb_typeof(attachments) <> 'array' then
    raise exception 'attachments_invalid';
  end if;

  v_movement_id := coalesce(nullif(movement->>'id', '')::uuid, gen_random_uuid());
  v_employee_id := nullif(movement->>'reported_by_employee_id', '')::uuid;
  v_mt := (movement->>'movement_type')::public.movement_type;

  v_from_sku_id := nullif(movement->>'from_sku_id', '')::uuid;
  v_to_sku_id := nullif(movement->>'to_sku_id', '')::uuid;

  if v_employee_id is not null and not exists (
    select 1 from public.employees e where e.id = v_employee_id and e.owner_id = auth.uid()
  ) then
    raise exception 'employee_invalid';
  end if;

  -- Validate traspaso_sku rules.
  if v_mt = 'traspaso_sku' then
    if v_from_sku_id is null or v_to_sku_id is null or v_from_sku_id = v_to_sku_id then
      raise exception 'traspaso_sku_requires_from_to';
    end if;

    select s.code, s.product_id, s.quality_id
      into v_from_sku_code, v_from_product_id, v_from_quality_id
    from public.skus s
    where s.id = v_from_sku_id
      and s.owner_id = auth.uid();
    if not found then
      raise exception 'from_sku_invalid';
    end if;

    select s.code, s.product_id, s.quality_id
      into v_to_sku_code, v_to_product_id, v_to_quality_id
    from public.skus s
    where s.id = v_to_sku_id
      and s.owner_id = auth.uid();
    if not found then
      raise exception 'to_sku_invalid';
    end if;

    -- SKU 104 (Rancho) rule: can only receive inventory from 102/103 and can never be a source.
    if v_from_sku_code = 104 then
      raise exception 'rancho_cannot_be_source';
    end if;
    if v_to_sku_code = 104 and v_from_sku_code not in (102, 103) then
      raise exception 'rancho_source_invalid';
    end if;

    select coalesce(sum((l->>'delta_weight_kg')::numeric), 0)
      into v_sum_delta
    from jsonb_array_elements(lines) as l;

    -- Must net to zero at (product,quality) level.
    if v_sum_delta <> 0 then
      raise exception 'traspaso_sku_not_balanced';
    end if;

    -- Line-level validation.
    if exists (
      select 1
      from jsonb_array_elements(lines) as l
      where (
        nullif(l->>'sku_id', '')::uuid is distinct from v_from_sku_id
        and nullif(l->>'sku_id', '')::uuid is distinct from v_to_sku_id
      )
      or (
        nullif(l->>'sku_id', '')::uuid = v_from_sku_id
        and (
          (l->>'product_id')::uuid <> v_from_product_id
          or (l->>'quality_id')::uuid <> v_from_quality_id
        )
      )
      or (
        nullif(l->>'sku_id', '')::uuid = v_to_sku_id
        and (
          (l->>'product_id')::uuid <> v_to_product_id
          or (l->>'quality_id')::uuid <> v_to_quality_id
        )
      )
    ) then
      raise exception 'traspaso_sku_lines_invalid';
    end if;

    -- Enforce direction: from SKU must be negative, to SKU must be positive, and both must appear.
    if not exists (
      select 1
      from jsonb_array_elements(lines) as l
      where nullif(l->>'sku_id', '')::uuid = v_from_sku_id
    ) then
      raise exception 'traspaso_sku_missing_from_lines';
    end if;

    if not exists (
      select 1
      from jsonb_array_elements(lines) as l
      where nullif(l->>'sku_id', '')::uuid = v_to_sku_id
    ) then
      raise exception 'traspaso_sku_missing_to_lines';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(lines) as l
      where nullif(l->>'sku_id', '')::uuid = v_from_sku_id
        and (l->>'delta_weight_kg')::numeric > 0
    ) then
      raise exception 'traspaso_sku_from_must_be_negative';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(lines) as l
      where nullif(l->>'sku_id', '')::uuid = v_to_sku_id
        and (l->>'delta_weight_kg')::numeric < 0
    ) then
      raise exception 'traspaso_sku_to_must_be_positive';
    end if;

    select coalesce(sum((l->>'delta_weight_kg')::numeric), 0)
      into v_sum_from
    from jsonb_array_elements(lines) as l
    where nullif(l->>'sku_id', '')::uuid = v_from_sku_id;

    select coalesce(sum((l->>'delta_weight_kg')::numeric), 0)
      into v_sum_to
    from jsonb_array_elements(lines) as l
    where nullif(l->>'sku_id', '')::uuid = v_to_sku_id;

    if v_sum_from <> -v_sum_to then
      raise exception 'traspaso_sku_not_balanced_by_sku';
    end if;

  else
    -- Non-traspaso_sku movements must not set from/to SKU.
    if v_from_sku_id is not null or v_to_sku_id is not null then
      raise exception 'from_to_sku_not_allowed';
    end if;
  end if;

  insert into public.movements (
    id,
    movement_type,
    occurred_at,
    notes,
    currency,
    reported_by_employee_id,
    from_sku_id,
    to_sku_id,
    from_quality_id,
    to_quality_id,
    reference_movement_id
  ) values (
    v_movement_id,
    v_mt,
    coalesce(nullif(movement->>'occurred_at', '')::timestamptz, now()),
    nullif(movement->>'notes', ''),
    coalesce(nullif(movement->>'currency', ''), 'MXN'),
    v_employee_id,
    v_from_sku_id,
    v_to_sku_id,
    nullif(movement->>'from_quality_id', '')::uuid,
    nullif(movement->>'to_quality_id', '')::uuid,
    nullif(movement->>'reference_movement_id', '')::uuid
  );

  insert into public.movement_lines (
    movement_id,
    sku_id,
    product_id,
    quality_id,
    delta_weight_kg,
    boxes,
    price_model,
    unit_price,
    line_total
  )
  select
    v_movement_id,
    nullif(l->>'sku_id', '')::uuid,
    (l->>'product_id')::uuid,
    (l->>'quality_id')::uuid,
    (l->>'delta_weight_kg')::numeric,
    nullif(l->>'boxes', '')::integer,
    nullif(l->>'price_model', '')::public.price_model,
    nullif(l->>'unit_price', '')::numeric,
    nullif(l->>'line_total', '')::numeric
  from jsonb_array_elements(lines) as l;

  if jsonb_array_length(attachments) > 0 then
    insert into public.movement_attachments (
      movement_id,
      storage_bucket,
      storage_path,
      original_filename,
      content_type,
      size_bytes
    )
    select
      v_movement_id,
      coalesce(nullif(a->>'storage_bucket', ''), 'movement-proofs'),
      (a->>'storage_path'),
      nullif(a->>'original_filename', ''),
      nullif(a->>'content_type', ''),
      nullif(a->>'size_bytes', '')::bigint
    from jsonb_array_elements(attachments) as a;
  end if;

  return v_movement_id;
end;
$$;

revoke all on function public.create_movement_with_lines(jsonb, jsonb, jsonb) from public;
grant execute on function public.create_movement_with_lines(jsonb, jsonb, jsonb) to authenticated;

-- Delete/cancel a movement (manager-only usage; still enforced by RLS owner_id).
-- Note: Storage objects must be deleted separately via the client (we return no paths here).
create or replace function public.delete_movement(movement_id uuid)
returns void
language plpgsql
security invoker
as $$
begin
  if movement_id is null then
    raise exception 'movement_id_required';
  end if;

  if not exists (
    select 1 from public.movements m where m.id = movement_id and m.owner_id = auth.uid()
  ) then
    raise exception 'movement_not_found';
  end if;

  -- Delete children first to avoid any ON DELETE CASCADE + RLS edge cases.
  delete from public.movement_lines ml where ml.movement_id = movement_id;
  delete from public.movement_attachments ma where ma.movement_id = movement_id;
  delete from public.movements m where m.id = movement_id;
end;
$$;

revoke all on function public.delete_movement(uuid) from public;
grant execute on function public.delete_movement(uuid) to authenticated;

-- One-time bootstrap to create your base products/qualities + starter SKUs.
create or replace function public.bootstrap_defaults()
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_owner uuid;
  v_papaya uuid;
  v_sandia_ss uuid;
  v_sandia_cs uuid;
  v_jicama uuid;
  v_jicama_jumbo uuid;
  v_pina uuid;
  v_q_1ra uuid;
  v_q_2da uuid;
  v_q_1ra_grande uuid;
  v_q_1ra_chica uuid;
begin
  v_owner := auth.uid();
  if v_owner is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.qualities (name, sort_order)
  values
    ('1ra', 10),
    ('2da', 20),
    ('1ra Grande', 11),
    ('1ra Chica', 12)
  on conflict (owner_id, name) do nothing;

  insert into public.products (name)
  values
    ('Papaya'),
    ('Sandia Sin Semilla'),
    ('Sandia Con Semilla'),
    ('Jicama'),
    ('Jicama Jumbo'),
    ('Pina')
  on conflict (owner_id, name) do nothing;

  select id into v_papaya from public.products where owner_id = v_owner and name = 'Papaya';
  select id into v_sandia_ss from public.products where owner_id = v_owner and name = 'Sandia Sin Semilla';
  select id into v_sandia_cs from public.products where owner_id = v_owner and name = 'Sandia Con Semilla';
  select id into v_jicama from public.products where owner_id = v_owner and name = 'Jicama';
  select id into v_jicama_jumbo from public.products where owner_id = v_owner and name = 'Jicama Jumbo';
  select id into v_pina from public.products where owner_id = v_owner and name = 'Pina';

  select id into v_q_1ra from public.qualities where owner_id = v_owner and name = '1ra';
  select id into v_q_2da from public.qualities where owner_id = v_owner and name = '2da';
  select id into v_q_1ra_grande from public.qualities where owner_id = v_owner and name = '1ra Grande';
  select id into v_q_1ra_chica from public.qualities where owner_id = v_owner and name = '1ra Chica';

  -- Starter SKU list (edit later in the UI).
  insert into public.skus (code, name, product_id, quality_id, default_price_model)
  values
    (100, 'Papaya 1ra Grande KG', v_papaya, v_q_1ra_grande, 'per_kg'),
    (101, 'Papaya 1ra Chica KG', v_papaya, v_q_1ra_chica, 'per_kg'),
    (102, 'Papaya 2da KG', v_papaya, v_q_2da, 'per_kg'),
    (103, 'Papaya 2da Caja', v_papaya, v_q_2da, 'per_box'),
    (104, 'Rancho de Papaya Caja', v_papaya, v_q_2da, 'per_box'),
    (106, 'Papaya 1ra Chica Caja', v_papaya, v_q_1ra_chica, 'per_box'),

    (200, 'Sandia Sin Semilla 1ra KG', v_sandia_ss, v_q_1ra, 'per_kg'),
    (201, 'Sandia Con Semilla 1ra KG', v_sandia_cs, v_q_1ra, 'per_kg'),
    (202, 'Sandia Sin Semilla 2da KG', v_sandia_ss, v_q_2da, 'per_kg'),
    (203, 'Sandia Con Semilla 2da KG', v_sandia_cs, v_q_2da, 'per_kg'),

    (300, 'Jicama 1ra KG', v_jicama, v_q_1ra, 'per_kg'),
    (301, 'Jicama 1ra Caja', v_jicama, v_q_1ra, 'per_box'),
    (302, 'Jicama 2da KG', v_jicama, v_q_2da, 'per_kg'),
    (312, 'Jicama Jumbo 1ra KG', v_jicama_jumbo, v_q_1ra, 'per_kg'),

    (724, 'Pina 1ra KG', v_pina, v_q_1ra, 'per_kg'),
    (725, 'Pina 2da KG', v_pina, v_q_2da, 'per_kg')
  on conflict (owner_id, code) do nothing;

  return jsonb_build_object(
    'ok', true
  );
end;
$$;

revoke all on function public.bootstrap_defaults() from public;
grant execute on function public.bootstrap_defaults() to authenticated;

-- RLS
alter table public.products enable row level security;
alter table public.qualities enable row level security;
alter table public.employees enable row level security;
alter table public.skus enable row level security;
alter table public.movements enable row level security;
alter table public.movement_lines enable row level security;
alter table public.movement_attachments enable row level security;

-- products: allow owner to manage (update allowed; delete intentionally not allowed by policy)
drop policy if exists products_select_own on public.products;
create policy products_select_own
on public.products for select
to authenticated
using (owner_id = auth.uid());

drop policy if exists products_insert_own on public.products;
create policy products_insert_own
on public.products for insert
to authenticated
with check (owner_id = auth.uid());

drop policy if exists products_update_own on public.products;
create policy products_update_own
on public.products for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

-- qualities: allow owner to manage
drop policy if exists qualities_select_own on public.qualities;
create policy qualities_select_own
on public.qualities for select
to authenticated
using (owner_id = auth.uid());

drop policy if exists qualities_insert_own on public.qualities;
create policy qualities_insert_own
on public.qualities for insert
to authenticated
with check (owner_id = auth.uid());

drop policy if exists qualities_update_own on public.qualities;
create policy qualities_update_own
on public.qualities for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

-- employees: allow owner to manage
drop policy if exists employees_select_own on public.employees;
create policy employees_select_own
on public.employees for select
to authenticated
using (owner_id = auth.uid());

drop policy if exists employees_insert_own on public.employees;
create policy employees_insert_own
on public.employees for insert
to authenticated
with check (owner_id = auth.uid());

drop policy if exists employees_update_own on public.employees;
create policy employees_update_own
on public.employees for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

-- skus: allow owner to manage
drop policy if exists skus_select_own on public.skus;
create policy skus_select_own
on public.skus for select
to authenticated
using (owner_id = auth.uid());

drop policy if exists skus_insert_own on public.skus;
create policy skus_insert_own
on public.skus for insert
to authenticated
with check (
  owner_id = auth.uid()
  and exists (select 1 from public.products p where p.id = product_id and p.owner_id = auth.uid())
  and exists (select 1 from public.qualities q where q.id = quality_id and q.owner_id = auth.uid())
);

drop policy if exists skus_update_own on public.skus;
create policy skus_update_own
on public.skus for update
to authenticated
using (owner_id = auth.uid())
with check (
  owner_id = auth.uid()
  and exists (select 1 from public.products p where p.id = product_id and p.owner_id = auth.uid())
  and exists (select 1 from public.qualities q where q.id = quality_id and q.owner_id = auth.uid())
);

-- movements: immutable ledger (select + insert only)
drop policy if exists movements_select_own on public.movements;
create policy movements_select_own
on public.movements for select
to authenticated
using (owner_id = auth.uid());

drop policy if exists movements_insert_own on public.movements;
create policy movements_insert_own
on public.movements for insert
to authenticated
with check (owner_id = auth.uid());

drop policy if exists movements_delete_own on public.movements;
create policy movements_delete_own
on public.movements for delete
to authenticated
using (owner_id = auth.uid());

-- movement_lines: select + insert only; must belong to a movement owned by the user
drop policy if exists movement_lines_select_own on public.movement_lines;
create policy movement_lines_select_own
on public.movement_lines for select
to authenticated
using (
  exists (
    select 1
    from public.movements m
    where m.id = movement_id
      and m.owner_id = auth.uid()
  )
);

drop policy if exists movement_lines_insert_own on public.movement_lines;
create policy movement_lines_insert_own
on public.movement_lines for insert
to authenticated
with check (
  exists (
    select 1
    from public.movements m
    where m.id = movement_id
      and m.owner_id = auth.uid()
  )
  and (
    -- SKU 104 (Rancho) can only be used on Ventas or as the *destination* of a Traspaso SKU from 102/103.
    sku_id is null
    or not exists (
      select 1
      from public.skus s
      where s.id = sku_id
        and s.owner_id = auth.uid()
        and s.code = 104
    )
    or exists (
      select 1
      from public.movements m
      where m.id = movement_id
        and m.owner_id = auth.uid()
        and m.movement_type = 'venta'
    )
    or exists (
      select 1
      from public.movements m
      join public.skus froms on froms.id = m.from_sku_id and froms.owner_id = auth.uid()
      join public.skus tos on tos.id = m.to_sku_id and tos.owner_id = auth.uid()
      where m.id = movement_id
        and m.owner_id = auth.uid()
        and m.movement_type = 'traspaso_sku'
        and tos.id = sku_id
        and tos.code = 104
        and froms.code in (102, 103)
        and delta_weight_kg > 0
    )
  )
  and (
    sku_id is null
    or exists (
      select 1
      from public.skus s
      where s.id = sku_id
        and s.owner_id = auth.uid()
        and s.product_id = product_id
        and s.quality_id = quality_id
    )
  )
  and exists (
    select 1
    from public.products p
    where p.id = product_id
      and p.owner_id = auth.uid()
  )
  and exists (
    select 1
    from public.qualities q
    where q.id = quality_id
      and q.owner_id = auth.uid()
  )
);

drop policy if exists movement_lines_delete_own on public.movement_lines;
create policy movement_lines_delete_own
on public.movement_lines for delete
to authenticated
using (
  exists (
    select 1
    from public.movements m
    where m.id = movement_id
      and m.owner_id = auth.uid()
  )
);

-- movement_attachments: select + insert only
drop policy if exists movement_attachments_select_own on public.movement_attachments;
create policy movement_attachments_select_own
on public.movement_attachments for select
to authenticated
using (owner_id = auth.uid());

drop policy if exists movement_attachments_insert_own on public.movement_attachments;
create policy movement_attachments_insert_own
on public.movement_attachments for insert
to authenticated
with check (
  owner_id = auth.uid()
  and exists (
    select 1
    from public.movements m
    where m.id = movement_id
      and m.owner_id = auth.uid()
  )
);

drop policy if exists movement_attachments_delete_own on public.movement_attachments;
create policy movement_attachments_delete_own
on public.movement_attachments for delete
to authenticated
using (owner_id = auth.uid());

-- Supabase Storage bucket + policies for proof uploads
insert into storage.buckets (id, name, public)
values ('movement-proofs', 'movement-proofs', false)
on conflict (id) do nothing;

drop policy if exists storage_read_own_movement_proofs on storage.objects;
create policy storage_read_own_movement_proofs
on storage.objects for select
to authenticated
using (
  bucket_id = 'movement-proofs'
  and owner = auth.uid()
);

drop policy if exists storage_upload_own_movement_proofs on storage.objects;
create policy storage_upload_own_movement_proofs
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'movement-proofs'
  and owner = auth.uid()
);

drop policy if exists storage_delete_own_movement_proofs on storage.objects;
create policy storage_delete_own_movement_proofs
on storage.objects for delete
to authenticated
using (
  bucket_id = 'movement-proofs'
  and owner = auth.uid()
);

-- Explicit grants (defensive; avoids permission errors if default privileges differ).
grant usage on schema public to authenticated;
grant usage on type public.movement_type to authenticated;
grant usage on type public.price_model to authenticated;

grant select, insert, update on table public.products to authenticated;
grant select, insert, update on table public.qualities to authenticated;
grant select, insert, update on table public.employees to authenticated;
grant select, insert, update on table public.skus to authenticated;
grant select, insert, delete on table public.movements to authenticated;
grant select, insert, delete on table public.movement_lines to authenticated;
grant select, insert, delete on table public.movement_attachments to authenticated;
grant select on table public.inventory_on_hand to authenticated;
