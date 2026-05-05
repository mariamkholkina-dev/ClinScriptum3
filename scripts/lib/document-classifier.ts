/**
 * Эвристическая классификация типа клинического документа по тексту первой страницы.
 *
 * Для batch-upload корпуса: фильтрация по `--doc-type=protocol` отбрасывает ICF/IB/CSR,
 * случайно попавшие в директорию протоколов. Эвристика — а не LLM — потому что:
 *   1. На этом этапе LLM ещё не настроен (часть pipeline).
 *   2. Документ-классификация очень детерминирована — наличие фразы «Информированное
 *      согласие на участие пациента» однозначно идентифицирует ICF.
 *
 * Подход:
 *   — Считаем кол-во matches каждого типа маркеров.
 *   — Если ICF/IB/CSR matches >= 2 — документ не протокол.
 *   — Если protocol matches >= 2 и не-протокольных < ICF/IB/CSR threshold — protocol.
 *   — Иначе — unknown.
 */

export type DocumentTypeGuess = "protocol" | "icf" | "ib" | "csr" | "unknown";

export interface ClassificationResult {
  type: DocumentTypeGuess;
  confidence: number;
  matchedMarkers: { protocol: string[]; icf: string[]; ib: string[]; csr: string[] };
}

const PROTOCOL_MARKERS: RegExp[] = [
  /протокол(?:а|у|ом|е)?\s+клиническ(?:ого|ом|их)\s+исслед/i,
  /клиническ(?:ое|ого|ом|ий)\s+исследовани/i,
  /clinical\s+(?:study|trial)\s+protocol/i,
  /protocol\s+(?:no|number|version)\.?\s*[:#]?\s*\w/i,
  /исследуем(?:ый|ое|ого|ому)\s+(?:препарат|продукт|лекарств)/i,
  /investigational\s+(?:product|medicinal\s+product|drug)/i,
  /критер(?:ии|иях?|иев)\s+(?:включения|невключения|отбора)/i,
  /(?:inclusion|exclusion)\s+criteria/i,
  /первичн(?:ая|ой|ый|ого)\s+конечн(?:ая|ой|ый|ого)\s+точк/i,
  /primary\s+(?:efficacy\s+)?endpoint/i,
  /дизайн\s+исследовани/i,
  /study\s+design/i,
  /синопсис\s+(?:клиническ|исследовани|протокола)/i,
  /protocol\s+synopsis/i,
];

const ICF_MARKERS: RegExp[] = [
  /информированн(?:ое|ого)\s+соглас(?:ие|ия)/i,
  /informed\s+consent\s+(?:form|document)/i,
  /(?:пациент|субъект)а?\s+на\s+участие/i,
  /листок-вкладыш/i,
  /добровольно\s+(?:подтверждаю|соглашаюсь|даю)/i,
  /подпис(?:ь|ью)\s+(?:пациента|испытуемого|субъекта)/i,
  /signature\s+of\s+(?:patient|subject|participant)/i,
];

const IB_MARKERS: RegExp[] = [
  /брошюр(?:а|ы|у)\s+исследовател/i,
  /investigator['']?s?\s+brochure/i,
  /\bIB\b\s+(?:edition|version|edition)/i,
  /доклинические\s+(?:данные|исследовани)/i,
  /preclinical\s+(?:data|studies|safety)/i,
  /фармакокинетическ(?:ие|ий)\s+профил/i,
];

const CSR_MARKERS: RegExp[] = [
  /отч[её]т\s+(?:о|об)\s+(?:клиническом\s+)?исследовани/i,
  /clinical\s+(?:study|trial)\s+report/i,
  /\bCSR\b\s+(?:no|number)/i,
  /итогов(?:ый|ые|ой)\s+(?:анализ|результат)/i,
  /final\s+(?:analysis|results)\s+(?:report|of)/i,
];

function countMatches(text: string, markers: RegExp[]): string[] {
  const matched: string[] = [];
  for (const re of markers) {
    const m = re.exec(text);
    if (m) matched.push(m[0]);
  }
  return matched;
}

export function classifyDocumentText(text: string): ClassificationResult {
  const protocol = countMatches(text, PROTOCOL_MARKERS);
  const icf = countMatches(text, ICF_MARKERS);
  const ib = countMatches(text, IB_MARKERS);
  const csr = countMatches(text, CSR_MARKERS);

  const matchedMarkers = { protocol, icf, ib, csr };

  // Strong negative signal — non-protocol type matched ≥ 2 different markers
  if (icf.length >= 2) return { type: "icf", confidence: Math.min(1, 0.4 + 0.2 * icf.length), matchedMarkers };
  if (ib.length >= 2) return { type: "ib", confidence: Math.min(1, 0.4 + 0.2 * ib.length), matchedMarkers };
  if (csr.length >= 2) return { type: "csr", confidence: Math.min(1, 0.4 + 0.2 * csr.length), matchedMarkers };

  // Weak non-protocol signal but protocol very strong — still protocol
  const nonProtocolHits = icf.length + ib.length + csr.length;
  if (protocol.length >= 2 && protocol.length > nonProtocolHits) {
    return { type: "protocol", confidence: Math.min(1, 0.5 + 0.1 * protocol.length), matchedMarkers };
  }

  // Single non-protocol match takes priority over single protocol match
  if (icf.length === 1 && protocol.length <= 1) return { type: "icf", confidence: 0.5, matchedMarkers };
  if (ib.length === 1 && protocol.length <= 1) return { type: "ib", confidence: 0.5, matchedMarkers };
  if (csr.length === 1 && protocol.length <= 1) return { type: "csr", confidence: 0.5, matchedMarkers };

  if (protocol.length >= 1) {
    return { type: "protocol", confidence: 0.4 + 0.1 * protocol.length, matchedMarkers };
  }

  return { type: "unknown", confidence: 0, matchedMarkers };
}

/**
 * Извлекает первые N символов текста из DOCX через mammoth.
 * Используется для классификации без полного парсинга.
 */
export async function extractDocxFirstText(filePath: string, maxChars = 5000): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value.slice(0, maxChars);
}
