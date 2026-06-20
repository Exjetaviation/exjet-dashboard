-- Trip-level documents (contracts, signed quotes, passenger IDs, handling sheets).
-- Files live in the private Supabase Storage bucket 'scheduling-docs'; this table
-- is the metadata index. storage_path is the object key within that bucket.
create table if not exists public.scheduling_documents (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.scheduling_trips(id) on delete cascade,
  name          text not null,
  doc_type      text,                 -- contract | quote | passenger_id | handling | other
  storage_path  text not null,
  content_type  text,
  size_bytes    bigint,
  uploaded_by   text,
  created_at    timestamptz not null default now()
);
create index if not exists scheduling_documents_trip_idx on public.scheduling_documents (trip_id);
