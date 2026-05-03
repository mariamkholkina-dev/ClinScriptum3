-- CreateEnum
CREATE TYPE "SoaOrientation" AS ENUM ('visits_cols', 'visits_rows', 'unknown');

-- AlterTable
ALTER TABLE "soa_tables" ADD COLUMN     "orientation" "SoaOrientation" NOT NULL DEFAULT 'visits_cols',
ADD COLUMN     "orientation_conflict" BOOLEAN NOT NULL DEFAULT false;
