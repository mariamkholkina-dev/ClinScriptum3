import type { BackoffOptions } from "bullmq";

export interface JobRetryConfig {
  attempts: number;
  backoff: BackoffOptions;
}

const RETRY_CONFIGS: Record<string, JobRetryConfig> = {
  parse_document: { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
  classify_sections: { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
  extract_facts: { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
  intra_doc_audit: { attempts: 2, backoff: { type: "exponential", delay: 10000 } },
  generate_icf: { attempts: 2, backoff: { type: "exponential", delay: 15000 } },
  generate_csr: { attempts: 2, backoff: { type: "exponential", delay: 15000 } },
};

const DEFAULT_CONFIG: JobRetryConfig = {
  attempts: 2,
  backoff: { type: "exponential", delay: 5000 },
};

export function getRetryConfig(jobName: string): JobRetryConfig {
  return RETRY_CONFIGS[jobName] ?? DEFAULT_CONFIG;
}
