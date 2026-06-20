-- Documents can attach to a specific passenger (passport/ID), not just the trip.
-- Null passenger_id = trip-level document (contract, etc.).
alter table public.scheduling_documents
  add column if not exists passenger_id uuid references public.scheduling_passengers(id) on delete cascade;
create index if not exists scheduling_documents_passenger_idx on public.scheduling_documents (passenger_id);
