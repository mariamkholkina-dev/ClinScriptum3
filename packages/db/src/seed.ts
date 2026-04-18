import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Demo Pharma",
      plan: "extended",
    },
  });

  const adminHash = await hashPassword("changeme123");
  const writerHash = await hashPassword("changeme123");

  await prisma.user.upsert({
    where: { email: "admin@demo.clinscriptum.com" },
    update: { passwordHash: adminHash },
    create: {
      id: randomUUID(),
      tenantId: tenant.id,
      email: "admin@demo.clinscriptum.com",
      passwordHash: await hashPassword("changeme123"),
      name: "Demo Admin",
      role: "tenant_admin",
    },
  });

  await prisma.user.upsert({
    where: { email: "writer@demo.clinscriptum.com" },
    update: { passwordHash: writerHash },
    create: {
      id: randomUUID(),
      tenantId: tenant.id,
      email: "writer@demo.clinscriptum.com",
      passwordHash: await hashPassword("changeme123"),
      name: "Demo Writer",
      role: "writer",
    },
  });

  const reviewerHash = await hashPassword("changeme123");

  await prisma.user.upsert({
    where: { email: "reviewer@demo.clinscriptum.com" },
    update: { passwordHash: reviewerHash },
    create: {
      id: randomUUID(),
      tenantId: tenant.id,
      email: "reviewer@demo.clinscriptum.com",
      passwordHash: reviewerHash,
      name: "Demo Reviewer",
      role: "findings_reviewer",
    },
  });

  const ruleAdminHash = await hashPassword("changeme123");
  await prisma.user.upsert({
    where: { email: "ruleadmin@demo.clinscriptum.com" },
    update: { passwordHash: ruleAdminHash },
    create: {
      id: randomUUID(),
      tenantId: tenant.id,
      email: "ruleadmin@demo.clinscriptum.com",
      passwordHash: ruleAdminHash,
      name: "Demo Rule Admin",
      role: "rule_admin",
    },
  });

  const ruleApproverHash = await hashPassword("changeme123");
  await prisma.user.upsert({
    where: { email: "ruleapprover@demo.clinscriptum.com" },
    update: { passwordHash: ruleApproverHash },
    create: {
      id: randomUUID(),
      tenantId: tenant.id,
      email: "ruleapprover@demo.clinscriptum.com",
      passwordHash: ruleApproverHash,
      name: "Demo Rule Approver",
      role: "rule_approver",
    },
  });

  console.log("Seed completed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
