create or replace function public.next_cash_cut_daily_sequence(
  target_workspace_id uuid,
  target_business_date date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  if target_workspace_id is null or target_business_date is null then
    return 1;
  end if;

  perform pg_advisory_xact_lock(hashtext(concat('cash_cut:', target_workspace_id::text, ':', target_business_date::text)));

  select coalesce(max(c.daily_sequence), 0) + 1
    into v_next
  from public.cash_cuts c
  where c.workspace_id = target_workspace_id
    and c.business_date = target_business_date;

  return coalesce(v_next, 1);
end;
$$;

drop function if exists public.create_cash_cut(jsonb, jsonb, jsonb, jsonb);

create function public.create_cash_cut(
  cut jsonb,
  product_lines jsonb,
  denomination_lines jsonb,
  adjustment_lines jsonb
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_cut_id uuid;
  v_business_date date;
  v_started_at timestamptz;
  v_ended_at timestamptz;
  v_cut_type text;
  v_actor_role public.app_role;
  v_actor_employee_id uuid;
  v_actor_workspace_id uuid;
  v_cashier_employee_id uuid;
  v_daily_sequence integer;
  v_exchange_rate numeric(12, 4);
  v_invoice_sale_amount numeric(12, 2);
  v_cash_receipts_amount numeric(12, 2);
  v_refund_receipts_amount numeric(12, 2);
  v_net_cash_sales_amount numeric(12, 2);
  v_credit_invoiced_sales_amount numeric(12, 2);
  v_cash_invoiced_sales_amount numeric(12, 2);
  v_total_invoiced_sales_amount numeric(12, 2);
  v_sales_mxn_amount numeric(12, 2);
  v_sales_usd_amount numeric(12, 2);
  v_iva_zero_amount numeric(12, 2);
  v_ticket_total_amount numeric(12, 2);
  v_sales_usd_mxn_amount numeric(12, 2);
  v_total_mxn_bills_amount numeric(12, 2) := 0;
  v_total_mxn_coins_amount numeric(12, 2) := 0;
  v_total_usd_amount numeric(12, 2) := 0;
  v_total_usd_mxn_amount numeric(12, 2) := 0;
  v_total_counted_cash_amount numeric(12, 2) := 0;
  v_vault_withdrawals jsonb := '[]'::jsonb;
  v_vault_withdrawals_total_amount numeric(12, 2) := 0;
  v_delivered_cash_amount numeric(12, 2) := 0;
  v_total_cash_adjustments_amount numeric(12, 2) := 0;
  v_identified_transfers_amount numeric(12, 2) := 0;
  v_initial_fund_amount numeric(12, 2) := 0;
  v_versatil_cash_count_amount numeric(12, 2) := 0;
  v_expected_cash_amount numeric(12, 2) := 0;
  v_difference_amount numeric(12, 2) := 0;
  v_entry jsonb;
  v_sort_order integer;
  v_currency text;
  v_kind text;
  v_denomination numeric(12, 2);
  v_quantity integer;
  v_line_total numeric(12, 2);
  v_product_label text;
  v_product_amount numeric(12, 2);
  v_product_note text;
  v_adjustment_type public.cash_adjustment_type;
  v_direction public.cash_adjustment_direction;
  v_amount numeric(12, 2);
  v_signed_amount numeric(12, 2);
  v_affects_cash boolean;
  v_support_reference text;
  v_adjustment_note text;
  v_vault_entry jsonb;
  v_vault_reference text;
  v_vault_note text;
  v_vault_denomination_lines jsonb;
  v_vault_line_rows jsonb := '[]'::jsonb;
  v_vault_item_rows jsonb := '[]'::jsonb;
  v_vault_total_mxn_bills_amount numeric(12, 2);
  v_vault_total_mxn_coins_amount numeric(12, 2);
  v_vault_total_usd_amount numeric(12, 2);
  v_vault_total_usd_mxn_amount numeric(12, 2);
  v_vault_total_amount numeric(12, 2);
  v_sequence_retry_count integer := 0;
begin
  if cut is null or jsonb_typeof(cut) <> 'object' then
    raise exception 'cash_cut_required';
  end if;

  if product_lines is null then
    product_lines := '[]'::jsonb;
  end if;
  if denomination_lines is null then
    denomination_lines := '[]'::jsonb;
  end if;
  if adjustment_lines is null then
    adjustment_lines := '[]'::jsonb;
  end if;
  v_vault_withdrawals := coalesce(cut->'vault_withdrawals', '[]'::jsonb);

  if jsonb_typeof(product_lines) <> 'array' then
    raise exception 'cash_cut_product_lines_invalid';
  end if;
  if jsonb_typeof(denomination_lines) <> 'array' then
    raise exception 'cash_cut_denominations_invalid';
  end if;
  if jsonb_typeof(adjustment_lines) <> 'array' then
    raise exception 'cash_cut_adjustments_invalid';
  end if;
  if jsonb_typeof(v_vault_withdrawals) <> 'array' then
    raise exception 'cash_cut_vault_withdrawals_invalid';
  end if;

  v_actor_role := public.current_actor_role();
  v_actor_employee_id := public.current_actor_employee_id();
  v_actor_workspace_id := public.current_actor_workspace_id();
  if v_actor_role is null or v_actor_workspace_id is null then
    raise exception 'cash_cut_actor_invalid';
  end if;

  v_cut_id := coalesce(nullif(cut->>'id', '')::uuid, gen_random_uuid());
  v_business_date := nullif(cut->>'business_date', '')::date;
  v_started_at := nullif(cut->>'started_at', '')::timestamptz;
  v_ended_at := nullif(cut->>'ended_at', '')::timestamptz;
  v_cashier_employee_id := nullif(cut->>'cashier_employee_id', '')::uuid;

  if v_business_date is null then
    raise exception 'cash_cut_business_date_required';
  end if;
  if v_started_at is null or v_ended_at is null then
    raise exception 'cash_cut_time_required';
  end if;
  if v_ended_at < v_started_at then
    raise exception 'cash_cut_time_invalid';
  end if;

  if v_actor_role = 'employee' then
    if v_actor_employee_id is null then
      raise exception 'employee_not_linked';
    end if;
    if v_cashier_employee_id is null then
      v_cashier_employee_id := v_actor_employee_id;
    elsif v_cashier_employee_id <> v_actor_employee_id then
      raise exception 'employee_must_match_linked_employee';
    end if;
  end if;

  if v_cashier_employee_id is not null and not public.employee_is_valid_for_actor(v_cashier_employee_id) then
    raise exception 'employee_invalid';
  end if;

  v_cut_type := coalesce(nullif(btrim(cut->>'cut_type'), ''), 'Corte Z');
  v_exchange_rate := coalesce(nullif(cut->>'exchange_rate', '')::numeric, 17.5);
  v_invoice_sale_amount := coalesce(nullif(cut->>'invoice_sale_amount', '')::numeric, 0);
  v_cash_receipts_amount := coalesce(nullif(cut->>'cash_receipts_amount', '')::numeric, 0);
  v_refund_receipts_amount := coalesce(nullif(cut->>'refund_receipts_amount', '')::numeric, 0);
  v_credit_invoiced_sales_amount := coalesce(nullif(cut->>'credit_invoiced_sales_amount', '')::numeric, 0);
  v_cash_invoiced_sales_amount := coalesce(nullif(cut->>'cash_invoiced_sales_amount', '')::numeric, 0);
  v_sales_mxn_amount := coalesce(nullif(cut->>'sales_mxn_amount', '')::numeric, 0);
  v_sales_usd_amount := coalesce(nullif(cut->>'sales_usd_amount', '')::numeric, 0);
  v_iva_zero_amount := coalesce(nullif(cut->>'iva_zero_amount', '')::numeric, 0);
  v_ticket_total_amount := coalesce(nullif(cut->>'ticket_total_amount', '')::numeric, 0);
  v_versatil_cash_count_amount := coalesce(nullif(cut->>'versatil_cash_count_amount', '')::numeric, 0);
  v_net_cash_sales_amount := round(v_cash_receipts_amount - v_refund_receipts_amount, 2);
  v_total_invoiced_sales_amount := round(v_credit_invoiced_sales_amount + v_cash_invoiced_sales_amount, 2);
  v_sales_usd_mxn_amount := round(v_sales_usd_amount * v_exchange_rate, 2);

  if v_exchange_rate <= 0 then
    raise exception 'cash_cut_exchange_rate_invalid';
  end if;

  if least(
    v_invoice_sale_amount,
    v_cash_receipts_amount,
    v_refund_receipts_amount,
    v_credit_invoiced_sales_amount,
    v_cash_invoiced_sales_amount,
    v_sales_mxn_amount,
    v_sales_usd_amount,
    v_iva_zero_amount,
    v_ticket_total_amount,
    v_versatil_cash_count_amount
  ) < 0 then
    raise exception 'cash_cut_amount_invalid';
  end if;

  loop
    v_daily_sequence := public.next_cash_cut_daily_sequence(v_actor_workspace_id, v_business_date);

    begin
      insert into public.cash_cuts (
        id,
        workspace_id,
        owner_id,
        business_date,
        daily_sequence,
        status,
        cashier_employee_id,
        submitted_by_user_id,
        branch_name,
        cut_type,
        cut_folio,
        started_at,
        ended_at,
        cashier_system_name,
        customers_served,
        ticket_start_folio,
        ticket_end_folio,
        delivered_by,
        received_by,
        observations,
        invoice_sale_amount,
        cash_receipts_amount,
        refund_receipts_amount,
        net_cash_sales_amount,
        credit_invoiced_sales_amount,
        cash_invoiced_sales_amount,
        total_invoiced_sales_amount,
        sales_mxn_amount,
        sales_usd_amount,
        exchange_rate,
        sales_usd_mxn_amount,
        iva_zero_amount,
        ticket_total_amount,
        versatil_cash_count_amount,
        vault_withdrawals,
        vault_withdrawals_total_amount,
        delivered_cash_amount
      ) values (
        v_cut_id,
        v_actor_workspace_id,
        auth.uid(),
        v_business_date,
        v_daily_sequence,
        'submitted',
        v_cashier_employee_id,
        auth.uid(),
        nullif(btrim(cut->>'branch_name'), ''),
        v_cut_type,
        nullif(btrim(cut->>'cut_folio'), ''),
        v_started_at,
        v_ended_at,
        nullif(btrim(cut->>'cashier_system_name'), ''),
        nullif(cut->>'customers_served', '')::integer,
        nullif(btrim(cut->>'ticket_start_folio'), ''),
        nullif(btrim(cut->>'ticket_end_folio'), ''),
        nullif(btrim(cut->>'delivered_by'), ''),
        nullif(btrim(cut->>'received_by'), ''),
        nullif(btrim(cut->>'observations'), ''),
        v_invoice_sale_amount,
        v_cash_receipts_amount,
        v_refund_receipts_amount,
        v_net_cash_sales_amount,
        v_credit_invoiced_sales_amount,
        v_cash_invoiced_sales_amount,
        v_total_invoiced_sales_amount,
        v_sales_mxn_amount,
        v_sales_usd_amount,
        v_exchange_rate,
        v_sales_usd_mxn_amount,
        v_iva_zero_amount,
        v_ticket_total_amount,
        v_versatil_cash_count_amount,
        '[]'::jsonb,
        0,
        0
      );
      exit;
    exception
      when unique_violation then
        v_sequence_retry_count := v_sequence_retry_count + 1;
        if v_sequence_retry_count >= 5 then
          raise;
        end if;
    end;
  end loop;

  v_sort_order := 0;
  for v_entry in
    select value from jsonb_array_elements(product_lines)
  loop
    v_sort_order := v_sort_order + 1;
    v_product_label := nullif(btrim(v_entry->>'product_label'), '');
    v_product_amount := coalesce(nullif(v_entry->>'amount', '')::numeric, 0);
    v_product_note := nullif(btrim(v_entry->>'note'), '');
    if v_product_label is null and v_product_amount = 0 and v_product_note is null then
      continue;
    end if;
    if v_product_label is null then
      raise exception 'cash_cut_product_label_required';
    end if;
    if v_product_amount < 0 then
      raise exception 'cash_cut_product_amount_invalid';
    end if;

    insert into public.cash_cut_product_lines (
      cash_cut_id,
      owner_id,
      sort_order,
      product_label,
      amount,
      note
    ) values (
      v_cut_id,
      auth.uid(),
      v_sort_order,
      v_product_label,
      v_product_amount,
      v_product_note
    );
  end loop;

  v_sort_order := 0;
  for v_entry in
    select value from jsonb_array_elements(denomination_lines)
  loop
    v_sort_order := v_sort_order + 1;
    v_currency := upper(coalesce(nullif(btrim(v_entry->>'currency'), ''), ''));
    v_kind := lower(coalesce(nullif(btrim(v_entry->>'kind'), ''), ''));
    v_denomination := coalesce(nullif(v_entry->>'denomination', '')::numeric, 0);
    v_quantity := coalesce(nullif(v_entry->>'quantity', '')::integer, 0);

    if v_currency not in ('MXN', 'USD') then
      raise exception 'cash_cut_denom_currency_invalid';
    end if;
    if v_kind not in ('bill', 'coin') then
      raise exception 'cash_cut_denom_kind_invalid';
    end if;
    if v_denomination <= 0 or v_quantity < 0 then
      raise exception 'cash_cut_denom_invalid';
    end if;

    v_line_total := round(v_denomination * v_quantity, 2);

    insert into public.cash_cut_denominations (
      cash_cut_id,
      owner_id,
      sort_order,
      currency,
      kind,
      denomination,
      quantity,
      line_total
    ) values (
      v_cut_id,
      auth.uid(),
      v_sort_order,
      v_currency,
      v_kind,
      v_denomination,
      v_quantity,
      v_line_total
    );

    if v_currency = 'MXN' and v_kind = 'bill' then
      v_total_mxn_bills_amount := v_total_mxn_bills_amount + v_line_total;
    elsif v_currency = 'MXN' and v_kind = 'coin' then
      v_total_mxn_coins_amount := v_total_mxn_coins_amount + v_line_total;
    else
      v_total_usd_amount := v_total_usd_amount + v_line_total;
    end if;
  end loop;

  v_total_usd_mxn_amount := round(v_total_usd_amount * v_exchange_rate, 2);
  v_total_counted_cash_amount := round(v_total_mxn_bills_amount + v_total_mxn_coins_amount + v_total_usd_mxn_amount, 2);

  for v_vault_entry in
    select value from jsonb_array_elements(v_vault_withdrawals)
  loop
    v_vault_reference := nullif(btrim(v_vault_entry->>'reference_label'), '');
    v_vault_note := nullif(btrim(v_vault_entry->>'note'), '');
    v_vault_denomination_lines := coalesce(v_vault_entry->'denomination_lines', '[]'::jsonb);
    v_vault_line_rows := '[]'::jsonb;
    v_vault_total_mxn_bills_amount := 0;
    v_vault_total_mxn_coins_amount := 0;
    v_vault_total_usd_amount := 0;

    if jsonb_typeof(v_vault_denomination_lines) <> 'array' then
      raise exception 'cash_cut_vault_withdrawals_invalid';
    end if;

    for v_entry in
      select value from jsonb_array_elements(v_vault_denomination_lines)
    loop
      v_currency := upper(coalesce(nullif(btrim(v_entry->>'currency'), ''), ''));
      v_kind := lower(coalesce(nullif(btrim(v_entry->>'kind'), ''), ''));
      v_denomination := coalesce(nullif(v_entry->>'denomination', '')::numeric, 0);
      v_quantity := coalesce(nullif(v_entry->>'quantity', '')::integer, 0);

      if v_currency not in ('MXN', 'USD') or v_kind not in ('bill', 'coin') or v_denomination <= 0 or v_quantity < 0 then
        raise exception 'cash_cut_vault_withdrawal_denom_invalid';
      end if;

      v_line_total := round(v_denomination * v_quantity, 2);
      v_vault_line_rows := v_vault_line_rows || jsonb_build_array(
        jsonb_build_object(
          'currency', v_currency,
          'kind', v_kind,
          'denomination', v_denomination,
          'quantity', v_quantity,
          'line_total', v_line_total
        )
      );

      if v_currency = 'MXN' and v_kind = 'bill' then
        v_vault_total_mxn_bills_amount := v_vault_total_mxn_bills_amount + v_line_total;
      elsif v_currency = 'MXN' and v_kind = 'coin' then
        v_vault_total_mxn_coins_amount := v_vault_total_mxn_coins_amount + v_line_total;
      else
        v_vault_total_usd_amount := v_vault_total_usd_amount + v_line_total;
      end if;
    end loop;

    v_vault_total_usd_mxn_amount := round(v_vault_total_usd_amount * v_exchange_rate, 2);
    v_vault_total_amount := round(v_vault_total_mxn_bills_amount + v_vault_total_mxn_coins_amount + v_vault_total_usd_mxn_amount, 2);

    if v_vault_reference is null and v_vault_note is null and v_vault_total_amount = 0 then
      continue;
    end if;

    v_vault_item_rows := v_vault_item_rows || jsonb_build_array(
      jsonb_build_object(
        'reference_label', v_vault_reference,
        'note', v_vault_note,
        'total_mxn_bills_amount', round(v_vault_total_mxn_bills_amount, 2),
        'total_mxn_coins_amount', round(v_vault_total_mxn_coins_amount, 2),
        'total_mxn_amount', round(v_vault_total_mxn_bills_amount + v_vault_total_mxn_coins_amount, 2),
        'total_usd_amount', round(v_vault_total_usd_amount, 2),
        'total_usd_mxn_amount', v_vault_total_usd_mxn_amount,
        'total_comparable_amount', v_vault_total_amount,
        'denomination_lines', v_vault_line_rows
      )
    );
    v_vault_withdrawals_total_amount := v_vault_withdrawals_total_amount + v_vault_total_amount;
  end loop;

  v_vault_withdrawals_total_amount := round(v_vault_withdrawals_total_amount, 2);
  v_delivered_cash_amount := round(v_total_counted_cash_amount + v_vault_withdrawals_total_amount, 2);

  v_sort_order := 0;
  for v_entry in
    select value from jsonb_array_elements(adjustment_lines)
  loop
    v_sort_order := v_sort_order + 1;
    if nullif(btrim(v_entry->>'adjustment_type'), '') is null then
      continue;
    end if;

    v_adjustment_type := (v_entry->>'adjustment_type')::public.cash_adjustment_type;
    v_direction := nullif(v_entry->>'direction', '')::public.cash_adjustment_direction;
    v_amount := coalesce(nullif(v_entry->>'amount', '')::numeric, 0);
    v_support_reference := nullif(btrim(v_entry->>'support_reference'), '');
    v_adjustment_note := nullif(btrim(v_entry->>'note'), '');

    if v_amount < 0 then
      raise exception 'cash_cut_adjustment_amount_invalid';
    end if;

    case v_adjustment_type
      when 'fondo_inicial' then
        v_affects_cash := false;
        v_signed_amount := v_amount;
        v_initial_fund_amount := v_amount;
      when 'reembolso_dia' then
        v_affects_cash := false;
        v_signed_amount := -v_amount;
      when 'gasto_caja' then
        v_affects_cash := true;
        v_signed_amount := -v_amount;
      when 'retiro_boveda' then
        v_amount := v_vault_withdrawals_total_amount;
        v_affects_cash := false;
        v_signed_amount := v_amount;
      when 'deposito_retiro_parcial' then
        v_affects_cash := true;
        v_signed_amount := case when coalesce(v_direction, 'entrada') = 'salida' then -v_amount else v_amount end;
      when 'vale_comprobante' then
        v_affects_cash := true;
        v_signed_amount := case when coalesce(v_direction, 'salida') = 'salida' then -v_amount else v_amount end;
      when 'cheque' then
        v_affects_cash := true;
        v_signed_amount := case when coalesce(v_direction, 'entrada') = 'salida' then -v_amount else v_amount end;
      when 'transferencia_identificada' then
        v_affects_cash := false;
        v_signed_amount := case when coalesce(v_direction, 'entrada') = 'salida' then -v_amount else v_amount end;
      when 'otro_ajuste' then
        v_affects_cash := true;
        v_signed_amount := case when coalesce(v_direction, 'entrada') = 'salida' then -v_amount else v_amount end;
      else
        raise exception 'cash_cut_adjustment_type_invalid';
    end case;

    insert into public.cash_cut_adjustments (
      cash_cut_id,
      owner_id,
      sort_order,
      adjustment_type,
      direction,
      amount,
      signed_amount,
      affects_cash,
      support_reference,
      note
    ) values (
      v_cut_id,
      auth.uid(),
      v_sort_order,
      v_adjustment_type,
      v_direction,
      v_amount,
      v_signed_amount,
      v_affects_cash,
      v_support_reference,
      v_adjustment_note
    );

    if v_adjustment_type = 'fondo_inicial' then
      null;
    elsif v_adjustment_type = 'retiro_boveda' then
      null;
    elsif v_adjustment_type = 'reembolso_dia' then
      null;
    elsif v_affects_cash then
      v_total_cash_adjustments_amount := v_total_cash_adjustments_amount + v_signed_amount;
    else
      v_identified_transfers_amount := v_identified_transfers_amount + v_signed_amount;
    end if;
  end loop;

  v_expected_cash_amount := round(v_initial_fund_amount + v_net_cash_sales_amount + v_total_cash_adjustments_amount, 2);
  v_difference_amount := round(v_delivered_cash_amount - v_versatil_cash_count_amount, 2);

  update public.cash_cuts
  set
    total_mxn_bills_amount = round(v_total_mxn_bills_amount, 2),
    total_mxn_coins_amount = round(v_total_mxn_coins_amount, 2),
    total_usd_amount = round(v_total_usd_amount, 2),
    total_usd_mxn_amount = v_total_usd_mxn_amount,
    total_counted_cash_amount = v_total_counted_cash_amount,
    vault_withdrawals = v_vault_item_rows,
    vault_withdrawals_total_amount = v_vault_withdrawals_total_amount,
    delivered_cash_amount = v_delivered_cash_amount,
    total_cash_adjustments_amount = round(v_total_cash_adjustments_amount, 2),
    identified_transfers_amount = round(v_identified_transfers_amount, 2),
    initial_fund_amount = round(v_initial_fund_amount, 2),
    versatil_cash_count_amount = round(v_versatil_cash_count_amount, 2),
    expected_cash_amount = v_expected_cash_amount,
    difference_amount = v_difference_amount
  where id = v_cut_id;

  return jsonb_build_object(
    'id', v_cut_id,
    'business_date', v_business_date,
    'daily_sequence', v_daily_sequence,
    'vault_withdrawals_total_amount', v_vault_withdrawals_total_amount,
    'delivered_cash_amount', v_delivered_cash_amount
  );
end;
$$;

alter table public.cash_cuts enable row level security;
alter table public.cash_cut_product_lines enable row level security;
alter table public.cash_cut_denominations enable row level security;
update public.cash_cuts
set
  initial_fund_amount = coalesce(initial_fund_amount, 0),
  vault_withdrawals = coalesce(vault_withdrawals, '[]'::jsonb),
  vault_withdrawals_total_amount = coalesce(vault_withdrawals_total_amount, 0),
  delivered_cash_amount = round(coalesce(total_counted_cash_amount, 0) + coalesce(vault_withdrawals_total_amount, 0), 2),
  versatil_cash_count_amount = coalesce(versatil_cash_count_amount, 0),
  difference_amount = round((coalesce(total_counted_cash_amount, 0) + coalesce(vault_withdrawals_total_amount, 0)) - coalesce(versatil_cash_count_amount, 0), 2);

alter table public.cash_cut_adjustments enable row level security;

drop policy if exists cash_cuts_select_manager on public.cash_cuts;
create policy cash_cuts_select_manager
on public.cash_cuts for select
to authenticated
using (
  public.current_actor_role() = 'manager'
  and workspace_id = public.current_actor_workspace_id()
);

drop policy if exists cash_cuts_insert_actor on public.cash_cuts;
create policy cash_cuts_insert_actor
on public.cash_cuts for insert
to authenticated
with check (
  public.current_actor_role() in ('manager', 'employee')
  and owner_id = auth.uid()
);

drop policy if exists cash_cuts_update_manager on public.cash_cuts;
create policy cash_cuts_update_manager
on public.cash_cuts for update
to authenticated
using (
  public.current_actor_role() = 'manager'
  and workspace_id = public.current_actor_workspace_id()
)
with check (
  public.current_actor_role() = 'manager'
  and workspace_id = public.current_actor_workspace_id()
);

drop policy if exists cash_cuts_delete_manager on public.cash_cuts;
create policy cash_cuts_delete_manager
on public.cash_cuts for delete
to authenticated
using (
  public.current_actor_role() = 'manager'
  and workspace_id = public.current_actor_workspace_id()
);

drop policy if exists cash_cut_product_lines_select_manager on public.cash_cut_product_lines;
create policy cash_cut_product_lines_select_manager
on public.cash_cut_product_lines for select
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_cash_cut(cash_cut_id)
);

drop policy if exists cash_cut_product_lines_insert_actor on public.cash_cut_product_lines;
create policy cash_cut_product_lines_insert_actor
on public.cash_cut_product_lines for insert
to authenticated
with check (
  owner_id = auth.uid()
  and public.current_actor_role() in ('manager', 'employee')
  and public.actor_can_access_cash_cut(cash_cut_id)
);

drop policy if exists cash_cut_product_lines_update_manager on public.cash_cut_product_lines;
create policy cash_cut_product_lines_update_manager
on public.cash_cut_product_lines for update
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_cash_cut(cash_cut_id)
)
with check (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_cash_cut(cash_cut_id)
);

