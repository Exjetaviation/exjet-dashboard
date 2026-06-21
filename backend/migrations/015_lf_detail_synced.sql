-- Track when a person's full LevelFlight detail (DOB/weight/documents/scans) was
-- last pulled, so the recurring sync can enrich un-synced people in bounded
-- batches instead of re-fetching all ~900 customer details every tick.
alter table public.scheduling_people
  add column if not exists lf_detail_synced_at timestamptz;
-- Partial index: quickly find LF people still needing a detail pull.
create index if not exists scheduling_people_needs_detail_idx
  on public.scheduling_people (id)
  where lf_oid is not null and lf_detail_synced_at is null;
