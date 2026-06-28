-- 023: manual diversion mark on leg_actuals.
-- When a flight diverts (lands somewhere other than its scheduled arrival), a dispatcher
-- records the ACTUAL landing airport (+ optional note/status) against the leg. The
-- calendar/map then show "DIVERTED -> C" and the plane at C, instead of assuming the
-- scheduled arrival. Idempotent; stores soft-fail until this is applied.
ALTER TABLE leg_actuals ADD COLUMN IF NOT EXISTS actual_arr_icao text;   -- where it actually landed (ICAO)
ALTER TABLE leg_actuals ADD COLUMN IF NOT EXISTS divert_note   text;     -- free-text dispatcher note
ALTER TABLE leg_actuals ADD COLUMN IF NOT EXISTS divert_status text;     -- 'diverted' | 'cancelled' | 'continued'
