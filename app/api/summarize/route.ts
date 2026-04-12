import { NextResponse } from "next/server"
import { z } from "zod"

import type { Database, Json } from "@/lib/database.types"
import {
  checkRateLimit,
  isTrustedOrigin,
  MAX_JSON_REQUEST_BYTES,
} from "@/lib/request-security"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import {
  isExternalServiceError,
  normalizeYouTubeUrl,
  pollVideoSummary,
  startVideoSummary,
} from "@/lib/video-summary"
import type {
  SummaryCompletedResponse,
  SummaryEssenceFrame,
  SummaryProcessingResponse,
} from "@/lib/video-summary-types"
import { MAX_YOUTUBE_URL_LENGTH } from "@/lib/youtube"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const JSON_CONTENT_TYPE = "application/json"
const START_RATE_LIMIT = {
  limit: 12,
  windowMs: 10 * 60 * 1_000,
}
const POLL_RATE_LIMIT = {
  limit: 180,
  windowMs: 10 * 60 * 1_000,
}

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
      jobId: z.string().uuid(),
    })
    .strict(),
])

type SummaryJobRow = Database["public"]["Tables"]["summary_jobs"]["Row"]
type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>
type CreateSummaryJobResult = Database["public"]["Functions"]["create_summary_job"]["Returns"][number]
type CompleteSummaryJobResult = Database["public"]["Functions"]["complete_summary_job"]["Returns"][number]
type FailSummaryJobResult = Database["public"]["Functions"]["fail_summary_job"]["Returns"][number]
type RpcResult<T> = {
  data: T[] | null
  error: {
    message: string
  } | null
}

class RouteError extends Error {
  statusCode: number
  creditsRemaining?: number

