const isDevelopment = process.env.NODE_ENV !== "production"
const supabaseOrigin = getOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL)
const contentSecurityPolicy = buildContentSecurityPolicy()

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: ['172.18.0.1'],
  experimental: {
    serverActions: {
      allowedOrigins: ['172.18.0.1'],
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'same-origin',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          {
            key: 'Content-Security-Policy',
            value: contentSecurityPolicy,
          },
        ],
      },
    ]
  },
}

function buildContentSecurityPolicy() {
  const directives = [
    ["default-src", ["'self'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
    ["object-src", ["'none'"]],
    ["script-src", ["'self'", "'unsafe-inline'", ...(isDevelopment ? ["'unsafe-eval'"] : []), "https://va.vercel-scripts.com"]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", "https://i.ytimg.com", "https://*.ytimg.com"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'", ...(isDevelopment ? ["ws:", "wss:"] : []), supabaseOrigin, "https://vitals.vercel-insights.com"]],
    ["media-src", ["'self'", "blob:"]],
    ["worker-src", ["'self'", "blob:"]],
  ]

  return directives
    .map(([name, values]) => `${name} ${values.filter(Boolean).join(" ")}`)
    .join("; ")
}

function getOrigin(value) {
  if (!value) {
    return null
  }

  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

export default nextConfig
