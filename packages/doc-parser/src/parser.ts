import mammoth from "mammoth";
import type { ParsedDocument } from "./types.js";

export async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  const result = await mammoth.convertToHtml({ buffer });
  // Full implementation in Phase 2
  return {
    title: "Untitled",
    sections: [],
    metadata: { warnings: JSON.stringify(result.messages) },
  };
}
