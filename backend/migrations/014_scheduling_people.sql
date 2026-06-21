-- backend/migrations/014_scheduling_people.sql
-- Persistent passenger directory. Passengers become first-class people whose
-- identity + travel documents are reused across trips. scheduling_passengers
-- becomes a thin per-trip join; scheduling_documents can attach to a person.

create table if not exists public.scheduling_people (
  id                    uuid primary key default gen_random_uuid(),
  first_name            text,
  middle_name           text,
  last_name             text,
  dob                   date,
  gender                text,
  nationality           text,
  citizenship           text,
  weight_lbs            numeric,
  email                 text,
  phone                 text,
  passport_number       text,
  passport_country      text,
  passport_expiry       date,
  green_card_number     text,
  green_card_expiry     date,
  visa_number           text,
  visa_expiry           date,
  known_traveler_number text,
  redress_number        text,
  notes                 text,
  origin                text not null default 'native' check (origin in ('levelflight', 'native')),
  lf_oid                text unique,
  modified_by           text,
  modified_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists scheduling_people_name_idx on public.scheduling_people (last_name, first_name);

-- Passengers: thin per-trip join + per-trip overrides.
alter table public.scheduling_passengers
  add column if not exists person_id uuid references public.scheduling_people(id) on delete restrict,
  add column if not exists seat text;
create index if not exists scheduling_passengers_person_idx on public.scheduling_passengers (person_id);

-- Documents: can belong to a person (reused across trips). A person document has
-- no trip, so trip_id must be nullable now.
alter table public.scheduling_documents
  add column if not exists person_id uuid references public.scheduling_people(id) on delete cascade;
alter table public.scheduling_documents
  alter column trip_id drop not null;
create index if not exists scheduling_documents_person_idx on public.scheduling_documents (person_id);

-- I2: A document must belong to a trip OR a person (idempotent guard).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'scheduling_documents_owner_check') then
    alter table public.scheduling_documents
      add constraint scheduling_documents_owner_check check (trip_id is not null or person_id is not null);
  end if;
end $$;
