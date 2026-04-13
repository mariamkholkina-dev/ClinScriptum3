import { randomUUID } from "crypto";
import { prisma } from "@clinscriptum/db";
import { signAccessToken, createRefreshToken } from "./auth.js";

export interface WordSessionContext {
  docVersionId?: string;
  mode: "intra_audit" | "inter_audit" | "generation_review" | "generation_insert";
  protocolVersionId?: string;
  generatedDocId?: string;
}

const SESSION_TTL_MINUTES = 5;

export async function createWordSession(
  userId: string,
  tenantId: string,
  context: WordSessionContext
): Promise<string> {
  await cleanupExpiredSessions();

  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + SESSION_TTL_MINUTES);

  const session = await prisma.wordSession.create({
    data: {
      userId,
      tenantId,
      context: context as any,
      expiresAt,
    },
  });

  return session.id;
}

export async function exchangeWordSession(sessionId: string) {
  const session = await prisma.wordSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) return null;
  if (session.exchanged) return null;
  if (session.expiresAt < new Date()) {
    await prisma.wordSession.delete({ where: { id: sessionId } });
    return null;
  }

  await prisma.wordSession.update({
    where: { id: sessionId },
    data: { exchanged: true },
  });

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
  });
  if (!user) return null;

  const accessToken = signAccessToken({
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
  });

  const refreshToken = await createRefreshToken(user.id);

  return {
    accessToken,
    refreshToken,
    context: session.context as unknown as WordSessionContext,
    userId: user.id,
    tenantId: user.tenantId,
  };
}

async function cleanupExpiredSessions() {
  await prisma.wordSession.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
}
