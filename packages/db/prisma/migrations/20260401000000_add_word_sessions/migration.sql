-- CreateTable
CREATE TABLE "word_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "context" JSONB NOT NULL,
    "exchanged" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "word_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "word_sessions_expires_at_idx" ON "word_sessions"("expires_at");
