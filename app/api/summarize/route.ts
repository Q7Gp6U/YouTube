import { NextResponse } from "next/server"
import { z } from "zod"

import {
  checkRateLimit,
  getClientIp,
  isTrustedOrigin,
  MAX_JSON_REQUEST_BYTES,
} from "@/lib/request-security"
import {
  isExternalServiceError,
  pollVideoSummary,
  startVideoSummary,
} from "@/lib/video-summary"
import { MAX_YOUTUBE_URL_LENGTH } from "@/lib/youtube"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const JSON_CONTENT_TYPE = "application/json"
const MAX_VIDEO_TITLE_LENGTH = 300
const MAX_JOB_ID_LENGTH = 256
const START_RATE_LIMIT = {
  limit: 6,
  windowMs: 10 * 60 * 1_000,
}
const POLL_RATE_LIMIT = {
  limit: 120,
  windowMs: 10 * 60 * 1_000,
}
const SUPADATA_JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/

const summaryRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("start"),
      url: z.string().trim().min(1).max(MAX_YOUTUBE_URL_LENGTH),
    })
    .strict(),
  z
    .object({
      action: z.literal("poll"),
      url: z.string().trim().min(1).max(MAX_YOUTUBE_URL_LENGTH),
      jobId: z.string().trim().min(1).max(MAX_JOB_ID_LENGTH).regex(SUPADATA_JOB_ID_PATTERN),
      videoTitle: z.preprocess(
        (value) => {
          if (typeof value !== "string") {
            return value
          }

          const normalized = value.trim()
          return normalized ? normalized : undefined
        },
        z.string().max(MAX_VIDEO_TITLE_LENGTH).optional(),
      ),
    })
    .strict(),
])

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.includes(JSON_CONTENT_TYPE)) {
      return NextResponse.json(
        {
          status: "error",
          message: "Запрос должен быть в формате JSON.",
        },
        { status: 415 },
      )
    }

    if (!isTrustedOrigin(request)) {
      return NextResponse.json(
        {
          status: "error",
          message: "Запрос отклонен политикой origin.",
        },
        {
          status: 403,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      )
    }

    const contentLength = request.headers.get("content-length")

    if (contentLength && Number.parseInt(contentLength, 10) > MAX_JSON_REQUEST_BYTES) {
      return NextResponse.json(
        {
          status: "error",
          message: "Тело запроса слишком большое для этого метода.",
        },
        {
          status: 413,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      )
    }

    const rawBody = await parseRequestBody(request)
    const parsedBody = summaryRequestSchema.safeParse(rawBody)

    if (!parsedBody.success) {
      return NextResponse.json(
        {
          status: "error",
          message: "Тело запроса содержит некорректные параметры.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      )
    }

    const body = parsedBody.data
    const rateLimit = getRateLimitDecision(request, body.action)

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          status: "error",
          message: "Слишком много запросов. Повторите попытку чуть позже.",
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfterSeconds),
            "Cache-Control": "no-store",
          },
        },
      )
    }

    if (body.action === "start") {
      const result = await startVideoSummary(body.url)

      return NextResponse.json(result, {
        status: result.status === "processing" ? 202 : 200,
        headers: {
          "Cache-Control": "no-store",
        },
      })
    }

    const result = await pollVideoSummary({
      action: "poll",
      jobId: body.jobId,
      url: body.url,
      videoTitle: body.videoTitle,
    })

    return NextResponse.json(result, {
      status: result.status === "processing" ? 202 : 200,
      headers: {
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    if (error instanceof Error && (error.message === "invalid-json" || error.message === "invalid-body")) {
      return NextResponse.json(
        {
          status: "error",
          message: "Тело запроса должно содержать корректный JSON-объект.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      )
    }

    if (isExternalServiceError(error)) {
      return NextResponse.json(
        {
          status: "error",
          message: error.message,
        },
        {
          status: error.statusCode,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      )
    }

    console.error("Unexpected summarize route error", error)

    return NextResponse.json(
      {
        status: "error",
        message: "Произошла непредвиденная ошибка при обработке видео.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    )
  }
}

async function parseRequestBody(request: Request): Promise<unknown> {
  let body: unknown

  try {
    body = (await request.json()) as unknown
  } catch {
    throw new Error("invalid-json")
  }

  if (!body || typeof body !== "object") {
    throw new Error("invalid-body")
  }

  return body
}

function getRateLimitDecision(request: Request, action: "start" | "poll") {
  const clientIp = getClientIp(request)
  const rateLimitKey = `${action}:${clientIp}`

  return checkRateLimit(rateLimitKey, action === "start" ? START_RATE_LIMIT : POLL_RATE_LIMIT)
}
