-- Patch: physical inventory cutoffs (cortes fisicos)
-- Run this once in Supabase SQL Editor for existing deployments.

create table if not exists public.physical_cutoffs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint physical_cutoffs_time_check check (ended_at is null or ended_at >= started_at)
);

drop trigger if exists trg_physical_cutoffs_set_updated_at on public.physical_cutoffs;
create trigger trg_physical_cutoffs_set_updated_at
before update on public.physical_cutoffs
for each row execute function public.set_updated_at();

create index if not exists physical_cutoffs_owner_started_idx
  on public.physical_cutoffs (owner_id, started_at desc);

create table if not exists public.physical_cutoff_lines (
  id uuid primary key default gen_random_uuid(),
  cutoff_id uuid not null references public.physical_cutoffs(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sku_id uuid not null references public.skus(id),
  measured_at timestamptz not null default now(),
  weight_kg numeric(12, 3) not null,
  notes text,
  created_at timestamptz not null default now(),
  constraint physical_cutoff_weight_nonnegative check (weight_kg >= 0)
);

create index if not exists physical_cutoff_lines_cutoff_measured_idx
  on public.physical_cutoff_lines (cutoff_id, measured_at asc);

create index if not exists physical_cutoff_lines_owner_measured_idx
  on public.physical_cutoff_lines (owner_id, measured_at desc);

create index if not exists physical_cutoff_lines_sku_idx
  on public.physical_cutoff_lines (sku_id);

create table if not exists public.physical_cutoff_attachments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cutoff_line_id uuid not null references public.physical_cutoff_lines(id) on delete cascade,
  storage_bucket text not null default 'physical-cutoff-proofs',
  storage_path text not null,
  original_filename text,
  content_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create index if not exists physical_cutoff_attachments_line_idx
  on public.physical_cutoff_attachments (cutoff_line_id);

alter table public.physical_cutoffs enable row level security;
alter table public.physical_cutoff_lines enable row level security;
alter table public.physical_cutoff_attachments enable row level security;

drop policy if exists physical_cutoffs_select_own on public.physical_cutoffs;
create policy physical_cutoffs_select_own
on public.physical_cutoffs for select
to authenticated
using (owner_id = auth.uid());

drop policy if exists physical_cutoffs_insert_own on public.physical_cutoffs;
create policy physical_cutoffs_insert_own
on public.physical_cutoffs for insert
to authenticated
with check (owner_id = auth.uid());

drop policy if exists physical_cutoffs_update_own on public.physical_cutoffs;
create policy physical_cutoffs_update_own
on public.physical_cutoffs for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists physical_cutoffs_delete_own on public.physical_cutoffs;
create policy physical_cutoffs_delete_own
on public.physical_cutoffs for delete
to authenticated
using (owner_id = auth.uid());

drop policy if exists physical_cutoff_lines_select_own on public.physical_cutoff_lines;
create policy physical_cutoff_lines_select_own
on public.physical_cutoff_lines for select
to authenticated
using (owner_id = auth.uid());

drop policy if exists physical_cutoff_lines_insert_own on public.physical_cutoff_lines;
create policy physical_cutoff_lines_insert_own
on public.physical_cutoff_lines for insert
to authenticated
with check (
  owner_id = auth.uid()
  and exists (
    select 1
    from public.physical_cutoffs c
    where c.id = cutoff_id
      and c.owner_id = auth.uid()
  )
  and exists (
    select 1
    from public.skus s
    where s.id = sku_id
      and s.owner_id = auth.uid()
  )
);

drop policy if exists physical_cutoff_lines_update_own on public.physical_cutoff_lines;
create policy physical_cutoff_lines_update_own
on public.physical_cutoff_lines for update
to authenticated
using (owner_id = auth.uid())
with check (
  owner_id = auth.uid()
  and exists (
    select 1
    from public.physical_cutoffs c
    where c.id = cutoff_id
      and c.owner_id = auth.uid()
  )
  and exists (
    select 1
    from public.skus s
    where s.id = sku_id
      and s.owner_id = auth.uid()
  )
);

drop policy if exists physical_cutoff_lines_delete_own on public.physical_cutoff_lines;
create policy physical_cutoff_lines_delete_own
on public.physical_cutoff_lines for delete
to authenticated
using (owner_id = auth.uid());

drop policy if exists physical_cutoff_attachments_select_own on public.physical_cutoff_attachments;
create policy physical_cutoff_attachments_select_own
on public.physical_cutoff_attachments for select
to authenticated
using (owner_id = auth.uid());

drop policy if exists physical_cutoff_attachments_insert_own on public.physical_cutoff_attachments;
create policy physical_cutoff_attachments_insert_own
on public.physical_cutoff_attachments for insert
to authenticated
with check (
  owner_id = auth.uid()
  and exists (
    select 1
    from public.physical_cutoff_lines l
    where l.id = cutoff_line_id
      and l.owner_id = auth.uid()
  )
);

drop policy if exists physical_cutoff_attachments_delete_own on public.physical_cutoff_attachments;
create policy physical_cutoff_attachments_delete_own
on public.physical_cutoff_attachments for delete
to authenticated
using (owner_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('physical-cutoff-proofs', 'physical-cutoff-proofs', false)
on conflict (id) do nothing;

drop policy if exists storage_read_own_cutoff_proofs on storage.objects;
create policy storage_read_own_cutoff_proofs
on storage.objects for select
to authenticated
using (
  bucket_id = 'physical-cutoff-proofs'
  and owner = auth.uid()
);

drop policy if exists storage_upload_own_cutoff_proofs on storage.objects;
create policy storage_upload_own_cutoff_proofs
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'physical-cutoff-proofs'
  and owner = auth.uid()
);

drop policy if exists storage_delete_own_cutoff_proofs on storage.objects;
create policy storage_delete_own_cutoff_proofs
on storage.objects for delete
to authenticated
using (
  bucket_id = 'physical-cutoff-proofs'
  and owner = auth.uid()
);

grant select, insert, update, delete on table public.physical_cutoffs to authenticated;
grant select, insert, update, delete on table public.physical_cutoff_lines to authenticated;
grant select, insert, delete on table public.physical_cutoff_attachments to authenticated;
