type RateLimitResult = {
  allowed: boolean
  retryAfterSeconds: number
  remaining: number
}

type RateLimitBucket = {
  count: number
  resetAt: number
}

const rateLimitBuckets = new Map<string, RateLimitBucket>()
const MAX_RATE_LIMIT_BUCKETS = 5_000

export const MAX_JSON_REQUEST_BYTES = 4_096

export function checkRateLimit(
  key: string,
  options: {
    limit: number
    windowMs: number
  },
): RateLimitResult {
  const now = Date.now()
  cleanupExpiredBuckets(now)

  const current = rateLimitBuckets.get(key)

  if (!current || current.resetAt <= now) {
    rateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + options.windowMs,
    })

    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: Math.max(options.limit - 1, 0),
    }
  }

  if (current.count >= options.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(Math.ceil((current.resetAt - now) / 1_000), 1),
      remaining: 0,
    }
  }

  current.count += 1

  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: Math.max(options.limit - current.count, 0),
  }
}

export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")

  if (forwardedFor) {
    const [firstIp = ""] = forwardedFor.split(",")
    const normalized = firstIp.trim()

    if (normalized) {
      return normalized
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim()

  if (realIp) {
    return realIp
  }

  return "unknown"
}

export function isTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin")

  if (!origin) {
    return true
  }

  const allowedOrigins = new Set<string>()

  try {
    allowedOrigins.add(new URL(request.url).origin)
  } catch {
    return false
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.trim() || request.headers.get("host")?.trim()
  const forwardedProto = request.headers.get("x-forwarded-proto")?.trim() || "https"

  if (forwardedHost) {
    allowedOrigins.add(`${forwardedProto}://${forwardedHost}`)
  }

  return allowedOrigins.has(origin)
}

function cleanupExpiredBuckets(now: number) {
  if (rateLimitBuckets.size < MAX_RATE_LIMIT_BUCKETS) {
    return
  }

  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(key)
    }
  }
}
