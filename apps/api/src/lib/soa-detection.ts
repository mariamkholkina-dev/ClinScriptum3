/**
 * SOA detection — thin wrapper delegating to @clinscriptum/shared/soa-detection.
 */

import { detectSoaForVersion as detectSoaCore } from "@clinscriptum/shared/soa-detection";
import { logger } from "./logger.js";

export async function detectSoaForVersion(versionId: string): Promise<void> {
  await detectSoaCore(versionId, logger);
}
