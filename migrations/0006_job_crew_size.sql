-- Seedsman: crew size and travel on scheduled jobs.
-- men: people on the job; man_hours: the work (from the quote, can be changed); job time = man_hours / men.
-- travel_minutes: driving time from the crew's previous job that day; sequence: order in the crew's day.
ALTER TABLE jobs ADD COLUMN men INTEGER;
ALTER TABLE jobs ADD COLUMN man_hours REAL;
ALTER TABLE jobs ADD COLUMN travel_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN sequence INTEGER;
