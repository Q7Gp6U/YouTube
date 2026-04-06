/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
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
}

export default nextConfig