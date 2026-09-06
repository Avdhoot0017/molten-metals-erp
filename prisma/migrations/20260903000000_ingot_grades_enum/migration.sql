-- Ingot is now tracked per alloy grade. Scrap is unchanged.
--
-- Renaming INGOT to INGOT_LM6 (rather than adding three values and dropping
-- INGOT) carries every existing inventory row and every historical inventory
-- log across in place: the stock on hand and its whole audit trail become LM6,
-- which is what was decided for the metal already in the yard.
ALTER TYPE "AluminumType" RENAME VALUE 'INGOT' TO 'INGOT_LM6';
ALTER TYPE "AluminumType" ADD VALUE 'INGOT_LM9';
ALTER TYPE "AluminumType" ADD VALUE 'INGOT_LM25';
