import { beforeEach, describe, expect, it, vi } from "vitest"

const createServerSupabaseClient = vi.fn()
const startVideoSummary = vi.fn()
const pollVideoSummary = vi.fn()
const normalizeYouTubeUrl = vi.fn()
const isExternalServiceError = vi.fn((error: unknown) => error instanceof Error && "statusCode" in error)

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient,
}))

vi.mock("@/lib/video-summary", () => ({
  isExternalServiceError,
  normalizeYouTubeUrl,
  pollVideoSummary,
  startVideoSummary,
}))

type RpcResponse = {
  data: unknown[] | null
  error: { message: string } | null
}

type MockSupabase = {
  auth: {
    getUser: ReturnType<typeof vi.fn>
  }
  rpc: ReturnType<typeof vi.fn>
  from: ReturnType<typeof vi.fn>
}

function createMockSupabase(options?: {
  user?: { id: string } | null
  rpcMap?: Record<string, RpcResponse>
  summaryJob?: unknown
  profile?: unknown
}) {
  const rpcMap = options?.rpcMap ?? {}
  const summaryJob = options?.summaryJob ?? null
  const profile = options?.profile ?? { credits_balance: 7 }
  const user = options && Object.prototype.hasOwnProperty.call(options, "user") ? options.user : { id: "user-1" }

  const supabase: MockSupabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
    rpc: vi.fn(async (name: string) => rpcMap[name] ?? { data: null, error: { message: `Missing RPC mock for ${name}` } }),
    from: vi.fn((table: string) => ({
      select: vi.fn(() => {
        if (table === "summary_jobs") {
          return {
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: summaryJob,
                error: null,
              }),
            })),
          }
        }

        return {
          maybeSingle: vi.fn().mockResolvedValue({
            data: profile,
            error: null,
          }),
        }
      }),
    })),
  }

  return supabase
}

function createJsonRequest(body: unknown, init?: { headers?: Record<string, string> }) {
  return new Request("http://localhost:3000/api/summarize", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      host: "localhost:3000",
      ...init?.headers,
    },
    body: JSON.stringify(body),
  })
}

describe("app/api/summarize/route", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.NODE_ENV = "test"
    normalizeYouTubeUrl.mockImplementation((url: string) => `https://www.youtube.com/watch?v=${url.slice(-11)}`)
  })

  it("rejects unauthenticated requests", async () => {
    createServerSupabaseClient.mockResolvedValue(createMockSupabase({ user: null }))
    const { POST } = await import("@/app/api/summarize/route")

    const response = await POST(createJsonRequest({ action: "start", url: "https://youtu.be/dQw4w9WgXcQ" }))
    const payload = await response.json()

    expect(response.status).toBe(401)
    expect(payload).toMatchObject({ status: "error" })
  })

  it("returns 429 when the summary rate limit is exceeded", async () => {
    createServerSupabaseClient.mockResolvedValue(
      createMockSupabase({
        rpcMap: {
          consume_summary_rate_limit: {
            data: [{ allowed: false, retry_after_seconds: 42, remaining: 0 }],
            error: null,
          },
        },
      }),
    )
    const { POST } = await import("@/app/api/summarize/route")

    const response = await POST(createJsonRequest({ action: "start", url: "https://youtu.be/dQw4w9WgXcQ" }))

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("42")
  })

  it("returns a completed start result and persists it through RPCs", async () => {
    createServerSupabaseClient.mockResolvedValue(
      createMockSupabase({
        rpcMap: {
          consume_summary_rate_limit: {
            data: [{ allowed: true, retry_after_seconds: 0, remaining: 11 }],
            error: null,
          },
          create_summary_job: {
            data: [{ job_id: "job-1", was_created: true, credits_remaining: 8, video_title: null }],
            error: null,
          },
          complete_summary_job: {
            data: [{ job_id: "job-1", status: "completed", credits_remaining: 8 }],
            error: null,
          },
        },
      }),
    )
    startVideoSummary.mockResolvedValue({
      status: "completed",
      summary: "Кратко: Тест.\n\nГлавное:\n- Раз\n- Два\n- Три\n- Четыре\n\nВывод: Готово.",
      videoTitle: "Тестовое видео",
      model: "gemini-test",
      transcriptLanguage: "ru",
    })
    const { POST } = await import("@/app/api/summarize/route")

    const response = await POST(createJsonRequest({ action: "start", url: "https://youtu.be/dQw4w9WgXcQ" }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(startVideoSummary).toHaveBeenCalledWith("https://youtu.be/dQw4w9WgXcQ")
    expect(payload).toMatchObject({
      status: "completed",
      videoTitle: "Тестовое видео",
      model: "gemini-test",
      creditsRemaining: 8,
    })
  })

  it("returns a completed poll result from a stored job without calling the provider", async () => {
    createServerSupabaseClient.mockResolvedValue(
      createMockSupabase({
        rpcMap: {
          consume_summary_rate_limit: {
            data: [{ allowed: true, retry_after_seconds: 0, remaining: 179 }],
            error: null,
          },
        },
        summaryJob: {
          id: "550e8400-e29b-41d4-a716-446655440000",
          status: "completed",
          summary: "Кратко: Готово.\n\nГлавное:\n- Раз\n- Два\n- Три\n- Четыре\n\nВывод: Итог.",
          model: "gemini-test",
          video_title: "Из базы",
          transcript_language: "ru",
          essence_frame: null,
        },
        profile: { credits_balance: 5 },
      }),
    )
    const { POST } = await import("@/app/api/summarize/route")

    const response = await POST(createJsonRequest({ action: "poll", jobId: "550e8400-e29b-41d4-a716-446655440000" }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(pollVideoSummary).not.toHaveBeenCalled()
    expect(payload).toMatchObject({
      status: "completed",
      videoTitle: "Из базы",
      creditsRemaining: 5,
    })
  })
})
