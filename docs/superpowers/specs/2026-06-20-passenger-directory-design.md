# Persistent Passenger Directory — Design

**Date:** 2026-06-20
**Module:** `backend/src/scheduling/` + `frontend/src/pages/scheduling/`
**Status:** Approved design, ready for implementation planning

## Problem

Passengers today are **per-trip rows** (`scheduling_passengers.trip_id NOT NULL`). A passenger isn't a person in the system — they're re-entered every trip. DOB, weight, and uploaded travel documents (passport, green card, ID) are captured per trip and don't follow the person to their next trip. `GET /passengers/suggest` only *softens* re-entry by autofilling DOB/weight from prior rows.

We want a **persistent passenger directory**: a passenger becomes a first-class *person* whose identity and travel documents live once and are referenced by every trip.

## Decisions (from brainstorming)

1. **Identity model: manual pick + explicit add.** No auto-matching. The dispatcher either picks an existing person from the directory or explicitly clicks "Add new person." Zero wrong-merge risk; duplicates are fixed by hand later.
2. **Existing data: backfill + carry documents.** A one-time migration creates a person per distinct existing passenger and re-homes their uploaded docs onto the person, so the directory is populated on day one.
3. **Document files: re-home (Approach A).** Person travel-doc files physically move to `people/{person_id}/…`. Keeps "documents belong to the person" honest for deletes and future client-app exposure.
4. **Merge-duplicates UI: deferred.** Schema supports merging (re-point `person_id`s); no merge UI in v1.
5. **API scope: scheduling-web only.** Clean REST the future client/pilot apps can reuse; no app-specific concerns baked in now.
6. **Per-trip vs person split (validated visually):**
   - **Person (read-only on the manifest, edited on the profile):** name, DOB, **weight**, all identity + travel credentials.
   - **Per-trip (editable on the manifest):** bags/cargo, seat, TSA status, trip note.
7. **Profile fields:** Identity includes **middle name** (TSA Secure Flight exact match) and **citizenship** (distinct from nationality).
8. **Expiry warnings: yes.** Warn when a passport/visa/green card expires before — or within 6 months of — a booked trip.

## Prerequisites (verify before implementing)

- **Migrations 012 (`scheduling_documents`) and 013 (`passenger_documents`) applied** in Supabase, and the **private `scheduling-docs` Storage bucket exists.** The document backfill (decision 2/3) depends on these being live. *Status unconfirmed at design time — verify as step zero.*

## Data Model

### New table: `scheduling_people`

The canonical person. Mirrors the existing provenance pattern (`origin`, nullable `lf_oid` for a future LF-customer seed).

| Group | Columns |
|---|---|
| Identity | `first_name`, `middle_name`, `last_name`, `dob` (date), `gender`, `nationality`, `citizenship`, `weight_lbs` (numeric), `email`, `phone` |
| Travel credentials | `passport_number`, `passport_country`, `passport_expiry` (date), `green_card_number`, `green_card_expiry` (date), `visa_number`, `visa_expiry` (date), `known_traveler_number`, `redress_number` |
| Meta | `id` (uuid pk), `notes`, `origin` (text default `native`, check `native`/`levelflight`), `lf_oid` (text unique, null), `created_at`, `updated_at`, `modified_by`, `modified_at` |

Sensitive number fields (`passport_number`, `green_card_number`, `known_traveler_number`, `redress_number`) are PII — masked in the UI, never logged.

### `scheduling_passengers` — becomes a thin per-trip join

- **Add** `person_id` (uuid, FK → `scheduling_people`, `ON DELETE RESTRICT`) and `seat` (text).
- **Keep** per-trip fields: `cargo_lbs` (bags), `tsa_status`, `note`.
- **Demote** `name`, `dob`, `weight_lbs`: columns remain for backward-compat but are **no longer the source of truth** — identity reads from the joined person. Safe because there are currently **zero** LF-synced passengers (passengers were deferred in LF mapping); every existing row is native and gets a `person_id` in the migration.

### `scheduling_documents` — gains person ownership

- **Add** `person_id` (uuid, FK → `scheduling_people`, `ON DELETE CASCADE`).
- A document is **person-level** if `person_id` is set (passport/green card/visa/id — reused on every trip) or **trip-level** if only `trip_id` is set (contract/quote/handling).
- **Extend** `doc_type` with `passport | green_card | visa | id` (alongside existing `contract | quote | passenger_id | handling | other`).
- **Storage layout:** person docs at `people/{person_id}/{ts}-{name}`; trip docs stay at `{trip_id}/{ts}-{name}` (unchanged).

## API — `/api/scheduling/people` (new) + manifest rework

All writes are gated by `requireSchedulingEditor`. Reads follow the module's open-read convention.

