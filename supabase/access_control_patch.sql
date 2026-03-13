-- Workspace and role based access control.
-- Run this in Supabase SQL Editor after current schema.

do $$
begin
  create type public.app_role as enum ('manager', 'employee');
exception
  when duplicate_object then
    null;
end
$$;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_users (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'employee',
  employee_id uuid references public.employees(id),
  display_name text,
  merma_limit_kg numeric(12,3),
  allow_all_traspaso_sku boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  constraint workspace_users_unique_user unique (user_id)
);

create index if not exists workspace_users_workspace_idx on public.workspace_users(workspace_id);

drop trigger if exists trg_workspace_users_set_updated_at on public.workspace_users;
create trigger trg_workspace_users_set_updated_at
before update on public.workspace_users
for each row execute function public.set_updated_at();

create table if not exists public.workspace_traspaso_sku_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  from_sku_id uuid not null references public.skus(id) on delete cascade,
  to_sku_id uuid not null references public.skus(id) on delete cascade,
  is_allowed boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, from_sku_id, to_sku_id),
  check (from_sku_id <> to_sku_id)
);

create index if not exists workspace_traspaso_sku_rules_workspace_idx on public.workspace_traspaso_sku_rules(workspace_id);
create index if not exists workspace_traspaso_sku_rules_from_idx on public.workspace_traspaso_sku_rules(from_sku_id);
create index if not exists workspace_traspaso_sku_rules_to_idx on public.workspace_traspaso_sku_rules(to_sku_id);

drop trigger if exists trg_workspace_traspaso_sku_rules_set_updated_at on public.workspace_traspaso_sku_rules;
create trigger trg_workspace_traspaso_sku_rules_set_updated_at
before update on public.workspace_traspaso_sku_rules
for each row execute function public.set_updated_at();

create or replace function public.current_actor_workspace_id()
returns uuid
language sql
stable
security definer
as $$
  select coalesce(
    (select workspace_id from public.workspace_users where user_id = auth.uid()),
    auth.uid()
  );
$$;

create or replace function public.current_actor_role()
returns public.app_role
language sql
stable
security definer
as $$
  select coalesce(
    (select role from public.workspace_users where user_id = auth.uid()),
    'manager'::public.app_role
  );
$$;

create or replace function public.current_actor_display_name()
returns text
language sql
stable
security definer
as $$
  select coalesce(
    (select display_name from public.workspace_users where user_id = auth.uid()),
    nullif(split_part(auth.jwt() ->> 'email', '@', 1), ''),
    auth.uid()::text
  );
$$;

create or replace function public.current_actor_employee_id()
returns uuid
language sql
stable
security definer
as $$
  select employee_id from public.workspace_users where user_id = auth.uid();
$$;

create or replace function public.current_actor_merma_limit_kg()
returns numeric
language sql
stable
security definer
as $$
  select merma_limit_kg from public.workspace_users where user_id = auth.uid();
$$;

create or replace function public.current_actor_allow_all_traspaso_sku()
returns boolean
language sql
stable
security definer
as $$
  select coalesce(allow_all_traspaso_sku, true) from public.workspace_users where user_id = auth.uid();
$$;

create or replace function public.actor_can_access_owner(row_owner uuid)
returns boolean
language sql
stable
security definer
as $$
  select row_owner = auth.uid()
    or exists (
      select 1
      from public.workspace_users wu_owner
      where wu_owner.user_id = row_owner
        and exists (
          select 1
          from public.workspace_users wu_actor
          where wu_actor.user_id = auth.uid()
            and wu_actor.workspace_id = wu_owner.workspace_id
        )
    );
$$;

