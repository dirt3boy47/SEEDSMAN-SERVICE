-- Seedsman: job close-outs (the man-hours database) and recurring trims.
-- job_closeouts: one per completed job — time on site, breaks, conditions and notes.
-- task_times: one row per task per job (service, quantity, height band, estimated vs actual man-hours) for reporting.
-- recurring_service_plans (existing): gains the details needed to re-quote or re-book a trim.
CREATE TABLE IF NOT EXISTS job_closeouts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
  quote_id TEXT REFERENCES quotes(id),
  work_date TEXT NOT NULL,
  arrived TEXT NOT NULL,
  finished TEXT NOT NULL,
  men INTEGER NOT NULL,
  break_minutes INTEGER NOT NULL DEFAULT 0,
  onsite_man_hours REAL NOT NULL,
  working_man_hours REAL NOT NULL,
  estimated_man_hours REAL,
  access TEXT,
  waste_m3 REAL,
  picker_used INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details)),
  created_by TEXT REFERENCES user(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS task_times (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  work_date TEXT NOT NULL,
  category TEXT NOT NULL,
  service TEXT,
  name TEXT NOT NULL,
  unit TEXT,
  qty REAL,
  tier TEXT,
  height REAL,
  condition TEXT,
  est_man_hours REAL,
  actual_man_hours REAL NOT NULL,
  men INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS task_times_service ON task_times(service, tier);
CREATE INDEX IF NOT EXISTS task_times_job ON task_times(job_id);
ALTER TABLE recurring_service_plans ADD COLUMN customer_id TEXT;
ALTER TABLE recurring_service_plans ADD COLUMN quote_id TEXT;
ALTER TABLE recurring_service_plans ADD COLUMN interval_months INTEGER;
ALTER TABLE recurring_service_plans ADD COLUMN last_total REAL;
ALTER TABLE recurring_service_plans ADD COLUMN last_ex_gst REAL;
ALTER TABLE recurring_service_plans ADD COLUMN status TEXT NOT NULL DEFAULT 'Due';
ALTER TABLE recurring_service_plans ADD COLUMN new_quote_id TEXT;
CREATE INDEX IF NOT EXISTS plans_due ON recurring_service_plans(active, status, due);
