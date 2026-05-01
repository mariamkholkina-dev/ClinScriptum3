import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

let mockExecResults: [Error | null, unknown][][] = [];

vi.mock("ioredis", () => {
  const mockMulti = {
    zremrangebyscore: vi.fn().mockReturnThis(),
    zadd: vi.fn().mockReturnThis(),
    zcard: vi.fn().mockReturnThis(),
    pexpire: vi.fn().mockReturnThis(),
    exec: vi.fn(() => Promise.resolve(mockExecResults.shift() ?? [])),
  };

  class RedisMock {
    connect() { return Promise.resolve(); }
    multi() { return mockMulti; }
  }

  return { Redis: RedisMock, __mockMulti: mockMulti };
});

// Must import after mock setup
const { rateLimiter } = await import("../rate-limiter.js");

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    ip: "127.0.0.1",
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response & { statusCode: number; body: unknown; headers: Record<string, string | number> } {
  const res = {
    statusCode: 200,
    body: null as unknown,
    headers: {} as Record<string, string | number>,
    setHeader(key: string, value: string | number) {
      res.headers[key] = value;
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown; headers: Record<string, string | number> };
}

function setNextCount(count: number) {
  mockExecResults.push([
    [null, 0],         // zremrangebyscore
    [null, 1],         // zadd
    [null, count],     // zcard
    [null, 1],         // pexpire
  ]);
}

describe("rateLimiter (Redis-backed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecResults = [];
  });

  it("allows requests within the limit", async () => {
    const limiter = rateLimiter(5);
    const req = mockReq({ ip: "10.0.0.1" });
    const res = mockRes();
    const next = vi.fn();

    setNextCount(3);

    await limiter(req, res as unknown as Response, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it("blocks requests exceeding the limit", async () => {
    const limiter = rateLimiter(3);
    const req = mockReq({ ip: "10.0.0.2" });
    const res = mockRes();
    const next = vi.fn();

    setNextCount(4);

    await limiter(req, res as unknown as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: "Too many requests" });
  });

  it("sets rate limit headers", async () => {
    const limiter = rateLimiter(10);
    const req = mockReq({ ip: "10.0.0.4" });
    const res = mockRes();
    const next = vi.fn();

    setNextCount(1);

    await limiter(req, res as unknown as Response, next as NextFunction);

    expect(res.headers["X-RateLimit-Limit"]).toBe(10);
    expect(res.headers["X-RateLimit-Remaining"]).toBe(9);
    expect(res.headers["X-RateLimit-Reset"]).toBeGreaterThan(0);
  });

  it("uses userId from JWT as rate limit key", async () => {
    const { __mockMulti: mockMulti } = await import("ioredis") as any;
    const limiter = rateLimiter(2);
    const next = vi.fn();

    const payload = { userId: "user-123", tenantId: "t1", role: "writer" };
    const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const fakeJwt = `header.${b64}.signature`;

    const reqWithJwt = mockReq({
      ip: "10.0.0.5",
      headers: { authorization: `Bearer ${fakeJwt}` },
    });

    setNextCount(1);

    await limiter(reqWithJwt, mockRes() as unknown as Response, next as NextFunction);

    const zaddCall = mockMulti.zremrangebyscore.mock.calls[0];
    expect(zaddCall[0]).toBe("rl:user:user-123");
  });

  it("falls back to IP key when no JWT", async () => {
    const { __mockMulti: mockMulti } = await import("ioredis") as any;
    const limiter = rateLimiter(2);
    const next = vi.fn();

    const req = mockReq({ ip: "192.168.1.1" });

    setNextCount(1);

    await limiter(req, mockRes() as unknown as Response, next as NextFunction);

    const zaddCall = mockMulti.zremrangebyscore.mock.calls[0];
    expect(zaddCall[0]).toBe("rl:ip:192.168.1.1");
  });

  it("falls back to IP key when JWT is malformed", async () => {
    const { __mockMulti: mockMulti } = await import("ioredis") as any;
    const limiter = rateLimiter(2);
    const next = vi.fn();

    // Malformed JWT — base64-decoding the second segment will produce invalid JSON
    const malformedJwt = "header.notbase64-or-json.signature";
    const req = mockReq({
      ip: "10.0.0.99",
      headers: { authorization: `Bearer ${malformedJwt}` },
    });

    setNextCount(1);

    await limiter(req, mockRes() as unknown as Response, next as NextFunction);

    const zaddCall = mockMulti.zremrangebyscore.mock.calls[0];
    expect(zaddCall[0]).toBe("rl:ip:10.0.0.99");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("falls back to IP key when Bearer prefix is missing", async () => {
    const { __mockMulti: mockMulti } = await import("ioredis") as any;
    const limiter = rateLimiter(2);
    const next = vi.fn();

    const req = mockReq({
      ip: "10.0.0.100",
      headers: { authorization: "Basic abcdef" },
    });

    setNextCount(1);

    await limiter(req, mockRes() as unknown as Response, next as NextFunction);

    const zaddCall = mockMulti.zremrangebyscore.mock.calls[0];
    expect(zaddCall[0]).toBe("rl:ip:10.0.0.100");
  });

  it("uses 'unknown' suffix when neither JWT nor IP is available", async () => {
    const { __mockMulti: mockMulti } = await import("ioredis") as any;
    const limiter = rateLimiter(2);
    const next = vi.fn();

    const req = mockReq({ ip: undefined });

    setNextCount(1);

    await limiter(req, mockRes() as unknown as Response, next as NextFunction);

    const zaddCall = mockMulti.zremrangebyscore.mock.calls[0];
    expect(zaddCall[0]).toBe("rl:ip:unknown");
  });

  it("at exact boundary (count == limit) request is allowed", async () => {
    const limiter = rateLimiter(5);
    const req = mockReq({ ip: "10.0.0.10" });
    const res = mockRes();
    const next = vi.fn();

    setNextCount(5);

    await limiter(req, res as unknown as Response, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.headers["X-RateLimit-Remaining"]).toBe(0);
  });

  it("X-RateLimit-Remaining never goes negative", async () => {
    const limiter = rateLimiter(3);
    const req = mockReq({ ip: "10.0.0.11" });
    const res = mockRes();
    const next = vi.fn();

    setNextCount(100);

    await limiter(req, res as unknown as Response, next as NextFunction);

    expect(res.headers["X-RateLimit-Remaining"]).toBe(0);
    expect(res.statusCode).toBe(429);
  });

  it("fails open (calls next) when Redis exec throws", async () => {
    const { __mockMulti: mockMulti } = await import("ioredis") as any;
    const limiter = rateLimiter(5);
    const req = mockReq({ ip: "10.0.0.12" });
    const res = mockRes();
    const next = vi.fn();

    mockMulti.exec.mockRejectedValueOnce(new Error("redis down"));

    await limiter(req, res as unknown as Response, next as NextFunction);

    // fail-open: request continues, no 429
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });
});
