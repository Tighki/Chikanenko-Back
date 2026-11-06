-- Drop unused Building.gender (room gender is authoritative).
ALTER TABLE "Building" DROP COLUMN IF EXISTS "gender";
