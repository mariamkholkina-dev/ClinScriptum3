-- Sprint 4: LLM verification of SoA tables.
-- Adds the verification_level column tracking which pipeline level last
-- confirmed the table (deterministic / llm_check / llm_qa) and the
-- llm_confidence reported by the LLM Check step.

-- CreateEnum
CREATE TYPE "SoaVerificationLevel" AS ENUM ('deterministic', 'llm_check', 'llm_qa');

-- AlterTable
ALTER TABLE "soa_tables"
  ADD COLUMN "verification_level" "SoaVerificationLevel" NOT NULL DEFAULT 'deterministic',
  ADD COLUMN "llm_confidence" DOUBLE PRECISION;