| Method | Route | Purpose |
|---|---|---|
| GET | `/people?q=&limit=` | Directory search (name + DOB). Returns person summaries + `documentAlerts` (expiry flags) + trip count. |
| GET | `/people/:id` | Full profile + documents (short-lived signed URLs) + trip history. |
| POST | `/people` | Create a person. |
| PATCH | `/people/:id` | Update a person. |
| DELETE | `/people/:id` | Delete; returns **409** if the person is on any trip (`ON DELETE RESTRICT`). |
| POST | `/people/:id/documents` | Upload a person document (base64 JSON, same pattern as trip docs). |
| DELETE | `/documents/:id` | Existing route — already handles storage + row removal; works for person docs unchanged. |

**Manifest endpoints** (`GET`/`PUT /trips/:lfOid/passengers`):
- `GET` **joins the person** and returns identity (name/DOB/weight) + per-trip fields + a per-passenger doc/expiry indicator.
- `PUT` accepts rows carrying `person_id` + per-trip fields (`cargo_lbs`, `seat`, `tsa_status`, `note`). Preserves the existing id-preserving upsert so per-trip rows survive manifest edits.
- "Add new person" inline = client `POST /people`, then `PUT` the manifest with the returned `person_id`.
- `GET /passengers/suggest` is **superseded** by `GET /people` (kept but deprecated; the picker uses `/people`).

## Migration 014 (schema + data) + one-time re-home script

1. **SQL schema:** create `scheduling_people`; add `person_id`/`seat` to `scheduling_passengers`; add `person_id` to `scheduling_documents`.
2. **SQL backfill:** insert one person per distinct `(name, dob)` from existing passengers; set `passengers.person_id`; set `documents.person_id` via the passenger each doc was attached to. Null-DOB rows group by `name` (best-effort; fixable by hand later).
3. **`scripts/rehomePassengerDocs.mjs`:** a one-time Node script that moves the actual Storage files into `people/{person_id}/…` and updates `storage_path` (the file move cannot happen in SQL). Idempotent and re-runnable.

The grouping/dedup logic used in step 2 is extracted as a **pure function** so it can be unit-tested independently of the DB.

## Expiry Warnings — `backend/src/scheduling/docExpiry.js` (pure)

`documentAlerts(person, upcomingTripDates, now)` → structured flags:
- **Red — expired / expires-before-trip:** a credential's expiry is earlier than a booked trip's date.
- **Amber — 6-month rule:** passport valid but expires within 6 months of a booked trip (common international entry requirement).
- **No booked trips:** still surface a plain "expired" badge (no trip-linked severity).

Computed server-side in the `people` endpoints (joining the person's booked trips) so the directory, profile, and manifest show consistent flags. Pure and table-tested like `flightTime.js`.

## Frontend

1. **Passengers directory** — `frontend/src/pages/scheduling/People.jsx`, added to the Scheduling sub-nav as **"Passengers"** (separate from **Clients**, which remains the company CRM). Searchable list from `GET /people`; rows show name, DOB, passport indicator, expiry flag. Click → profile.
2. **Person profile** — `frontend/src/pages/scheduling/PersonProfile.jsx`, route `/scheduling/people/:id`. Four sections: Identity (incl. middle name + citizenship), Travel credentials, Documents (upload/delete, reused across trips), Trip history. Editable behind `requireSchedulingEditor`. PII numbers render masked with click-to-reveal.
3. **Manifest rework** — rebuild the Passengers section of `SchedulingTripDetail.jsx`: search box → `GET /people` (results show DOB + passport status), `add →` per result, **+ Add new person** inline mini-form (`POST /people` then add). Manifest table keeps the blue (person, read-only) / purple (per-trip, editable) split.

## Testing

Follows the existing `node --test backend/src/scheduling/*.test.js` pattern.

- `docExpiry.test.js` — expired, expires-before-trip, 6-month boundary, no-trips, null dates.
- `peopleBackfill.test.js` — pure dedup/grouping: distinct `(name, dob)`, null-DOB-by-name, doc→person mapping.
- `peopleSearch.test.js` — directory ranking (prefix/name match).
- People CRUD + manifest join verified against the existing route test harness; any new frontend aggregation lib gets pure tests.

## Error Handling

Reuses module conventions: `isNotFound` → 404, `requireSchedulingEditor` on all writes, signed-URL generation for docs, the existing "bucket missing" message, and **409 on person-delete** when the person is still on a trip.

## Out of Scope (v1)

- Merge-duplicates UI (schema supports it; defer).
- Seeding people from the LevelFlight customer directory (the `lf_oid`/`origin` columns leave the door open).
- Per-leg passenger assignment (manifest stays per-trip, as today).
- Client/pilot mobile app consumption (REST stays clean for later reuse).
