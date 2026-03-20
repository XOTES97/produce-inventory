-- One-time patch for an existing Supabase project.
-- Adds employee Entrada capture support, including the dedicated Entradas tab rules and current employee capture restrictions.

create extension if not exists pg_net;
create extension if not exists vault;

alter table public.workspace_users
  add column if not exists allow_all_sale_sku boolean not null default true;

create table if not exists public.workspace_sale_sku_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sku_id uuid not null references public.skus(id) on delete cascade,
  is_allowed boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, sku_id)
);

create index if not exists workspace_sale_sku_rules_workspace_idx on public.workspace_sale_sku_rules(workspace_id);
create index if not exists workspace_sale_sku_rules_sku_idx on public.workspace_sale_sku_rules(sku_id);

alter table public.movements
  add column if not exists reference_number bigint;

create sequence if not exists public.movement_reference_number_seq;

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

drop trigger if exists trg_workspace_sale_sku_rules_set_updated_at on public.workspace_sale_sku_rules;
create trigger trg_workspace_sale_sku_rules_set_updated_at
before update on public.workspace_sale_sku_rules
for each row execute function public.set_updated_at();

create or replace function public.current_actor_workspace_id()
returns uuid
language sql
stable
security definer
as $$
  select workspace_id from public.workspace_users where user_id = auth.uid();
$$;

create or replace function public.current_actor_role()
returns public.app_role
language sql
stable
security definer
as $$
  select role from public.workspace_users where user_id = auth.uid();
$$;

create or replace function public.current_actor_display_name()
returns text
language sql
stable
security definer
as $$
  select coalesce(
    display_name,
    nullif(split_part(auth.jwt() ->> 'email', '@', 1), ''),
    auth.uid()::text
  )
  from public.workspace_users
  where user_id = auth.uid();
$$;

create or replace function public.actor_can_access_owner(row_owner uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1
    from public.workspace_users wu_actor
    where wu_actor.user_id = auth.uid()
      and (
        wu_actor.user_id = row_owner
        or exists (
          select 1
          from public.workspace_users wu_owner
          where wu_owner.user_id = row_owner
            and wu_owner.workspace_id = wu_actor.workspace_id
        )
      )
  );
$$;

create or replace function public.employee_is_valid_for_actor(target_employee_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1
    from public.employees e
    join public.workspace_users wu_owner
      on wu_owner.user_id = e.owner_id
    join public.workspace_users wu_actor
      on wu_actor.workspace_id = wu_owner.workspace_id
    where wu_actor.user_id = auth.uid()
      and e.id = target_employee_id
      and coalesce(e.is_active, true)
  );
$$;

create or replace function public.actor_can_access_movement(target_movement_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1
    from public.movements m
    where m.id = target_movement_id
      and public.actor_can_access_owner(m.owner_id)
  );
$$;

create or replace function public.current_actor_allow_all_sale_sku()
returns boolean
language sql
stable
security definer
as $$
  select coalesce(allow_all_sale_sku, true) from public.workspace_users where user_id = auth.uid();
$$;

create or replace function public.actor_can_sell_sku(target_sku_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select
    case
      when public.current_actor_role() = 'manager' then true
      when public.current_actor_allow_all_sale_sku() then true
      else exists (
        select 1
        from public.workspace_sale_sku_rules r
        where r.workspace_id = public.current_actor_workspace_id()
          and r.sku_id = target_sku_id
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
    'allow_all_sale_sku', coalesce(public.current_actor_allow_all_sale_sku(), true),
    'allow_all_traspaso_sku', coalesce(public.current_actor_allow_all_traspaso_sku(), true)
  );
$$;

alter table public.workspace_sale_sku_rules enable row level security;
alter table public.workspaces enable row level security;

drop policy if exists workspaces_select_workspace on public.workspaces;
create policy workspaces_select_workspace
on public.workspaces for select
to authenticated
using (
  id = public.current_actor_workspace_id()
);

drop policy if exists workspaces_update_manager on public.workspaces;
create policy workspaces_update_manager
on public.workspaces for update
to authenticated
using (
  public.current_actor_role() = 'manager'
  and id = public.current_actor_workspace_id()
)
with check (
  public.current_actor_role() = 'manager'
  and id = public.current_actor_workspace_id()
);

drop policy if exists workspace_sale_sku_rules_select_workspace on public.workspace_sale_sku_rules;
create policy workspace_sale_sku_rules_select_workspace
on public.workspace_sale_sku_rules for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_users wu
    where wu.user_id = auth.uid()
      and wu.workspace_id = workspace_sale_sku_rules.workspace_id
  )
);

drop policy if exists workspace_sale_sku_rules_insert_manager on public.workspace_sale_sku_rules;
create policy workspace_sale_sku_rules_insert_manager
on public.workspace_sale_sku_rules for insert
to authenticated
with check (
  public.current_actor_role() = 'manager'
  and workspace_id = public.current_actor_workspace_id()
);

