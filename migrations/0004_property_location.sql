-- Seedsman: where each property is, so customers carry their geospatial information.
-- (Tables 0001–0003 were created earlier; schema/existing.sql is a copy of them for reference.)
ALTER TABLE properties ADD COLUMN lat REAL;
ALTER TABLE properties ADD COLUMN lng REAL;
ALTER TABLE properties ADD COLUMN zoom REAL;
