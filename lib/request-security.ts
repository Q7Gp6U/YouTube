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

type TrustedOriginOptions = {
  allowMissingOrigin?: boolean
}

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

export function isTrustedOrigin(request: Request, options: TrustedOriginOptions = {}): boolean {
  const origin = request.headers.get("origin")?.trim()

  if (!origin) {
    return options.allowMissingOrigin ?? true
  }

  const normalizedOrigin = normalizeOrigin(origin)

  if (!normalizedOrigin) {
    return false
  }

  const allowedOrigins = new Set<string>()
  const configuredOrigins = getConfiguredAllowedOrigins()

  for (const configuredOrigin of configuredOrigins) {
    allowedOrigins.add(configuredOrigin)
  }

  if (isProductionEnvironment()) {
    return configuredOrigins.length > 0 && allowedOrigins.has(normalizedOrigin)
  }

  try {
    allowedOrigins.add(new URL(request.url).origin)
  } catch {
    return false
  }

  const hostOrigin = getHostOrigin(request)

  if (hostOrigin) {
    allowedOrigins.add(hostOrigin)
  }

  return allowedOrigins.has(normalizedOrigin)
}

function getConfiguredAllowedOrigins(): string[] {
  const configuredOrigins = [
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    normalizeVercelUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL),
    normalizeVercelUrl(process.env.VERCEL_URL),
  ]

  return configuredOrigins
    .map((value) => normalizeOrigin(value))
    .filter((value): value is string => value !== null)
}

function isProductionEnvironment() {
  return process.env.NODE_ENV === "production"
}

function normalizeOrigin(value: string | undefined): string | null {
  if (!value) {
    return null
  }

  try {
    return new URL(value.trim()).origin
  } catch {
    return null
  }
}

function normalizeVercelUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  return value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`
}

function getHostOrigin(request: Request): string | null {
  const host = request.headers.get("host")?.trim()

  if (!host) {
    return null
  }

  try {
    const protocol = new URL(request.url).protocol
    return new URL(`${protocol}//${host}`).origin
  } catch {
    return null
  }
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
