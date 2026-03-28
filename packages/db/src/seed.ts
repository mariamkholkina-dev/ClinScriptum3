import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
import { createHash } from "crypto";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
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

  await prisma.user.upsert({
    where: { email: "admin@demo.clinscriptum.com" },
    update: {},
    create: {
      id: randomUUID(),
      tenantId: tenant.id,
      email: "admin@demo.clinscriptum.com",
      passwordHash: hashPassword("changeme123"),
      name: "Demo Admin",
      role: "tenant_admin",
    },
  });

  await prisma.user.upsert({
    where: { email: "writer@demo.clinscriptum.com" },
    update: {},
    create: {
      id: randomUUID(),
      tenantId: tenant.id,
      email: "writer@demo.clinscriptum.com",
      passwordHash: hashPassword("changeme123"),
      name: "Demo Writer",
      role: "writer",
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
