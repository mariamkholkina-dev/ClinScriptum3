/*
  Warnings:

  - Added the required column `fact_category` to the `facts` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FactStatus" ADD VALUE 'deferred';
ALTER TYPE "FactStatus" ADD VALUE 'not_found';

-- AlterTable
ALTER TABLE "facts" ADD COLUMN     "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "fact_category" TEXT NOT NULL,
ADD COLUMN     "manual_value" TEXT;
