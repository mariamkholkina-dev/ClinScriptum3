import { prisma } from "@clinscriptum/db";
import { DomainError } from "./errors.js";

interface CreateFewShotInput {
  tenantId: string;
  createdById: string;
  title: string;
  parentPath?: string | null;
  contentPreview?: string | null;
  standardSection: string;
  reason?: string | null;
  sourceSectionId?: string | null;
}

interface UpdateFewShotInput {
  title?: string;
  parentPath?: string | null;
  contentPreview?: string | null;
  standardSection?: string;
  reason?: string | null;
  isActive?: boolean;
}

interface ListFewShotsInput {
  tenantId: string;
  standardSection?: string;
  isActive?: boolean;
  take?: number;
  cursor?: string;
}

export const fewShotService = {
  /**
   * Создать новый утверждённый пример классификации. Используется как из
   * UI rule-admin (форма /few-shots), так и автоматически из quick-fix
   * flow в diff overlay (если эксперт пометит «принять как пример»).
   */
  async create(input: CreateFewShotInput) {
    if (!input.title.trim()) {
      throw new DomainError("BAD_REQUEST", "Title is required");
    }
    if (!input.standardSection.trim()) {
      throw new DomainError("BAD_REQUEST", "standardSection is required");
    }
    return prisma.classificationFewShot.create({
      data: {
        tenantId: input.tenantId,
        createdById: input.createdById,
        title: input.title.trim(),
        parentPath: input.parentPath?.trim() || null,
        contentPreview: input.contentPreview?.trim() || null,
        standardSection: input.standardSection.trim(),
        reason: input.reason?.trim() || null,
        sourceSectionId: input.sourceSectionId ?? null,
      },
    });
  },

  /**
   * Список примеров tenant'а с опциональной фильтрацией. Поддерживает
   * курсорную пагинацию (take + cursor) для будущих больших наборов.
   * Без take возвращает полный список (back-compat с UI начального уровня).
   */
  async list(input: ListFewShotsInput) {
    const where = {
      tenantId: input.tenantId,
      ...(input.standardSection ? { standardSection: input.standardSection } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    };
    if (input.take == null) {
      const items = await prisma.classificationFewShot.findMany({
        where,
        orderBy: [{ standardSection: "asc" }, { createdAt: "desc" }],
        include: { createdBy: { select: { id: true, email: true, name: true } } },
      });
      return { items, nextCursor: null as string | null };
    }
    const items = await prisma.classificationFewShot.findMany({
      where,
      orderBy: [{ standardSection: "asc" }, { createdAt: "desc" }],
      take: input.take + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      include: { createdBy: { select: { id: true, email: true, name: true } } },
    });
    let nextCursor: string | null = null;
    if (items.length > input.take) {
      nextCursor = items.pop()!.id;
    }
    return { items, nextCursor };
  },

  /** Получить один пример. Кидает NOT_FOUND если не существует или принадлежит чужому tenant'у. */
  async get(tenantId: string, id: string) {
    const item = await prisma.classificationFewShot.findUnique({
      where: { id },
      include: { createdBy: { select: { id: true, email: true, name: true } } },
    });
    if (!item || item.tenantId !== tenantId) {
      throw new DomainError("NOT_FOUND", "Few-shot not found");
    }
    return item;
  },

  /** Обновить пример. Tenant-isolation через get() проверку. */
  async update(tenantId: string, id: string, patch: UpdateFewShotInput) {
    await this.get(tenantId, id); // throws if not own tenant
    const cleanedPatch: Record<string, unknown> = {};
    if (patch.title !== undefined) {
      if (!patch.title.trim()) throw new DomainError("BAD_REQUEST", "Title is required");
      cleanedPatch.title = patch.title.trim();
    }
    if (patch.parentPath !== undefined) cleanedPatch.parentPath = patch.parentPath?.trim() || null;
    if (patch.contentPreview !== undefined) cleanedPatch.contentPreview = patch.contentPreview?.trim() || null;
    if (patch.standardSection !== undefined) {
      if (!patch.standardSection.trim()) {
        throw new DomainError("BAD_REQUEST", "standardSection is required");
      }
      cleanedPatch.standardSection = patch.standardSection.trim();
    }
    if (patch.reason !== undefined) cleanedPatch.reason = patch.reason?.trim() || null;
    if (patch.isActive !== undefined) cleanedPatch.isActive = patch.isActive;

    return prisma.classificationFewShot.update({ where: { id }, data: cleanedPatch });
  },

  /** Hard delete. UI должен предлагать isActive=false в большинстве случаев. */
  async delete(tenantId: string, id: string) {
    await this.get(tenantId, id);
    await prisma.classificationFewShot.delete({ where: { id } });
    return { success: true };
  },

  /**
   * Активные примеры для подмеси в LLM Check (Sprint 5.2). По умолчанию
   * возвращает все активные tenant'а; LLM Check сам выберет top-K похожих.
   * Опциональный standardSection для предварительной фильтрации.
   */
  async listActive(tenantId: string, standardSection?: string) {
    return prisma.classificationFewShot.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(standardSection ? { standardSection } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  },
};
