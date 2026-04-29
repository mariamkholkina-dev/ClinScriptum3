import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clinscriptum/db", () => {
  const mockRefreshToken = {
    findUnique: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
  };
  return {
    prisma: {
      refreshToken: mockRefreshToken,
      $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          refreshToken: mockRefreshToken,
        }),
      ),
    },
  };
});

vi.mock("../../config.js", () => ({
  config: {
    jwtSecret: "test-secret-key-for-unit-tests",
    jwtExpiresIn: "15m",
    refreshTokenExpiresInDays: 30,
  },
}));

import { prisma } from "@clinscriptum/db";
import {
  signAccessToken,
  verifyAccessToken,
  hashPassword,
  verifyPassword,
  rotateRefreshToken,
} from "../auth.js";
import type { JwtPayload } from "@clinscriptum/shared";

const mockRefreshToken = prisma.refreshToken as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};

describe("auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("hashPassword / verifyPassword", () => {
    it("hashes and verifies correctly", async () => {
      const hash = await hashPassword("my-password");
      expect(hash).not.toBe("my-password");
      expect(await verifyPassword("my-password", hash)).toBe(true);
    });

    it("rejects wrong password", async () => {
      const hash = await hashPassword("correct");
      expect(await verifyPassword("wrong", hash)).toBe(false);
    });
  });

  describe("signAccessToken / verifyAccessToken", () => {
    const payload: JwtPayload = {
      userId: "u1",
      tenantId: "t1",
      role: "writer",
    };

    it("signs and verifies a valid token", () => {
      const token = signAccessToken(payload);
      const decoded = verifyAccessToken(token);
      expect(decoded.userId).toBe("u1");
      expect(decoded.tenantId).toBe("t1");
      expect(decoded.role).toBe("writer");
    });

    it("throws on invalid token", () => {
      expect(() => verifyAccessToken("garbage.token.here")).toThrow();
    });

    it("throws on tampered token", () => {
      const token = signAccessToken(payload);
      const tampered = token.slice(0, -5) + "XXXXX";
      expect(() => verifyAccessToken(tampered)).toThrow();
    });
  });

  describe("rotateRefreshToken", () => {
    it("returns null for non-existent token", async () => {
      mockRefreshToken.findUnique.mockResolvedValue(null);

      const result = await rotateRefreshToken("non-existent");
      expect(result).toBeNull();
    });

    it("returns null and deletes all user tokens when token is expired", async () => {
      const expired = new Date(Date.now() - 1000);
      mockRefreshToken.findUnique.mockResolvedValue({
        id: "rt1",
        userId: "u1",
        token: "old-token",
        expiresAt: expired,
        user: { tenantId: "t1", role: "writer" },
      });

      const result = await rotateRefreshToken("old-token");
      expect(result).toBeNull();
      expect(mockRefreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: "u1" },
      });
    });

    it("returns null when concurrent rotation already consumed the token", async () => {
      const future = new Date(Date.now() + 86400000);
      mockRefreshToken.findUnique.mockResolvedValue({
        id: "rt1",
        userId: "u1",
        token: "old-token",
        expiresAt: future,
        user: { tenantId: "t1", role: "writer" },
      });
      mockRefreshToken.deleteMany.mockResolvedValue({ count: 0 });

      const result = await rotateRefreshToken("old-token");
      expect(result).toBeNull();
    });

    it("rotates successfully with valid token", async () => {
      const future = new Date(Date.now() + 86400000);
      mockRefreshToken.findUnique.mockResolvedValue({
        id: "rt1",
        userId: "u1",
        token: "old-token",
        expiresAt: future,
        user: { tenantId: "t1", role: "writer" },
      });
      mockRefreshToken.deleteMany.mockResolvedValue({ count: 1 });
      mockRefreshToken.create.mockResolvedValue({});

      const result = await rotateRefreshToken("old-token");
      expect(result).not.toBeNull();
      expect(result!.accessToken).toBeTruthy();
      expect(result!.refreshToken).toBeTruthy();
      expect(mockRefreshToken.create).toHaveBeenCalledTimes(1);
    });

    it("creates new token within the same transaction", async () => {
      const future = new Date(Date.now() + 86400000);
      mockRefreshToken.findUnique.mockResolvedValue({
        id: "rt1",
        userId: "u1",
        token: "old-token",
        expiresAt: future,
        user: { tenantId: "t1", role: "writer" },
      });
      mockRefreshToken.deleteMany.mockResolvedValue({ count: 1 });
      mockRefreshToken.create.mockResolvedValue({});

      await rotateRefreshToken("old-token");

      const createCall = mockRefreshToken.create.mock.calls[0][0];
      expect(createCall.data.userId).toBe("u1");
      expect(createCall.data.token).toBeTruthy();
      expect(createCall.data.expiresAt).toBeInstanceOf(Date);
      expect(createCall.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });
});