drop policy if exists cash_cut_product_lines_delete_manager on public.cash_cut_product_lines;
create policy cash_cut_product_lines_delete_manager
on public.cash_cut_product_lines for delete
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_cash_cut(cash_cut_id)
);

drop policy if exists cash_cut_denominations_select_manager on public.cash_cut_denominations;
create policy cash_cut_denominations_select_manager
on public.cash_cut_denominations for select
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_cash_cut(cash_cut_id)
);

drop policy if exists cash_cut_denominations_insert_actor on public.cash_cut_denominations;
create policy cash_cut_denominations_insert_actor
on public.cash_cut_denominations for insert
to authenticated
with check (
  owner_id = auth.uid()
  and public.current_actor_role() in ('manager', 'employee')
  and public.actor_can_access_cash_cut(cash_cut_id)
);

drop policy if exists cash_cut_denominations_update_manager on public.cash_cut_denominations;
create policy cash_cut_denominations_update_manager
on public.cash_cut_denominations for update
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_cash_cut(cash_cut_id)
)
with check (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_cash_cut(cash_cut_id)
);

drop policy if exists cash_cut_denominations_delete_manager on public.cash_cut_denominations;
create policy cash_cut_denominations_delete_manager
on public.cash_cut_denominations for delete
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_cash_cut(cash_cut_id)
);

