-- A day of a multi-day job can be sent back to the "To schedule" tray: status 'Unscheduled'. It keeps its man-hours and
-- crew size but has no real time slot, so the crew-overlap check ignores it (as it does cancelled jobs).
DROP TRIGGER IF EXISTS no_crew_overlap_insert;
DROP TRIGGER IF EXISTS no_crew_overlap_update;
CREATE TRIGGER no_crew_overlap_insert BEFORE INSERT ON jobs WHEN NEW.status NOT IN ('Cancelled','Unscheduled') BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM jobs WHERE crew=NEW.crew AND status NOT IN ('Cancelled','Unscheduled') AND start<NEW.end AND end>NEW.start) THEN RAISE(ABORT,'Crew overlap') END;
END;
CREATE TRIGGER no_crew_overlap_update BEFORE UPDATE OF start,end,crew,status ON jobs WHEN NEW.status NOT IN ('Cancelled','Unscheduled') BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM jobs WHERE id!=NEW.id AND crew=NEW.crew AND status NOT IN ('Cancelled','Unscheduled') AND start<NEW.end AND end>NEW.start) THEN RAISE(ABORT,'Crew overlap') END;
END;
