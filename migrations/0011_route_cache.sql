-- Drive times from Google, kept for 30 days so the schedule doesn't ask Google again for the same trip at the same time
-- of the week (fewer calls, lower Google cost, and no running into Cloudflare's 50-calls-per-request limit).
CREATE TABLE IF NOT EXISTS route_cache (
  k TEXT PRIMARY KEY,           -- from lat,lng → to lat,lng (4 dp, ~10 m) and weekday-hour of departure
  km REAL NOT NULL, min REAL NOT NULL, low REAL, high REAL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
