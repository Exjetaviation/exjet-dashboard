-- Fuel surcharge is charged per flight hour in LevelFlight (rate.fuelSurcharge),
-- not as a percent. Replaces the surcharge_pct field from migration 010.
alter table rate_cards add column if not exists surcharge_per_hr numeric not null default 0;
