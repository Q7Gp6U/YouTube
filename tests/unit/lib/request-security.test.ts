import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { checkRateLimit, getClientIp, isTrustedOrigin } from "@/lib/request-security"

describe("lib/request-security", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
    delete process.env.APP_URL
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.NEXT_PUBLIC_SITE_URL
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL
    delete process.env.VERCEL_URL
    process.env.NODE_ENV = "test"
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("enforces the configured rate limit window per key", () => {
    expect(checkRateLimit("user:start", { limit: 2, windowMs: 1000 })).toMatchObject({ allowed: true, remaining: 1 })
    expect(checkRateLimit("user:start", { limit: 2, windowMs: 1000 })).toMatchObject({ allowed: true, remaining: 0 })
    expect(checkRateLimit("user:start", { limit: 2, windowMs: 1000 })).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 1,
    })

    vi.advanceTimersByTime(1001)

    expect(checkRateLimit("user:start", { limit: 2, windowMs: 1000 })).toMatchObject({ allowed: true, remaining: 1 })
  })

  it("extracts the client IP from forwarding headers", () => {
    const forwardedRequest = new Request("https://app.test/api", {
      headers: {
        "x-forwarded-for": "198.51.100.10, 198.51.100.11",
      },
    })
    const realIpRequest = new Request("https://app.test/api", {
      headers: {
        "x-real-ip": "203.0.113.5",
      },
    })

    expect(getClientIp(forwardedRequest)).toBe("198.51.100.10")
    expect(getClientIp(realIpRequest)).toBe("203.0.113.5")
    expect(getClientIp(new Request("https://app.test/api"))).toBe("unknown")
  })

  it("accepts same-origin requests in non-production and blocks unknown origins in production", () => {
    const devRequest = new Request("https://app.test/api/summarize", {
      headers: {
        origin: "https://app.test",
        host: "app.test",
      },
    })

    expect(isTrustedOrigin(devRequest, { allowMissingOrigin: false })).toBe(true)

    process.env.NODE_ENV = "production"
    process.env.APP_URL = "https://allowed.example"

    const allowedRequest = new Request("https://app.test/api/summarize", {
      headers: {
        origin: "https://allowed.example",
      },
    })
    const blockedRequest = new Request("https://app.test/api/summarize", {
      headers: {
        origin: "https://evil.example",
      },
    })

    expect(isTrustedOrigin(allowedRequest, { allowMissingOrigin: false })).toBe(true)
    expect(isTrustedOrigin(blockedRequest, { allowMissingOrigin: false })).toBe(false)
  })
})