create or replace function public.actor_can_traspaso_sku(from_sku_id uuid, to_sku_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select
    case
      when public.current_actor_role() = 'manager' then true
      when public.current_actor_allow_all_traspaso_sku() then true
      else exists (
        select 1
        from public.workspace_traspaso_sku_rules r
        where r.workspace_id = public.current_actor_workspace_id()
          and r.from_sku_id = from_sku_id
          and r.to_sku_id = to_sku_id
          and r.is_allowed
      )
    end;
$$;

create or replace function public.get_actor_context()
returns jsonb
language sql
stable
security definer
as $$
  select jsonb_build_object(
    'workspace_id', public.current_actor_workspace_id(),
    'role', public.current_actor_role()::text,
    'display_name', public.current_actor_display_name(),
    'employee_id', public.current_actor_employee_id(),
    'merma_limit_kg', public.current_actor_merma_limit_kg(),
    'allow_all_traspaso_sku', coalesce(public.current_actor_allow_all_traspaso_sku(), true)
  );
$$;

create or replace function public.seed_workspace_for_owner()
returns void
language plpgsql
security definer
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  if not exists (select 1 from public.workspaces where name = 'Default Workspace') then
    insert into public.workspaces (name)
    values ('Default Workspace');
  end if;

  if not exists (
    select 1 from public.workspace_users wu where wu.user_id = auth.uid()
  ) then
    insert into public.workspace_users (
      workspace_id,
      user_id,
      role,
      display_name
    )
    values (
      (select id from public.workspaces where name = 'Default Workspace' limit 1),
      auth.uid(),
      'manager',
      nullif(split_part(auth.jwt() ->> 'email', '@', 1), '')
    );
  end if;
end;
$$;

-- Ensure current auth owner has a workspace assignment.
select public.seed_workspace_for_owner();

-- Keep workspace assignments in sync with the owner, not across users.
alter table public.products alter column owner_id set default auth.uid();
alter table public.qualities alter column owner_id set default auth.uid();
alter table public.employees alter column owner_id set default auth.uid();
alter table public.skus alter column owner_id set default auth.uid();

alter table public.movements alter column owner_id set default auth.uid();
alter table public.movement_attachments alter column owner_id set default auth.uid();
alter table public.physical_cutoffs alter column owner_id set default auth.uid();
alter table public.physical_cutoff_lines alter column owner_id set default auth.uid();
alter table public.physical_cutoff_attachments alter column owner_id set default auth.uid();

alter table public.products enable row level security;
alter table public.qualities enable row level security;
alter table public.employees enable row level security;
alter table public.skus enable row level security;
alter table public.movements enable row level security;
alter table public.movement_lines enable row level security;
alter table public.movement_attachments enable row level security;
alter table public.workspace_users enable row level security;
alter table public.workspace_traspaso_sku_rules enable row level security;

-- Workspace users can read users in same workspace (for role + limits).
drop policy if exists workspace_users_select_workspace on public.workspace_users;
create policy workspace_users_select_workspace
on public.workspace_users for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_users wu
    where wu.user_id = auth.uid()
      and (
        wu.user_id = workspace_users.user_id
        or wu.workspace_id = workspace_users.workspace_id
      )
  )
);

drop policy if exists workspace_users_insert_manager on public.workspace_users;
create policy workspace_users_insert_manager
on public.workspace_users for insert
to authenticated
with check (
  public.current_actor_role() = 'manager'
  and (workspace_id = public.current_actor_workspace_id())
);

drop policy if exists workspace_users_update_manager on public.workspace_users;
create policy workspace_users_update_manager
on public.workspace_users for update
to authenticated
using (
  public.current_actor_role() = 'manager'
  and (workspace_id = public.current_actor_workspace_id())
)
with check (
  public.current_actor_role() = 'manager'
  and (workspace_id = public.current_actor_workspace_id())
);

drop policy if exists workspace_users_delete_manager on public.workspace_users;
create policy workspace_users_delete_manager
on public.workspace_users for delete
to authenticated
using (
  public.current_actor_role() = 'manager'
  and (workspace_id = public.current_actor_workspace_id())
);

-- Traspaso rules can be managed by manager of the workspace.
drop policy if exists workspace_traspaso_sku_rules_select_workspace on public.workspace_traspaso_sku_rules;
create policy workspace_traspaso_sku_rules_select_workspace
on public.workspace_traspaso_sku_rules for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_users wu
    where wu.user_id = auth.uid()
      and wu.workspace_id = workspace_traspaso_sku_rules.workspace_id
  )
);

