-- Multi-day jobs: one accepted quote can be booked over several days. Each day is its own row in jobs
-- (so the calendar, drive times and the crew-overlap check work per day), linked by project_id.
--   project_id  id shared by every day of the same job (NULL for ordinary one-day jobs)
--   part/parts  "Day 2 of 3"
--   day_log     the end-of-day check-in for that day (JSON)
-- SQLite cannot drop the UNIQUE on jobs.quote_id, so the table is rebuilt.
PRAGMA defer_foreign_keys = true;

CREATE TABLE jobs_new (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  title TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, crew TEXT NOT NULL, status TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  actual_hours REAL NOT NULL DEFAULT 0 CHECK(actual_hours>=0),
  waste REAL NOT NULL DEFAULT 0 CHECK(waste>=0),
  next_cut TEXT NOT NULL DEFAULT '',
  started_at TEXT, completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  men INTEGER, man_hours REAL, travel_minutes INTEGER NOT NULL DEFAULT 0, sequence INTEGER,
  project_id TEXT,
  part INTEGER NOT NULL DEFAULT 1,
  parts INTEGER NOT NULL DEFAULT 1,
  day_log TEXT CHECK(day_log IS NULL OR json_valid(day_log))
);

INSERT INTO jobs_new (id, quote_id, customer_id, property_id, title, start, end, crew, status, notes, actual_hours, waste, next_cut,
  started_at, completed_at, created_at, updated_at, men, man_hours, travel_minutes, sequence)
SELECT id, quote_id, customer_id, property_id, title, start, end, crew, status, notes, actual_hours, waste, next_cut,
  started_at, completed_at, created_at, updated_at, men, man_hours, travel_minutes, sequence FROM jobs;

-- Rows in other tables that point at a job are set aside while the table is swapped, then put back, so no
-- foreign key ever points at a missing job (SQLite does not re-check deferred keys after a rename).
CREATE TABLE _mv_job_assignments AS SELECT * FROM job_assignments WHERE job_id IS NOT NULL;
DELETE FROM job_assignments WHERE job_id IS NOT NULL;
CREATE TABLE _mv_tasks AS SELECT * FROM tasks WHERE job_id IS NOT NULL;
DELETE FROM tasks WHERE job_id IS NOT NULL;
CREATE TABLE _mv_photos AS SELECT * FROM photos WHERE job_id IS NOT NULL;
DELETE FROM photos WHERE job_id IS NOT NULL;
CREATE TABLE _mv_recurring_service_plans AS SELECT * FROM recurring_service_plans WHERE job_id IS NOT NULL;
DELETE FROM recurring_service_plans WHERE job_id IS NOT NULL;
CREATE TABLE _mv_invoices AS SELECT * FROM invoices WHERE job_id IS NOT NULL;
DELETE FROM invoices WHERE job_id IS NOT NULL;
CREATE TABLE _mv_site_drawings AS SELECT * FROM site_drawings WHERE job_id IS NOT NULL;
DELETE FROM site_drawings WHERE job_id IS NOT NULL;
CREATE TABLE _mv_job_closeouts AS SELECT * FROM job_closeouts WHERE job_id IS NOT NULL;
DELETE FROM job_closeouts WHERE job_id IS NOT NULL;
CREATE TABLE _mv_task_times AS SELECT * FROM task_times WHERE job_id IS NOT NULL;
DELETE FROM task_times WHERE job_id IS NOT NULL;

DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;

INSERT INTO job_assignments SELECT * FROM _mv_job_assignments;
DROP TABLE _mv_job_assignments;
INSERT INTO tasks SELECT * FROM _mv_tasks;
DROP TABLE _mv_tasks;
INSERT INTO photos SELECT * FROM _mv_photos;
DROP TABLE _mv_photos;
INSERT INTO recurring_service_plans SELECT * FROM _mv_recurring_service_plans;
DROP TABLE _mv_recurring_service_plans;
INSERT INTO invoices SELECT * FROM _mv_invoices;
DROP TABLE _mv_invoices;
INSERT INTO site_drawings SELECT * FROM _mv_site_drawings;
DROP TABLE _mv_site_drawings;
INSERT INTO job_closeouts SELECT * FROM _mv_job_closeouts;
DROP TABLE _mv_job_closeouts;
INSERT INTO task_times SELECT * FROM _mv_task_times;
DROP TABLE _mv_task_times;

CREATE INDEX jobs_start ON jobs(start);
CREATE INDEX jobs_quote ON jobs(quote_id);
CREATE INDEX jobs_project ON jobs(project_id);

CREATE TRIGGER no_crew_overlap_insert BEFORE INSERT ON jobs WHEN NEW.status!='Cancelled' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM jobs WHERE crew=NEW.crew AND status!='Cancelled' AND start<NEW.end AND end>NEW.start) THEN RAISE(ABORT,'Crew overlap') END;
END;
CREATE TRIGGER no_crew_overlap_update BEFORE UPDATE OF start,end,crew,status ON jobs WHEN NEW.status!='Cancelled' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM jobs WHERE id!=NEW.id AND crew=NEW.crew AND status!='Cancelled' AND start<NEW.end AND end>NEW.start) THEN RAISE(ABORT,'Crew overlap') END;
END;
