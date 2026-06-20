-- LevelFlight-style itemized pricing fields on rate cards.
alter table rate_cards add column if not exists surcharge_pct numeric not null default 0;  -- e.g. 0.20 = 20% fuel surcharge on flight cost
alter table rate_cards add column if not exists fa_fee       numeric not null default 0;   -- per flight attendant
alter table rate_cards add column if not exists crew_fee     numeric not null default 0;   -- per crew member
alter table rate_cards add column if not exists landing_fee  numeric not null default 0;   -- per landing
