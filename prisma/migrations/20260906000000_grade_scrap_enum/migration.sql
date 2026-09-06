-- Scrap carries an alloy grade, exactly as ingot does.
--
-- The three existing scrap values are RENAMED rather than dropped and
-- recreated: a rename carries every inventory row and every inventory log
-- entry across in place, so no stock and no history is lost. Existing scrap
-- becomes LM6, matching the decision taken when ingot was graded.
ALTER TYPE "AluminumType" RENAME VALUE 'RUNNER_RAISER' TO 'RUNNER_RAISER_LM6';
ALTER TYPE "AluminumType" RENAME VALUE 'SPILLAGE' TO 'SPILLAGE_LM6';
ALTER TYPE "AluminumType" RENAME VALUE 'REJECTED_PART' TO 'REJECTED_PART_LM6';

ALTER TYPE "AluminumType" ADD VALUE 'RUNNER_RAISER_LM9';
ALTER TYPE "AluminumType" ADD VALUE 'RUNNER_RAISER_LM25';
ALTER TYPE "AluminumType" ADD VALUE 'SPILLAGE_LM9';
ALTER TYPE "AluminumType" ADD VALUE 'SPILLAGE_LM25';
ALTER TYPE "AluminumType" ADD VALUE 'REJECTED_PART_LM9';
ALTER TYPE "AluminumType" ADD VALUE 'REJECTED_PART_LM25';