drop policy if exists workspace_traspaso_sku_rules_insert_manager on public.workspace_traspaso_sku_rules;
create policy workspace_traspaso_sku_rules_insert_manager
on public.workspace_traspaso_sku_rules for insert
to authenticated
with check (
  public.current_actor_role() = 'manager'
  and workspace_id = public.current_actor_workspace_id()
);

drop policy if exists workspace_traspaso_sku_rules_update_manager on public.workspace_traspaso_sku_rules;
create policy workspace_traspaso_sku_rules_update_manager
on public.workspace_traspaso_sku_rules for update
to authenticated
using (
  public.current_actor_role() = 'manager'
  and workspace_id = public.current_actor_workspace_id()
)
with check (
  public.current_actor_role() = 'manager'
  and workspace_id = public.current_actor_workspace_id()
);

drop policy if exists workspace_traspaso_sku_rules_delete_manager on public.workspace_traspaso_sku_rules;
create policy workspace_traspaso_sku_rules_delete_manager
on public.workspace_traspaso_sku_rules for delete
to authenticated
using (
  public.current_actor_role() = 'manager'
  and workspace_id = public.current_actor_workspace_id()
);

-- Catalogs are shared by workspace, but only manager can edit.
drop policy if exists products_select_own on public.products;
create policy products_select_own
on public.products for select
to authenticated
using (public.actor_can_access_owner(owner_id));

drop policy if exists products_insert_own on public.products;
create policy products_insert_own
on public.products for insert
to authenticated
with check (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
);

drop policy if exists products_update_own on public.products;
create policy products_update_own
on public.products for update
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
)
with check (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
);

drop policy if exists qualities_select_own on public.qualities;
create policy qualities_select_own
on public.qualities for select
to authenticated
using (public.actor_can_access_owner(owner_id));

drop policy if exists qualities_insert_own on public.qualities;
create policy qualities_insert_own
on public.qualities for insert
to authenticated
with check (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
);

drop policy if exists qualities_update_own on public.qualities;
create policy qualities_update_own
on public.qualities for update
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
)
with check (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
);

drop policy if exists employees_select_own on public.employees;
create policy employees_select_own
on public.employees for select
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
);

drop policy if exists employees_insert_own on public.employees;
create policy employees_insert_own
on public.employees for insert
to authenticated
with check (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
);

drop policy if exists employees_update_own on public.employees;
create policy employees_update_own
on public.employees for update
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
)
with check (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
);

drop policy if exists skus_select_own on public.skus;
create policy skus_select_own
on public.skus for select
to authenticated
using (public.actor_can_access_owner(owner_id));

drop policy if exists skus_insert_own on public.skus;
create policy skus_insert_own
on public.skus for insert
to authenticated
with check (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
  and exists (select 1 from public.products p where p.id = product_id and public.actor_can_access_owner(p.owner_id))
  and exists (select 1 from public.qualities q where q.id = quality_id and public.actor_can_access_owner(q.owner_id))
);

drop policy if exists skus_update_own on public.skus;
create policy skus_update_own
on public.skus for update
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
)
with check (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
  and exists (select 1 from public.products p where p.id = product_id and public.actor_can_access_owner(p.owner_id))
  and exists (select 1 from public.qualities q where q.id = quality_id and public.actor_can_access_owner(q.owner_id))
);

-- Movements: employee can insert, manager can manage all movement views.
drop policy if exists movements_select_own on public.movements;
create policy movements_select_own
on public.movements for select
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
);

drop policy if exists movements_insert_own on public.movements;
create policy movements_insert_own
on public.movements for insert
to authenticated
with check (public.actor_can_access_owner(owner_id));

drop policy if exists movements_delete_own on public.movements;
create policy movements_delete_own
on public.movements for delete
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
);

drop policy if exists movement_lines_select_own on public.movement_lines;
create policy movement_lines_select_own
on public.movement_lines for select
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner((
    select owner_id from public.movements m where m.id = movement_id
  ))
);

