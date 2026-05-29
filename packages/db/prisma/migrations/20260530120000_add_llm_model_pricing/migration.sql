-- CreateTable
CREATE TABLE "llm_model_pricing" (
    "id" UUID NOT NULL,
    "model_pattern" TEXT NOT NULL,
    "provider" TEXT,
    "cost_per_input_k_tokens" DOUBLE PRECISION NOT NULL,
    "cost_per_output_k_tokens" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "note" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "llm_model_pricing_pkey" PRIMARY KEY ("id")
);
