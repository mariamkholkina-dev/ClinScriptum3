-- История «промт → ответ LLM»: одна строка на каждый вызов gateway.generate().
CREATE TABLE "llm_response_logs" (
    "id" TEXT NOT NULL,
    "processing_run_id" UUID NOT NULL,
    "doc_version_id" UUID NOT NULL,
    "level" "PipelineLevel" NOT NULL,
    "label" TEXT,
    "system_prompt" TEXT,
    "user_prompt" TEXT,
    "response_content" TEXT NOT NULL,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "llm_response_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "llm_response_logs_processing_run_id_idx" ON "llm_response_logs"("processing_run_id");
CREATE INDEX "llm_response_logs_doc_version_id_idx" ON "llm_response_logs"("doc_version_id");

ALTER TABLE "llm_response_logs" ADD CONSTRAINT "llm_response_logs_processing_run_id_fkey"
    FOREIGN KEY ("processing_run_id") REFERENCES "processing_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