  constructor(message: string, statusCode: number, creditsRemaining?: number) {
    super(message)
    this.name = "RouteError"
    this.statusCode = statusCode
    this.creditsRemaining = creditsRemaining
  }
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.includes(JSON_CONTENT_TYPE)) {
      return jsonError("Запрос должен быть в формате JSON.", 415)
    }

    if (!isTrustedOrigin(request)) {
      return jsonError("Запрос отклонен политикой origin.", 403)
    }

    const contentLength = request.headers.get("content-length")

    if (contentLength && Number.parseInt(contentLength, 10) > MAX_JSON_REQUEST_BYTES) {
      return jsonError("Тело запроса слишком большое для этого метода.", 413)
    }

    const rawBody = await parseRequestBody(request)
    const parsedBody = summaryRequestSchema.safeParse(rawBody)

    if (!parsedBody.success) {
      return jsonError("Тело запроса содержит некорректные параметры.", 400)
    }

    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return jsonError("Нужно войти в аккаунт, чтобы обрабатывать видео.", 401)
    }

    const body = parsedBody.data
    const rateLimit = checkRateLimit(`${body.action}:${user.id}`, body.action === "start" ? START_RATE_LIMIT : POLL_RATE_LIMIT)

    if (!rateLimit.allowed) {
      return jsonError("Слишком много запросов. Повторите попытку чуть позже.", 429, undefined, {
        "Retry-After": String(rateLimit.retryAfterSeconds),
      })
    }

    if (body.action === "start") {
      const result = await handleStartRequest(supabase, body.url)
      return NextResponse.json(result, {
        status: result.status === "processing" ? 202 : 200,
        headers: {
          "Cache-Control": "no-store",
        },
      })
    }

    const result = await handlePollRequest(supabase, body.jobId)
    return NextResponse.json(result, {
      status: result.status === "processing" ? 202 : 200,
      headers: {
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    if (error instanceof Error && (error.message === "invalid-json" || error.message === "invalid-body")) {
      return jsonError("Тело запроса должно содержать корректный JSON-объект.", 400)
    }

    if (error instanceof RouteError) {
      return jsonError(error.message, error.statusCode, error.creditsRemaining)
    }

    if (isExternalServiceError(error)) {
      return jsonError(error.message, error.statusCode)
    }

    console.error("Unexpected summarize route error", error)

    return jsonError("Произошла непредвиденная ошибка при обработке видео.", 500)
  }
}

async function handleStartRequest(
  supabase: SupabaseClient,
  rawUrl: string,
): Promise<SummaryCompletedResponse | SummaryProcessingResponse> {
  const normalizedUrl = normalizeYouTubeUrl(rawUrl)
  const reservation = await createSummaryJobReservation(supabase, rawUrl, normalizedUrl)

  if (!reservation.was_created) {
    return {
      status: "processing",
      jobId: reservation.job_id,
      videoTitle: reservation.video_title || "Видео обрабатывается",
      creditsRemaining: reservation.credits_remaining,
    }
  }

  try {
    const result = await startVideoSummary(rawUrl)

    if (result.status === "processing") {
      const { error } = await callRpc<{ job_id: string; status: string; video_title: string | null }>(
        supabase,
        "mark_summary_job_processing",
        {
        p_job_id: reservation.job_id,
        p_provider_job_id: result.jobId,
        p_video_title: result.videoTitle,
        },
      )

      if (error) {
        throw new RouteError("Не удалось сохранить состояние обработки видео.", 500, reservation.credits_remaining)
      }

      return {
        status: "processing",
        jobId: reservation.job_id,
        videoTitle: result.videoTitle,
        creditsRemaining: reservation.credits_remaining,
      }
    }

    const completed = await completeSummaryJob(supabase, reservation.job_id, result)

    return {
      ...result,
      creditsRemaining: completed.credits_remaining,
    }
  } catch (error) {
    const failure = await failSummaryJob(supabase, reservation.job_id, getSummaryFailureMessage(error))

    if (error instanceof RouteError) {
      throw new RouteError(error.message, error.statusCode, failure.credits_remaining)
    }

    if (isExternalServiceError(error)) {
      throw new RouteError(error.message, error.statusCode, failure.credits_remaining)
    }

    throw new RouteError(getSummaryFailureMessage(error), 500, failure.credits_remaining)
  }
}

async function handlePollRequest(
  supabase: SupabaseClient,
  jobId: string,
): Promise<SummaryCompletedResponse | SummaryProcessingResponse> {
  const [job, creditsRemaining] = await Promise.all([getSummaryJob(supabase, jobId), getCurrentCredits(supabase)])

  if (!job) {
    throw new RouteError("Задача не найдена или не принадлежит текущему пользователю.", 404, creditsRemaining)
  }

  if (job.status === "completed") {
    return buildCompletedResponseFromJob(job, creditsRemaining)
  }

  if (job.status === "failed") {
    throw new RouteError(job.error_message || "Обработка завершилась с ошибкой.", 409, creditsRemaining)
  }

  if (!job.provider_job_id) {
    return {
      status: "processing",
      jobId: job.id,
      videoTitle: job.video_title || "Видео обрабатывается",
      creditsRemaining,
    }
  }

  try {
    const result = await pollVideoSummary({
      jobId: job.provider_job_id,
      url: job.normalized_url,
      videoTitle: job.video_title || undefined,
    })

    if (result.status === "processing") {
      return {
        status: "processing",
        jobId: job.id,
        videoTitle: result.videoTitle,
        creditsRemaining,
      }
    }

    const completed = await completeSummaryJob(supabase, job.id, result)

    return {
      ...result,
      creditsRemaining: completed.credits_remaining,
    }
  } catch (error) {
    const failure = await failSummaryJob(supabase, job.id, getSummaryFailureMessage(error))

    if (isExternalServiceError(error)) {
      throw new RouteError(error.message, error.statusCode, failure.credits_remaining)
    }

    throw new RouteError(getSummaryFailureMessage(error), 500, failure.credits_remaining)
  }
}

async function createSummaryJobReservation(supabase: SupabaseClient, rawUrl: string, normalizedUrl: string) {
 
  const { data, error } = await callRpc<CreateSummaryJobResult>(supabase, "create_summary_job", {
    p_original_url: rawUrl,
    p_normalized_url: normalizedUrl,
  })

  if (error) {
    if (error.message.includes("INSUFFICIENT_CREDITS")) {
      const creditsRemaining = await getCurrentCredits(supabase)
      throw new RouteError("Кредиты закончились. Сейчас обработка недоступна.", 402, creditsRemaining)
    }

    if (error.message.includes("AUTH_REQUIRED")) {
      throw new RouteError("Нужно войти в аккаунт, чтобы обрабатывать видео.", 401)
    }

    throw new RouteError("Не удалось создать задачу обработки видео.", 500)
  }

  const [reservation] = data as CreateSummaryJobResult[]

  if (!reservation) {
    throw new RouteError("Supabase не вернул данные по созданной задаче.", 500)
  }

  return reservation
}

async function completeSummaryJob(
  supabase: SupabaseClient,
  jobId: string,
  result: Omit<SummaryCompletedResponse, "creditsRemaining">,
) {
  const { data, error } = await callRpc<CompleteSummaryJobResult>(supabase, "complete_summary_job", {
    p_job_id: jobId,
    p_video_title: result.videoTitle,
    p_summary: result.summary,
    p_model: result.model,
    p_transcript_language: result.transcriptLanguage ?? null,
    p_essence_frame: (result.essenceFrame ?? null) as Json,
  })

  if (error) {
    throw new RouteError("Не удалось завершить задачу и сохранить результат.", 500)
  }

  const [completed] = data as CompleteSummaryJobResult[]

  if (!completed) {
    throw new RouteError("Supabase не вернул итог по завершенной задаче.", 500)
  }

  return completed
}

async function failSummaryJob(supabase: SupabaseClient, jobId: string, message: string) {
  const { data, error } = await callRpc<FailSummaryJobResult>(supabase, "fail_summary_job", {
    p_job_id: jobId,
    p_error_message: message,
    p_refund_credit: true,
  })

  if (error) {
    const creditsRemaining = await getCurrentCredits(supabase)
    return {
      job_id: jobId,
      status: "failed",
      credits_remaining: creditsRemaining,
      refunded: false,
    } satisfies FailSummaryJobResult
  }

  const [failed] = data as FailSummaryJobResult[]

  if (!failed) {
    const creditsRemaining = await getCurrentCredits(supabase)
    return {
      job_id: jobId,
      status: "failed",
      credits_remaining: creditsRemaining,
      refunded: false,
    } satisfies FailSummaryJobResult
  }

  return failed
}

async function getSummaryJob(supabase: SupabaseClient, jobId: string) {
  const { data, error } = await supabase.from("summary_jobs").select("*").eq("id", jobId).maybeSingle()

  if (error) {
    throw new RouteError("Не удалось получить состояние задачи.", 500)
  }

  return data as SummaryJobRow | null
}

async function getCurrentCredits(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("profiles").select("credits_balance").maybeSingle()

  if (error) {
    throw new RouteError("Не удалось получить баланс кредитов.", 500)
  }

  const profile = data as Pick<Database["public"]["Tables"]["profiles"]["Row"], "credits_balance"> | null

  return profile?.credits_balance ?? 0
}

function buildCompletedResponseFromJob(job: SummaryJobRow, creditsRemaining: number): SummaryCompletedResponse {
  if (!job.summary || !job.model || !job.video_title) {
    throw new RouteError("Задача отмечена завершенной, но результат сохранен не полностью.", 500, creditsRemaining)
  }

  return {
    status: "completed",
    summary: job.summary,
    videoTitle: job.video_title,
    model: job.model,
    transcriptLanguage: job.transcript_language ?? undefined,
    essenceFrame: parseEssenceFrame(job.essence_frame),
    creditsRemaining,
  }
}

function parseEssenceFrame(value: Json | null): SummaryEssenceFrame | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  const candidate = value as Record<string, unknown>

  if (
    typeof candidate.sheetUrl !== "string" ||
    typeof candidate.frameWidth !== "number" ||
    typeof candidate.frameHeight !== "number" ||
    typeof candidate.columns !== "number" ||
    typeof candidate.rows !== "number" ||
    typeof candidate.column !== "number" ||
    typeof candidate.row !== "number" ||
    typeof candidate.timestampMs !== "number"
  ) {
    return undefined
  }

  return {
    sheetUrl: candidate.sheetUrl,
    frameWidth: candidate.frameWidth,
    frameHeight: candidate.frameHeight,
    columns: candidate.columns,
    rows: candidate.rows,
    column: candidate.column,
    row: candidate.row,
    timestampMs: candidate.timestampMs,
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

function getSummaryFailureMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return "Не удалось завершить обработку видео."
}

function jsonError(message: string, status: number, creditsRemaining?: number, headers?: HeadersInit) {
  return NextResponse.json(
    {
      status: "error",
      message,
      ...(typeof creditsRemaining === "number" ? { creditsRemaining } : {}),
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...headers,
      },
    },
  )
}

async function callRpc<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, string | number | boolean | Json | null>,
): Promise<RpcResult<T>> {
  const rpcClient = supabase as unknown as {
    rpc: (name: string, params?: Record<string, string | number | boolean | Json | null>) => Promise<RpcResult<T>>
  }

  return rpcClient.rpc(fn, args)
}
