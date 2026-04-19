import { describe, expect, it } from "vitest"

import { extractYouTubeVideoId, normalizeVideoId, normalizeYouTubeWatchUrl } from "@/lib/youtube"

describe("lib/youtube", () => {
  it("extracts a video id from supported YouTube URL formats", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
    expect(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ?t=43")).toBe("dQw4w9WgXcQ")
    expect(extractYouTubeVideoId("https://m.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
    expect(extractYouTubeVideoId("https://music.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
  })

  it("rejects unsupported hosts and invalid identifiers", () => {
    expect(extractYouTubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull()
    expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=bad-id")).toBeNull()
    expect(extractYouTubeVideoId("not-a-url")).toBeNull()
  })

  it("normalizes valid URLs to a canonical watch URL", () => {
    expect(normalizeYouTubeWatchUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
  })

  it("normalizes raw video ids only when they match the expected format", () => {
    expect(normalizeVideoId(" dQw4w9WgXcQ ")).toBe("dQw4w9WgXcQ")
    expect(normalizeVideoId("too-short")).toBeNull()
    expect(normalizeVideoId(null)).toBeNull()
  })
})
