-- Seedsman: saved site drawings (lines, areas, points) for each property, used to measure quote items.
CREATE TABLE IF NOT EXISTS site_drawings (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('line','area','point')),
  geometry TEXT NOT NULL CHECK(json_valid(geometry)),
  measure TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(measure)),
  service TEXT,
  inputs TEXT CHECK(inputs IS NULL OR json_valid(inputs)),
  color TEXT,
  notes TEXT NOT NULL DEFAULT '',
  quote_id TEXT REFERENCES quotes(id),
  job_id TEXT REFERENCES jobs(id),
  created_by TEXT REFERENCES user(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS site_drawings_property ON site_drawings(property_id);

-- Hedges measured before this change become site drawings (same id), and quote items point at them.
INSERT OR IGNORE INTO site_drawings (id, property_id, name, kind, geometry, measure, service, inputs, created_by, created_at, updated_at)
SELECT h.id, h.property_id, h.name,
  CASE json_extract(m.geometry, '$.type') WHEN 'Polygon' THEN 'area' ELSE 'line' END,
  m.geometry,
  json_object('length', json_extract(m.inputs, '$.measuredLength'), 'area', json_extract(m.inputs, '$.measuredArea')),
  'hedge', m.inputs, m.measured_by, h.created_at, h.updated_at
FROM hedge_assets h
JOIN hedge_measurements m ON m.id = (SELECT id FROM hedge_measurements WHERE hedge_id = h.id ORDER BY created_at DESC, rowid DESC LIMIT 1)
WHERE h.inactive = 0 AND m.geometry IS NOT NULL;

UPDATE quotes SET hedges = (
  SELECT json_group_array(json(json_set(value, '$.service', 'hedge', '$.drawingId', json_extract(value, '$.assetId'))))
  FROM json_each(quotes.hedges)
) WHERE hedges NOT LIKE '%"service"%';
