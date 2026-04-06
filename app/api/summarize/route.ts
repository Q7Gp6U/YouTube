import { NextResponse } from "next/server"

import {
  isExternalServiceError,
  pollVideoSummary,
  startVideoSummary,
} from "@/lib/video-summary"
import type { SummaryRequest } from "@/lib/video-summary-types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const JSON_CONTENT_TYPE = "application/json"
const MAX_VIDEO_TITLE_LENGTH = 300

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

    const body = await parseRequestBody(request)

    if (body.action === "start") {
      if (typeof body.url !== "string" || !body.url.trim()) {
        return NextResponse.json(
          {
            status: "error",
            message: "Передайте ссылку на YouTube-видео.",
          },
          { status: 400 },
        )
      }

      const result = await startVideoSummary(body.url.trim())

      return NextResponse.json(result, {
        status: result.status === "processing" ? 202 : 200,
      })
    }

    if (body.action === "poll") {
      if (typeof body.url !== "string" || !body.url.trim()) {
        return NextResponse.json(
          {
            status: "error",
            message: "Для проверки статуса нужна ссылка на видео.",
          },
          { status: 400 },
        )
      }

      if (typeof body.jobId !== "string" || !body.jobId.trim()) {
        return NextResponse.json(
          {
            status: "error",
            message: "Для проверки статуса нужен jobId от Supadata.",
          },
          { status: 400 },
        )
      }

      const result = await pollVideoSummary({
        action: "poll",
        jobId: body.jobId.trim(),
        url: body.url.trim(),
        videoTitle: normalizeVideoTitle(body.videoTitle),
      })

      return NextResponse.json(result, {
        status: result.status === "processing" ? 202 : 200,
      })
    }

    return NextResponse.json(
      {
        status: "error",
        message: "Неподдерживаемое действие API.",
      },
      { status: 400 },
    )
  } catch (error) {
    if (error instanceof Error && (error.message === "invalid-json" || error.message === "invalid-body")) {
      return NextResponse.json(
        {
          status: "error",
          message: "Тело запроса должно содержать корректный JSON-объект.",
        },
        { status: 400 },
      )
    }

    if (isExternalServiceError(error)) {
      return NextResponse.json(
        {
          status: "error",
          message: error.message,
        },
        { status: error.statusCode },
      )
    }

    console.error("Unexpected summarize route error", error)

    return NextResponse.json(
      {
        status: "error",
        message: "Произошла непредвиденная ошибка при обработке видео.",
      },
      { status: 500 },
    )
  }
}

async function parseRequestBody(request: Request): Promise<Partial<SummaryRequest>> {
  let body: unknown

  try {
    body = (await request.json()) as unknown
  } catch {
    throw new Error("invalid-json")
  }

  if (!body || typeof body !== "object") {
    throw new Error("invalid-body")
  }

  return body as Partial<SummaryRequest>
}

function normalizeVideoTitle(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const normalized = value.trim()

  if (!normalized) {
    return undefined
  }

  return normalized.slice(0, MAX_VIDEO_TITLE_LENGTH)
}