drop policy if exists movement_lines_insert_own on public.movement_lines;
create policy movement_lines_insert_own
on public.movement_lines for insert
to authenticated
with check (
  public.actor_can_access_owner((select owner_id from public.movements m where m.id = movement_id))
  and (
    sku_id is null
    or exists (
      select 1
      from public.skus s
      where s.id = sku_id
        and public.actor_can_access_owner(s.owner_id)
        and s.product_id = product_id
        and s.quality_id = quality_id
    )
  )
  and exists (
    select 1
    from public.products p
    where p.id = product_id
      and public.actor_can_access_owner(p.owner_id)
  )
  and exists (
    select 1
    from public.qualities q
    where q.id = quality_id
      and public.actor_can_access_owner(q.owner_id)
  )
);

drop policy if exists movement_lines_delete_own on public.movement_lines;
create policy movement_lines_delete_own
on public.movement_lines for delete
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner((select owner_id from public.movements m where m.id = movement_id))
);

drop policy if exists movement_attachments_select_own on public.movement_attachments;
create policy movement_attachments_select_own
on public.movement_attachments for select
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner((select owner_id from public.movements m where m.id = movement_id))
);

drop policy if exists movement_attachments_insert_own on public.movement_attachments;
create policy movement_attachments_insert_own
on public.movement_attachments for insert
to authenticated
with check (
  public.actor_can_access_owner(owner_id)
  and public.actor_can_access_owner((select owner_id from public.movements m where m.id = movement_id))
);

drop policy if exists movement_attachments_delete_own on public.movement_attachments;
create policy movement_attachments_delete_own
on public.movement_attachments for delete
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
);

-- Keep shared access for physical cuts for this MVP: manager only in the workspace.
alter table public.physical_cutoffs enable row level security;
alter table public.physical_cutoff_lines enable row level security;
alter table public.physical_cutoff_attachments enable row level security;

drop policy if exists physical_cutoffs_select_own on public.physical_cutoffs;
create policy physical_cutoffs_select_own
on public.physical_cutoffs for select
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
);

drop policy if exists physical_cutoffs_insert_own on public.physical_cutoffs;
create policy physical_cutoffs_insert_own
on public.physical_cutoffs for insert
to authenticated
with check (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
);

drop policy if exists physical_cutoffs_update_own on public.physical_cutoffs;
create policy physical_cutoffs_update_own
on public.physical_cutoffs for update
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
)
with check (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
);

drop policy if exists physical_cutoffs_delete_own on public.physical_cutoffs;
create policy physical_cutoffs_delete_own
on public.physical_cutoffs for delete
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
);

drop policy if exists physical_cutoff_lines_select_own on public.physical_cutoff_lines;
create policy physical_cutoff_lines_select_own
on public.physical_cutoff_lines for select
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
);

drop policy if exists physical_cutoff_lines_insert_own on public.physical_cutoff_lines;
create policy physical_cutoff_lines_insert_own
on public.physical_cutoff_lines for insert
to authenticated
with check (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
  and exists (
    select 1
    from public.physical_cutoffs c
    where c.id = cutoff_id
      and public.actor_can_access_owner(c.owner_id)
  )
);

drop policy if exists physical_cutoff_lines_update_own on public.physical_cutoff_lines;
create policy physical_cutoff_lines_update_own
on public.physical_cutoff_lines for update
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
)
with check (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
);

drop policy if exists physical_cutoff_lines_delete_own on public.physical_cutoff_lines;
create policy physical_cutoff_lines_delete_own
on public.physical_cutoff_lines for delete
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
);

drop policy if exists physical_cutoff_attachments_select_own on public.physical_cutoff_attachments;
create policy physical_cutoff_attachments_select_own
on public.physical_cutoff_attachments for select
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
);

drop policy if exists physical_cutoff_attachments_insert_own on public.physical_cutoff_attachments;
create policy physical_cutoff_attachments_insert_own
on public.physical_cutoff_attachments for insert
to authenticated
with check (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
  and exists (
    select 1
    from public.physical_cutoff_lines l
    where l.id = cutoff_line_id
      and public.actor_can_access_owner(l.owner_id)
  )
);

drop policy if exists physical_cutoff_attachments_delete_own on public.physical_cutoff_attachments;
create policy physical_cutoff_attachments_delete_own
on public.physical_cutoff_attachments for delete
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_owner(owner_id)
);

