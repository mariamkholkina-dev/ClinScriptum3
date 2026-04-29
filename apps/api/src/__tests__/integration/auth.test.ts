import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { verifyAccessToken } from "../../lib/auth.js";
import { createCaller, registerUser, cleanupTestData, prisma } from "./helpers.js";

describe("auth — full cycle (integration)", () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  let accessToken: string;
  let refreshToken: string;
  let userId: string;

  it("registers a new user and returns tokens", async () => {
    const result = await registerUser(
      "test-auth@example.com",
      "password123",
      "Test User",
      "Test Org",
    );

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.email).toBe("test-auth@example.com");
    expect(result.user.role).toBe("tenant_admin");

    accessToken = result.accessToken;
    refreshToken = result.refreshToken;
    userId = result.user.id;
  });

  it("rejects duplicate registration", async () => {
    const caller = createCaller();
    await expect(
      caller.auth.register({
        email: "test-auth@example.com",
        password: "password123",
        name: "Dup",
        tenantName: "Dup Org",
      }),
    ).rejects.toThrow("already registered");
  });

  it("logs in with correct credentials", async () => {
    const caller = createCaller();
    const result = await caller.auth.login({
      email: "test-auth@example.com",
      password: "password123",
    });

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.id).toBe(userId);

    accessToken = result.accessToken;
    refreshToken = result.refreshToken;
  });

  it("rejects login with wrong password", async () => {
    const caller = createCaller();
    await expect(
      caller.auth.login({
        email: "test-auth@example.com",
        password: "wrongpassword",
      }),
    ).rejects.toThrow("Invalid credentials");
  });

  it("rejects login for non-existent user", async () => {
    const caller = createCaller();
    await expect(
      caller.auth.login({
        email: "nobody@example.com",
        password: "password123",
      }),
    ).rejects.toThrow("Invalid credentials");
  });

  it("access token is valid and contains correct payload", () => {
    const payload = verifyAccessToken(accessToken);
    expect(payload.userId).toBe(userId);
    expect(payload.role).toBe("tenant_admin");
    expect(payload.tenantId).toBeTruthy();
  });

  it("rotates refresh token and returns new tokens", async () => {
    const caller = createCaller();
    const result = await caller.auth.refresh({ refreshToken });

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.refreshToken).not.toBe(refreshToken);

    const newPayload = verifyAccessToken(result.accessToken);
    expect(newPayload.userId).toBe(userId);

    refreshToken = result.refreshToken;
  });

  it("rejects reuse of old refresh token (rotation consumed it)", async () => {
    const caller = createCaller();
    const oldToken = refreshToken;

    const rotated = await caller.auth.refresh({ refreshToken: oldToken });
    refreshToken = rotated.refreshToken;

    await expect(
      caller.auth.refresh({ refreshToken: oldToken }),
    ).rejects.toThrow("Invalid refresh token");
  });

  it("uses access token to call protected endpoints", async () => {
    const payload = verifyAccessToken(accessToken);
    const caller = createCaller(payload);
    const studies = await caller.study.list();
    expect(Array.isArray(studies)).toBe(true);
  });

  it("rejects protected endpoint without auth", async () => {
    const caller = createCaller(null);
    await expect(caller.study.list()).rejects.toThrow("UNAUTHORIZED");
  });
});
