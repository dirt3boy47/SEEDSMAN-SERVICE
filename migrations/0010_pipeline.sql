-- Customer pipeline (CRM): each card is a lead, from first enquiry to the finished job. The original enquiries table
-- is the lead; `status` is its stage: New enquiry, Contacted, Site visit, Quoted, Won, Scheduled, Done, Lost.
ALTER TABLE enquiries ADD COLUMN suburb TEXT NOT NULL DEFAULT '';
ALTER TABLE enquiries ADD COLUMN source TEXT NOT NULL DEFAULT 'Phone';
ALTER TABLE enquiries ADD COLUMN customer_id TEXT REFERENCES customers(id);
ALTER TABLE enquiries ADD COLUMN property_id TEXT REFERENCES properties(id);
ALTER TABLE enquiries ADD COLUMN quote_id TEXT REFERENCES quotes(id);
ALTER TABLE enquiries ADD COLUMN value REAL;
ALTER TABLE enquiries ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE enquiries ADD COLUMN next_at TEXT;
ALTER TABLE enquiries ADD COLUMN next_note TEXT NOT NULL DEFAULT '';
ALTER TABLE enquiries ADD COLUMN lost_reason TEXT;
ALTER TABLE enquiries ADD COLUMN stage_at TEXT;
ALTER TABLE enquiries ADD COLUMN updated_at TEXT;
ALTER TABLE enquiries ADD COLUMN sort REAL NOT NULL DEFAULT 0;
ALTER TABLE enquiries ADD COLUMN archived_at TEXT;
ALTER TABLE enquiries ADD COLUMN created_by TEXT;
CREATE INDEX IF NOT EXISTS enquiries_quote ON enquiries(quote_id);
CREATE INDEX IF NOT EXISTS enquiries_stage ON enquiries(status);
-- what happened to a lead: created, moved, note, call, quote linked…
CREATE TABLE IF NOT EXISTS lead_events (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES enquiries(id),
  kind TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  by_user TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lead_events_lead ON lead_events(lead_id, created_at);
