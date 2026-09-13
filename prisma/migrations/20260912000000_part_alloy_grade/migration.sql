-- A rejected casting is scrap metal, and scrap carries an alloy grade. The
-- part is where that grade belongs: a casting drawing specifies one alloy, so
-- asking for it on every fettling entry would be asking the same question
-- again and again.
--
-- Existing parts default to LM6, matching the decision taken when ingot and
-- then scrap were graded.
ALTER TABLE "parts" ADD COLUMN "alloyGrade" TEXT NOT NULL DEFAULT 'LM6';
