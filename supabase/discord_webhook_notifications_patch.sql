-- Discord webhook notifications for movement captures.
-- Assumes:
-- 1. `pg_net` is enabled from Supabase Dashboard -> Database -> Extensions
-- 2. A Vault secret named `discord_movement_webhook_url` already exists
--
-- This patch does NOT replace create_movement_with_lines.
-- It adds:
-- 1. A helper function you can test manually:
--      select public.send_discord_movement_notification('<movement_uuid>');
-- 2. A deferred trigger on public.movements so notifications are sent
--    after the whole movement transaction has finished inserting lines/attachments.

create or replace function public.send_discord_movement_notification(target_movement_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement public.movements%rowtype;
  v_discord_webhook_url text;
  v_notification_text text;
  v_movement_label text;
  v_reported_by_name text;
  v_line_summary text;
  v_notes text;
  v_attachment_count integer;
  v_request_id bigint;
begin
  select *
    into v_movement
  from public.movements
  where id = target_movement_id;

  if not found then
    return null;
  end if;

  select ds.decrypted_secret
    into v_discord_webhook_url
  from vault.decrypted_secrets ds
  where ds.name = 'discord_movement_webhook_url'
  limit 1;

  if coalesce(btrim(v_discord_webhook_url), '') = '' then
    return null;
  end if;

  select
    case v_movement.movement_type
      when 'entrada' then 'Entrada'
      when 'venta' then 'Venta'
      when 'merma' then 'Merma'
      when 'traspaso_sku' then 'Traspaso SKU'
      when 'traspaso_calidad' then 'Traspaso de calidad'
      when 'ajuste' then 'Ajuste'
      else 'Movimiento'
    end,
    coalesce(e.name::text, 'Sin empleado'),
    nullif(btrim(v_movement.notes), ''),
    coalesce(
      (
        with ranked_lines as (
          select
            row_number() over (order by ml.created_at asc, ml.id asc) as rn,
            count(*) over () as total_count,
            concat(
              '- ',
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
          where ml.movement_id = v_movement.id
        )
        select case
          when max(total_count) > 8 then concat(
            string_agg(line_text, E'\n' order by rn) filter (where rn <= 8),
            E'\n... +',
            (max(total_count) - 8)::text,
            ' lineas mas'
          )
          else string_agg(line_text, E'\n' order by rn)
        end
        from ranked_lines
      ),
      '- Sin lineas'
    ),
    (
      select count(*)
      from public.movement_attachments ma
      where ma.movement_id = v_movement.id
    )
  into
    v_movement_label,
    v_reported_by_name,
    v_notes,
    v_line_summary,
    v_attachment_count
  from public.movements m
  left join public.employees e on e.id = v_movement.reported_by_employee_id
  where m.id = v_movement.id;

  v_notification_text := concat(
    '**FST INV | FST',
    v_movement.reference_number::text,
    ' | ',
    coalesce(v_movement_label, 'Movimiento'),
    '**',
    E'\nFecha: ',
    coalesce(v_movement.occurred_at::text, now()::text),
    E'\nReportado por: ',
    coalesce(v_reported_by_name, 'Sin empleado'),
    E'\nLineas:',
    E'\n',
    coalesce(v_line_summary, '- Sin lineas'),
    case when coalesce(v_attachment_count, 0) > 0 then E'\nEvidencia: ' || v_attachment_count::text || ' archivo(s)' else '' end,
    case when v_notes is not null then E'\nNotas: ' || left(v_notes, 400) else '' end
  );

  select net.http_post(
    url := v_discord_webhook_url,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object(
      'content', left(v_notification_text, 1900),
      'allowed_mentions', jsonb_build_object('parse', jsonb_build_array())
    )
  )
  into v_request_id;

  return v_request_id;
exception
  when others then
    return null;
end;
$$;

create or replace function public.notify_discord_movement_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.send_discord_movement_notification(new.id);
  return new;
exception
  when others then
    return new;
end;
$$;

drop trigger if exists trg_notify_discord_movement_insert on public.movements;

create constraint trigger trg_notify_discord_movement_insert
after insert on public.movements
deferrable initially deferred
for each row
execute function public.notify_discord_movement_insert();