-- Storage: proofs visible within same workspace.
drop policy if exists storage_read_own_movement_proofs on storage.objects;
create policy storage_read_own_movement_proofs
on storage.objects for select
to authenticated
using (
  bucket_id = 'movement-proofs'
  and (
    owner = auth.uid()
    or exists (
      select 1
      from public.workspace_users wu_owner
      where wu_owner.user_id = owner
        and exists (
          select 1
          from public.workspace_users wu_actor
          where wu_actor.user_id = auth.uid()
            and wu_actor.workspace_id = wu_owner.workspace_id
        )
    )
  )
);

drop policy if exists storage_read_own_cutoff_proofs on storage.objects;
create policy storage_read_own_cutoff_proofs
on storage.objects for select
to authenticated
using (
  bucket_id = 'physical-cutoff-proofs'
  and (
    owner = auth.uid()
    or exists (
      select 1
      from public.workspace_users wu_owner
      where wu_owner.user_id = owner
        and exists (
          select 1
          from public.workspace_users wu_actor
          where wu_actor.user_id = auth.uid()
            and wu_actor.workspace_id = wu_owner.workspace_id
        )
    )
  )
);

-- Upload rules keep per-user object ownership.
drop policy if exists storage_upload_own_movement_proofs on storage.objects;
create policy storage_upload_own_movement_proofs
on storage.objects for insert
to authenticated
with check (bucket_id = 'movement-proofs' and owner = auth.uid());

drop policy if exists storage_upload_own_cutoff_proofs on storage.objects;
create policy storage_upload_own_cutoff_proofs
on storage.objects for insert
to authenticated
with check (bucket_id = 'physical-cutoff-proofs' and owner = auth.uid());

drop policy if exists storage_delete_own_movement_proofs on storage.objects;
create policy storage_delete_own_movement_proofs
on storage.objects for delete
to authenticated
using (
  bucket_id = 'movement-proofs'
  and (
    owner = auth.uid()
    or exists (
      select 1
      from public.workspace_users wu_owner
      where wu_owner.user_id = owner
        and exists (
          select 1
          from public.workspace_users wu_actor
          where wu_actor.user_id = auth.uid()
            and wu_actor.workspace_id = wu_owner.workspace_id
        )
        and exists (
          select 1
          from public.movement_attachments ma
          where ma.storage_bucket = 'movement-proofs'
            and ma.storage_path = name
            and public.actor_can_access_owner(ma.owner_id)
            and public.current_actor_role() = 'manager'
        )
    )
  )
);

drop policy if exists storage_delete_own_cutoff_proofs on storage.objects;
create policy storage_delete_own_cutoff_proofs
on storage.objects for delete
to authenticated
using (
  bucket_id = 'physical-cutoff-proofs'
  and (
    owner = auth.uid()
    or (
      public.current_actor_role() = 'manager'
      and exists (
        select 1
        from public.workspace_users wu_owner
        where wu_owner.user_id = owner
          and exists (
            select 1
            from public.workspace_users wu_actor
            where wu_actor.user_id = auth.uid()
              and wu_actor.workspace_id = wu_owner.workspace_id
          )
      )
    )
  )
);

