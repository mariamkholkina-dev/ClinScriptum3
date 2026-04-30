import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { verifyAccessToken } from "../../lib/auth.js";
import { createCaller, registerUser, cleanupTestData, prisma } from "./helpers.js";

describe("document upload flow (integration)", () => {
  let caller: ReturnType<typeof createCaller>;
  let studyId: string;

  beforeAll(async () => {
    await cleanupTestData();

    const user = await registerUser(
      "upload-test@example.com",
      "password123",
      "Upload Tester",
      "Upload Org",
    );
    caller = createCaller(verifyAccessToken(user.accessToken));

    const study = await caller.study.create({ title: "Upload Study" });
    studyId = study.id;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it("creates a protocol document", async () => {
    const doc = await caller.document.create({
      studyId,
      type: "protocol",
      title: "Test Protocol",
    });

    expect(doc.id).toBeTruthy();
    expect(doc.title).toBe("Test Protocol");
    expect(doc.type).toBe("protocol");
  });

  it("rejects ICF before protocol exists for the study", async () => {
    const newStudy = await caller.study.create({ title: "Empty Study" });

    await expect(
      caller.document.create({
        studyId: newStudy.id,
        type: "icf",
        title: "ICF without protocol",
      }),
    ).rejects.toThrow("Protocol must be uploaded first");
  });

  it("gets upload URL, creates version, checks status, deletes it", async () => {
    const doc = await caller.document.create({
      studyId,
      type: "protocol",
      title: "Upload Flow Protocol",
    });

    const upload = await caller.document.getUploadUrl({
      documentId: doc.id,
      versionLabel: "v1.0",
    });

    expect(upload.versionId).toBeTruthy();
    expect(upload.storageKey).toContain(doc.id);

    const version = await prisma.documentVersion.findUnique({
      where: { id: upload.versionId },
    });
    expect(version).not.toBeNull();
    expect(version!.status).toBe("uploading");
    expect(version!.versionNumber).toBe(1);
    expect(version!.versionLabel).toBe("v1.0");

    const statuses = await caller.document.getVersionStatuses({
      versionIds: [upload.versionId],
    });
    expect(statuses).toHaveLength(1);
    expect(statuses[0].id).toBe(upload.versionId);
    expect(statuses[0].status).toBe("uploading");

    const deleteResult = await caller.document.deleteVersion({
      versionId: upload.versionId,
    });
    expect(deleteResult.success).toBe(true);

    const deleted = await prisma.documentVersion.findUnique({
      where: { id: upload.versionId },
    });
    expect(deleted).toBeNull();
  });

  it("creates second version with incremented number", async () => {
    const doc = await caller.document.create({
      studyId,
      type: "protocol",
      title: "Multi-Version Protocol",
    });

    await caller.document.getUploadUrl({ documentId: doc.id, versionLabel: "v1.0" });
    const v2 = await caller.document.getUploadUrl({ documentId: doc.id, versionLabel: "v2.0" });

    const version = await prisma.documentVersion.findUnique({
      where: { id: v2.versionId },
    });
    expect(version!.versionNumber).toBe(2);
    expect(version!.versionLabel).toBe("v2.0");
  });

  it("sets a version as current", async () => {
    const doc = await caller.document.create({
      studyId,
      type: "protocol",
      title: "Current Version Protocol",
    });

    const upload = await caller.document.getUploadUrl({
      documentId: doc.id,
      versionLabel: "v1.0",
    });

    const result = await caller.document.setCurrentVersion({
      versionId: upload.versionId,
    });
    expect(result.success).toBe(true);

    const version = await prisma.documentVersion.findUnique({
      where: { id: upload.versionId },
    });
    expect(version!.isCurrent).toBe(true);
  });
});
