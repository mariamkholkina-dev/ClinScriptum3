import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { verifyAccessToken } from "../../lib/auth.js";
import { createCaller, registerUser, cleanupTestData, prisma } from "./helpers.js";

describe("tenant isolation (integration)", () => {
  let callerA: ReturnType<typeof createCaller>;
  let callerB: ReturnType<typeof createCaller>;
  let studyIdA: string;
  let studyIdB: string;

  beforeAll(async () => {
    await cleanupTestData();

    const userA = await registerUser(
      "tenant-a@example.com",
      "password123",
      "User A",
      "Org A",
    );
    callerA = createCaller(verifyAccessToken(userA.accessToken));

    const userB = await registerUser(
      "tenant-b@example.com",
      "password123",
      "User B",
      "Org B",
    );
    callerB = createCaller(verifyAccessToken(userB.accessToken));

    const sA = await callerA.study.create({ title: "Study Alpha" });
    studyIdA = sA.id;

    const sB = await callerB.study.create({ title: "Study Beta" });
    studyIdB = sB.id;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  describe("studies", () => {
    it("tenant A sees only its own studies", async () => {
      const studies = await callerA.study.list();
      expect(studies.every((s: any) => s.title !== "Study Beta")).toBe(true);
      expect(studies.some((s: any) => s.title === "Study Alpha")).toBe(true);
    });

    it("tenant B sees only its own studies", async () => {
      const studies = await callerB.study.list();
      expect(studies.every((s: any) => s.title !== "Study Alpha")).toBe(true);
      expect(studies.some((s: any) => s.title === "Study Beta")).toBe(true);
    });

    it("tenant A gets null for tenant B's study", async () => {
      const result = await callerA.study.getById({ id: studyIdB });
      expect(result).toBeNull();
    });

    it("tenant B gets null for tenant A's study", async () => {
      const result = await callerB.study.getById({ id: studyIdA });
      expect(result).toBeNull();
    });
  });

  describe("documents", () => {
    it("tenant A creates a document in its own study", async () => {
      const doc = await callerA.document.create({
        studyId: studyIdA,
        type: "protocol",
        title: "Protocol Alpha",
      });
      expect(doc.title).toBe("Protocol Alpha");
    });

    it("tenant B cannot create a document in tenant A's study", async () => {
      await expect(
        callerB.document.create({
          studyId: studyIdA,
          type: "protocol",
          title: "Sneaky Protocol",
        }),
      ).rejects.toThrow();
    });

    it("tenant A sees its study's documents, tenant B does not", async () => {
      const docsA = await callerA.document.listByStudy({ studyId: studyIdA });
      expect(docsA.length).toBeGreaterThan(0);

      await expect(
        callerB.document.listByStudy({ studyId: studyIdA }),
      ).rejects.toThrow();
    });
  });

  describe("cross-tenant deletion", () => {
    it("tenant B's delete of tenant A's study affects 0 rows", async () => {
      const result = await callerB.study.delete({ id: studyIdA });
      expect(result.count).toBe(0);

      const study = await prisma.study.findUnique({ where: { id: studyIdA } });
      expect(study).not.toBeNull();
    });
  });
});
