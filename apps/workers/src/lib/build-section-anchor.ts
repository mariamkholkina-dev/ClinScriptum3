/**
 * Anchor для секции в формате [S<path>:<type>], встраиваемом в текст,
 * который мы передаём LLM при intra-audit. LLM возвращает эти anchor-ы
 * в reference_section_id / target_section_id, что упрощает post-LLM
 * матчинг с golden corpus и side-by-side UI.
 *
 * Форматы:
 *   - С heading_number + standardSection: "[S1.2.3:objectives]"
 *   - С heading_number, без standardSection: "[S1.2.3]"
 *   - Без heading_number, с order: "[S#42:objectives]"  (fallback)
 *   - Если ничего нет: "[S?]"  (последний fallback — лог в warning)
 */

export interface AnchorableSection {
  id: string;
  title: string;
  standardSection: string | null;
  level?: number | null;
  order?: number | null;
  // headingNumber есть только в полной Prisma-модели Section,
  // в CachedSection из section-cache.ts он не присутствует —
  // поэтому делаем optional + выбираем по наличию.
  headingNumber?: string | null;
}

const TYPE_SUFFIX_PATTERN = /^[a-z][a-z0-9_]*$/;

export function buildSectionAnchor(section: AnchorableSection): string {
  const path = section.headingNumber?.trim() || null;
  const typeRaw = section.standardSection?.trim() || null;
  const type = typeRaw && TYPE_SUFFIX_PATTERN.test(typeRaw) ? typeRaw : null;

  if (path) {
    return type ? `[S${path}:${type}]` : `[S${path}]`;
  }

  if (typeof section.order === "number") {
    return type ? `[S#${section.order}:${type}]` : `[S#${section.order}]`;
  }

  return "[S?]";
}

/**
 * Извлекает path и type из anchor-строки вида "S1.2.3:objectives", "S1.2.3"
 * или "S#42". Возвращает null если форма не распознана.
 *
 * Используется при разборе ответа LLM (reference_section_id / target_section_id),
 * чтобы потом сопоставить со списком секций документа.
 */
export function parseSectionAnchor(raw: string | null | undefined):
  | { path: string; type: string | null; isOrderFallback: boolean }
  | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^\[|\]$/g, "");
  // Поддерживаем и форму "1.2.3" без префикса S — LLM иногда возвращает.
  const withoutS = trimmed.startsWith("S") ? trimmed.slice(1) : trimmed;

  const [pathRaw, typeRaw] = withoutS.split(":", 2);
  if (!pathRaw) return null;

  const isOrderFallback = pathRaw.startsWith("#");
  const path = isOrderFallback ? pathRaw.slice(1) : pathRaw;
  // path должен быть либо числовой иерархией "1.2.3", либо чистым числом
  if (!/^\d+(\.\d+)*$/.test(path)) return null;

  const type = typeRaw && TYPE_SUFFIX_PATTERN.test(typeRaw) ? typeRaw : null;
  return { path, type, isOrderFallback };
}