drop policy if exists workspace_sale_sku_rules_update_manager on public.workspace_sale_sku_rules;
create policy workspace_sale_sku_rules_update_manager
on public.workspace_sale_sku_rules for update
to authenticated
using (
  public.current_actor_role() = 'manager'
  and workspace_id = public.current_actor_workspace_id()
)
with check (
  public.current_actor_role() = 'manager'
  and workspace_id = public.current_actor_workspace_id()
);

drop policy if exists workspace_sale_sku_rules_delete_manager on public.workspace_sale_sku_rules;
create policy workspace_sale_sku_rules_delete_manager
on public.workspace_sale_sku_rules for delete
to authenticated
using (
  public.current_actor_role() = 'manager'
  and workspace_id = public.current_actor_workspace_id()
);

grant select, insert, update, delete on table public.workspace_sale_sku_rules to authenticated;

drop policy if exists movement_lines_insert_own on public.movement_lines;
create policy movement_lines_insert_own
on public.movement_lines for insert
to authenticated
with check (
  public.actor_can_access_movement(movement_id)
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

drop policy if exists movement_attachments_insert_own on public.movement_attachments;
create policy movement_attachments_insert_own
on public.movement_attachments for insert
to authenticated
with check (
  public.actor_can_access_owner(owner_id)
  and public.actor_can_access_movement(movement_id)
);

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
  v_actor_employee_id uuid;
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
  v_discord_webhook_url text;
  v_notification_text text;
  v_movement_label text;
  v_reported_by_name text;
  v_line_summary text;
  v_notes text;
  v_reference_number bigint;
  v_occurred_at timestamptz;
  v_attachment_count integer;
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

  v_attachment_count := jsonb_array_length(attachments);

  v_movement_id := coalesce(nullif(movement->>'id', '')::uuid, gen_random_uuid());
  v_employee_id := nullif(movement->>'reported_by_employee_id', '')::uuid;
  v_mt := (movement->>'movement_type')::public.movement_type;
  v_from_sku_id := nullif(movement->>'from_sku_id', '')::uuid;
  v_to_sku_id := nullif(movement->>'to_sku_id', '')::uuid;
  v_actor_role := public.current_actor_role();
  v_actor_workspace_id := public.current_actor_workspace_id();
  v_actor_employee_id := public.current_actor_employee_id();
  v_actor_merma_limit := public.current_actor_merma_limit_kg();
  v_actor_allow_all_traspaso := public.current_actor_allow_all_traspaso_sku();

  if v_actor_role = 'employee' then
    if v_actor_employee_id is null then
      raise exception 'employee_not_linked';
    end if;
    if v_employee_id is null then
      v_employee_id := v_actor_employee_id;
    elsif v_employee_id <> v_actor_employee_id then
      raise exception 'employee_must_match_linked_employee';
    end if;
    if v_mt not in ('entrada', 'venta', 'merma', 'traspaso_sku') then
      raise exception 'employee_only_limited_types';
    end if;
    if v_mt = 'venta' then
      if exists (
        select 1
        from jsonb_array_elements(lines) as l
        where nullif(l->>'sku_id', '') is null
      ) then
        raise exception 'employee_sale_requires_sku';
      end if;
      if exists (
        select 1
        from jsonb_array_elements(lines) as l
        left join public.skus s on s.id = nullif(l->>'sku_id', '')::uuid
        where s.id is null
          or not public.actor_can_access_owner(s.owner_id)
          or not public.actor_can_sell_sku(s.id)
          or s.product_id is distinct from nullif(l->>'product_id', '')::uuid
          or s.quality_id is distinct from nullif(l->>'quality_id', '')::uuid
          or case
            when s.default_price_model = 'per_box'::public.price_model then
              coalesce(nullif(l->>'price_model', '')::public.price_model, 'per_box'::public.price_model) <> 'per_box'::public.price_model
              or coalesce(nullif(l->>'boxes', '')::integer, 0) <= 0
            else
              coalesce(nullif(l->>'price_model', '')::public.price_model, 'per_kg'::public.price_model) <> 'per_kg'::public.price_model
          end
      ) then
        raise exception 'employee_sale_only_per_box_skus';
      end if;
    end if;
    if v_mt = 'entrada' then
      if exists (
        select 1
        from jsonb_array_elements(lines) as l
        where nullif(l->>'sku_id', '') is null
      ) then
        raise exception 'employee_entry_requires_sku';
      end if;
      if exists (
        select 1
        from jsonb_array_elements(lines) as l
        left join public.skus s on s.id = nullif(l->>'sku_id', '')::uuid
        where s.id is null
          or not public.actor_can_access_owner(s.owner_id)
          or s.product_id is distinct from nullif(l->>'product_id', '')::uuid
          or s.quality_id is distinct from nullif(l->>'quality_id', '')::uuid
      ) then
        raise exception 'employee_entry_requires_sku';
      end if;
    end if;
    if v_mt = 'merma' then
      if exists (
        select 1
        from jsonb_array_elements(lines) as l
        where nullif(l->>'sku_id', '') is null
      ) then
        raise exception 'employee_merma_requires_sku';
      end if;
      if exists (
        select 1
        from jsonb_array_elements(lines) as l
        left join public.skus s on s.id = nullif(l->>'sku_id', '')::uuid
        where s.id is null
          or not public.actor_can_access_owner(s.owner_id)
          or s.product_id is distinct from nullif(l->>'product_id', '')::uuid
          or s.quality_id is distinct from nullif(l->>'quality_id', '')::uuid
      ) then
        raise exception 'employee_merma_requires_sku';
      end if;
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

  if v_employee_id is not null and not public.employee_is_valid_for_actor(v_employee_id) then
    raise exception 'employee_invalid';
  end if;

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

  begin
    select ds.decrypted_secret
      into v_discord_webhook_url
    from vault.decrypted_secrets ds
    where ds.name = 'discord_movement_webhook_url'
    limit 1;

    if coalesce(btrim(v_discord_webhook_url), '') <> '' then
      select
        m.reference_number,
        m.occurred_at,
        case m.movement_type
          when 'entrada' then 'Entrada'
          when 'venta' then 'Venta'
          when 'merma' then 'Merma'
          when 'traspaso_sku' then 'Traspaso SKU'
          when 'traspaso_calidad' then 'Traspaso de calidad'
          when 'ajuste' then 'Ajuste'
          else 'Movimiento'
        end,
        coalesce(
          e.name::text,
          public.current_actor_display_name(),
          nullif(split_part(auth.jwt() ->> 'email', '@', 1), ''),
          auth.uid()::text
        ),
        nullif(btrim(m.notes), ''),
        coalesce(
          (
            with ranked_lines as (
              select
                row_number() over (order by ml.created_at asc, ml.id asc) as rn,
                count(*) over () as total_count,
                concat(
                  '• ',
                  coalesce(
                    case
                      when s.id is not null then concat('SKU ', s.code::text, ' ', s.name)
                      else null
                    end,
                    concat(p.name::text, ' / ', q.name::text)
                  ),
                  ' | ',
                  case when ml.delta_weight_kg > 0 then '+' else '' end,
                  to_char(ml.delta_weight_kg, 'FM999999990.000'),
                  ' kg',
                  case when ml.boxes is not null then concat(' | ', ml.boxes::text, ' cajas') else '' end,
                  case
                    when ml.unit_price is not null then concat(
                      ' | $',
                      to_char(ml.unit_price, 'FM999999990.00'),
                      case
                        when ml.price_model = 'per_box' then '/caja'
                        when ml.price_model = 'per_kg' then '/kg'
                        else ''
                      end
                    )
                    else ''
                  end,
                  case when ml.line_total is not null then concat(' | Total $', to_char(ml.line_total, 'FM999999990.00')) else '' end
                ) as line_text
              from public.movement_lines ml
              join public.products p on p.id = ml.product_id
              join public.qualities q on q.id = ml.quality_id
              left join public.skus s on s.id = ml.sku_id
              where ml.movement_id = m.id
            )
            select case
              when max(total_count) > 8 then concat(
                string_agg(line_text, E'\n' order by rn) filter (where rn <= 8),
                E'\n',
                '... +',
                (max(total_count) - 8)::text,
                ' lineas mas'
              )
              else string_agg(line_text, E'\n' order by rn)
            end
            from ranked_lines
          ),
          '• Sin lineas'
        )
      into
        v_reference_number,
        v_occurred_at,
        v_movement_label,
        v_reported_by_name,
        v_notes,
        v_line_summary
      from public.movements m
      left join public.employees e on e.id = m.reported_by_employee_id
      where m.id = v_movement_id;

      if v_reference_number is not null then
        v_notification_text := concat(
          '**FST INV | FST',
          v_reference_number::text,
          ' | ',
          coalesce(v_movement_label, 'Movimiento'),
          '**',
          E'\nFecha: ',
          coalesce(v_occurred_at::text, now()::text),
          E'\nReportado por: ',
          coalesce(v_reported_by_name, 'Sin empleado'),
          E'\nLineas:',
          E'\n',
          coalesce(v_line_summary, '• Sin lineas'),
          case when v_attachment_count > 0 then E'\nEvidencia: ' || v_attachment_count::text || ' archivo(s)' else '' end,
          case when v_notes is not null then E'\nNotas: ' || left(v_notes, 400) else '' end
        );

        perform net.http_post(
          url := v_discord_webhook_url,
          headers := jsonb_build_object('Content-Type', 'application/json'),
          body := jsonb_build_object(
            'content', left(v_notification_text, 1900),
            'allowed_mentions', jsonb_build_object('parse', jsonb_build_array())
          )
        );
      end if;
    end if;
  exception
    when others then
      null;
  end;

  return v_movement_id;
end;
$$;

revoke all on function public.create_movement_with_lines(jsonb, jsonb, jsonb) from public;
grant execute on function public.create_movement_with_lines(jsonb, jsonb, jsonb) to authenticated;