drop policy if exists cash_cut_adjustments_select_manager on public.cash_cut_adjustments;
create policy cash_cut_adjustments_select_manager
on public.cash_cut_adjustments for select
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_cash_cut(cash_cut_id)
);

drop policy if exists cash_cut_adjustments_insert_actor on public.cash_cut_adjustments;
create policy cash_cut_adjustments_insert_actor
on public.cash_cut_adjustments for insert
to authenticated
with check (
  owner_id = auth.uid()
  and public.current_actor_role() in ('manager', 'employee')
  and public.actor_can_access_cash_cut(cash_cut_id)
);

drop policy if exists cash_cut_adjustments_update_manager on public.cash_cut_adjustments;
create policy cash_cut_adjustments_update_manager
on public.cash_cut_adjustments for update
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_cash_cut(cash_cut_id)
)
with check (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_cash_cut(cash_cut_id)
);

drop policy if exists cash_cut_adjustments_delete_manager on public.cash_cut_adjustments;
create policy cash_cut_adjustments_delete_manager
on public.cash_cut_adjustments for delete
to authenticated
using (
  public.current_actor_role() = 'manager'
  and public.actor_can_access_cash_cut(cash_cut_id)
);

grant usage on type public.cash_cut_status to authenticated;
grant usage on type public.cash_adjustment_type to authenticated;
grant usage on type public.cash_adjustment_direction to authenticated;

grant select, insert, update, delete on table public.cash_cuts to authenticated;
grant select, insert, update, delete on table public.cash_cut_product_lines to authenticated;
grant select, insert, update, delete on table public.cash_cut_denominations to authenticated;
grant select, insert, update, delete on table public.cash_cut_adjustments to authenticated;

revoke all on function public.create_cash_cut(jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.create_cash_cut(jsonb, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.next_cash_cut_daily_sequence(uuid, date) to authenticated;
