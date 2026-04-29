import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { prisma } from "@clinscriptum/db";
import { config } from "../config.js";
import type { JwtPayload } from "@clinscriptum/shared";

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload as object, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as string,
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
}

export async function createRefreshToken(userId: string): Promise<string> {
  const token = randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + config.refreshTokenExpiresInDays);

  await prisma.refreshToken.create({
    data: { userId, token, expiresAt },
  });

  return token;
}

export async function rotateRefreshToken(oldToken: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.refreshToken.findUnique({
      where: { token: oldToken },
      include: { user: true },
    });

    if (!existing || existing.expiresAt < new Date()) {
      if (existing) {
        await tx.refreshToken.deleteMany({ where: { userId: existing.userId } });
      }
      return null;
    }

    const deleted = await tx.refreshToken.deleteMany({
      where: { id: existing.id },
    });
    if (deleted.count === 0) return null;

    const newTokenValue = randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + config.refreshTokenExpiresInDays);

    await tx.refreshToken.create({
      data: { userId: existing.userId, token: newTokenValue, expiresAt },
    });

    const accessToken = signAccessToken({
      userId: existing.userId,
      tenantId: existing.user.tenantId,
      role: existing.user.role,
    });

    return { accessToken, refreshToken: newTokenValue };
  });
}
