const YOUTUBE_WATCH_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"])
const YOUTUBE_SHORT_HOST = "youtu.be"
const SUPPORTED_PATH_PREFIXES = new Set(["shorts", "embed", "live"])

export const MAX_YOUTUBE_URL_LENGTH = 2_000
export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/

export function extractYouTubeVideoId(rawUrl: string): string | null {
  if (!rawUrl || rawUrl.length > MAX_YOUTUBE_URL_LENGTH) {
    return null
  }

  let parsedUrl: URL

  try {
    parsedUrl = new URL(rawUrl.trim())
  } catch {
    return null
  }

  const hostname = normalizeHostname(parsedUrl.hostname)

  if (hostname === YOUTUBE_SHORT_HOST) {
    const [firstSegment = ""] = parsedUrl.pathname.split("/").filter(Boolean)
    return normalizeVideoId(firstSegment)
  }

  if (!YOUTUBE_WATCH_HOSTS.has(hostname)) {
    return null
  }

  if (parsedUrl.pathname === "/watch") {
    return normalizeVideoId(parsedUrl.searchParams.get("v"))
  }

  const segments = parsedUrl.pathname.split("/").filter(Boolean)

  if (segments.length >= 2 && SUPPORTED_PATH_PREFIXES.has(segments[0])) {
    return normalizeVideoId(segments[1])
  }

  return null
}

export function normalizeYouTubeWatchUrl(rawUrl: string): string | null {
  const videoId = extractYouTubeVideoId(rawUrl)
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null
}

export function normalizeVideoId(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const normalized = value.trim()
  return YOUTUBE_VIDEO_ID_PATTERN.test(normalized) ? normalized : null
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/\.+$/, "").toLowerCase()
}