-- Insert / update movement logic.
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
  v_sum_delta numeric;
  v_sum_from numeric;
  v_sum_to numeric;
  v_actor_role public.app_role;
  v_actor_workspace_id uuid;
  v_actor_merma_limit numeric;
  v_actor_allow_all_traspaso boolean;
  v_total_merma numeric;
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
  v_actor_role := public.current_actor_role();
  v_actor_workspace_id := public.current_actor_workspace_id();
  v_actor_merma_limit := public.current_actor_merma_limit_kg();
  v_actor_allow_all_traspaso := public.current_actor_allow_all_traspaso_sku();

  if v_actor_role = 'employee' then
    if v_mt not in ('venta', 'merma', 'traspaso_sku') then
      raise exception 'employee_only_limited_types';
    end if;
    if v_mt = 'merma' and v_actor_merma_limit is not null then
      select coalesce(sum(abs((l->>'delta_weight_kg')::numeric)), 0)
        into v_total_merma
      from jsonb_array_elements(lines) as l
      where (l->>'delta_weight_kg')::numeric < 0;

      if v_total_merma > v_actor_merma_limit then
        raise exception 'merma_limit_exceeded';
      end if;
    end if;
    if v_mt = 'traspaso_sku' then
      if not public.actor_can_traspaso_sku(v_from_sku_id, v_to_sku_id) then
        raise exception 'traspaso_sku_not_allowed';
      end if;
    end if;
    if jsonb_array_length(attachments) < 1 then
      raise exception 'proof_required_for_employee';
    end if;
  end if;

  if v_employee_id is not null and not exists (
    select 1 from public.employees e
    where e.id = v_employee_id
      and public.actor_can_access_owner(e.owner_id)
  ) then
    raise exception 'employee_invalid';
  end if;

  -- Validate traspaso_sku rules.
  if v_mt = 'traspaso_sku' then
    if v_from_sku_id is null or v_to_sku_id is null or v_from_sku_id = v_to_sku_id then
      raise exception 'traspaso_sku_requires_from_to';
    end if;

    if exists (
      select 1
      from public.skus s
      where s.id = v_from_sku_id
        and not public.actor_can_access_owner(s.owner_id)
    ) then
      raise exception 'from_sku_invalid';
    end if;

    if exists (
      select 1
      from public.skus s
      where s.id = v_to_sku_id
        and not public.actor_can_access_owner(s.owner_id)
    ) then
      raise exception 'to_sku_invalid';
    end if;

    select coalesce(sum((l->>'delta_weight_kg')::numeric), 0)
      into v_sum_delta
    from jsonb_array_elements(lines) as l;

    if v_sum_delta <> 0 then
      raise exception 'traspaso_sku_not_balanced';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(lines) as l
      where (
        nullif(l->>'sku_id', '')::uuid is distinct from v_from_sku_id
        and nullif(l->>'sku_id', '')::uuid is distinct from v_to_sku_id
      )
    ) then
      raise exception 'traspaso_sku_lines_invalid';
    end if;

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

create or replace function public.delete_movement(movement_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_movement_id uuid;
begin
  if public.current_actor_role() <> 'manager' then
    raise exception 'only_manager_can_delete_movement';
  end if;

  v_movement_id := movement_id;
  if v_movement_id is null then
    raise exception 'movement_id_required';
  end if;

  if not exists (
    select 1
    from public.movements m
    where m.id = v_movement_id
      and public.actor_can_access_owner(m.owner_id)
  ) then
    raise exception 'movement_not_found';
  end if;

  execute 'delete from public.movement_lines ml where ml.movement_id = $1' using v_movement_id;
  execute 'delete from public.movement_attachments ma where ma.movement_id = $1' using v_movement_id;
  execute 'delete from public.movements m where m.id = $1' using v_movement_id;
end;
$$;

revoke all on function public.delete_movement(uuid) from public;
grant execute on function public.delete_movement(uuid) to authenticated;

-- Grants
grant usage on schema public to authenticated;
grant usage on type public.movement_type to authenticated;
grant usage on type public.price_model to authenticated;
grant usage on type public.app_role to authenticated;

grant select, insert, update, delete on table public.products to authenticated;
grant select, insert, update, delete on table public.qualities to authenticated;
grant select, insert, update, delete on table public.employees to authenticated;
grant select, insert, update, delete on table public.skus to authenticated;
grant select, insert, delete on table public.movements to authenticated;
grant select, insert, delete on table public.movement_lines to authenticated;
grant select, insert, delete on table public.movement_attachments to authenticated;
grant select, insert, update, delete on table public.workspaces to authenticated;
grant select, insert, update, delete on table public.workspace_users to authenticated;
grant select, insert, update, delete on table public.workspace_traspaso_sku_rules to authenticated;
grant select, insert, update, delete on table public.physical_cutoffs to authenticated;
grant select, insert, update, delete on table public.physical_cutoff_lines to authenticated;
grant select, insert, delete on table public.physical_cutoff_attachments to authenticated;

