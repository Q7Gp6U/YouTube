import { NextResponse } from "next/server"
import { z } from "zod"

import type { Database, Json } from "@/lib/database.types"
import {
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
const EXTERNAL_SERVICE_UNAVAILABLE_MESSAGE = "Сервис обработки видео временно недоступен. Попробуйте чуть позже."
const EXTERNAL_SERVICE_RATE_LIMIT_MESSAGE = "Сервис обработки видео временно ограничил запросы. Попробуйте чуть позже."
const SUMMARY_FAILED_MESSAGE = "Не удалось завершить обработку видео. Попробуйте еще раз чуть позже."
const RATE_LIMIT_TEMPORARY_ERROR_MESSAGE = "Не удалось временно проверить лимит запросов. Попробуйте чуть позже."
const PROCESSING_VIDEO_TITLE = "Видео обрабатывается"
const DEFAULT_PROCESSING_POLL_DELAY_MS = 12_000
const PROVIDER_RETRY_BASE_DELAY_MS = 30_000
const PROVIDER_RETRY_MAX_DELAY_MS = 15 * 60 * 1_000

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
type ScheduleSummaryJobRetryResult = Database["public"]["Functions"]["schedule_summary_job_retry"]["Returns"][number]
type ConsumeSummaryRateLimitResult = Database["public"]["Functions"]["consume_summary_rate_limit"]["Returns"][number]
type SummaryAction = "start" | "poll"
type SummaryRateLimitResult = {
  allowed: boolean
  retryAfterSeconds: number
  remaining: number
}
type RpcResult<T> = {
  data: T[] | null
  error: {
    message: string
  } | null
}

class RouteError extends Error {
  statusCode: number
  creditsRemaining?: number
  publicMessage: string

  constructor(
    message: string,
    statusCode: number,
    creditsRemaining?: number,
    options?: {
      publicMessage?: string
    },
  ) {
    super(message)
    this.name = "RouteError"
    this.statusCode = statusCode
    this.creditsRemaining = creditsRemaining
    this.publicMessage = options?.publicMessage ?? message
  }
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.includes(JSON_CONTENT_TYPE)) {
      return jsonError("Запрос должен быть в формате JSON.", 415)
    }

    if (!isTrustedOrigin(request, { allowMissingOrigin: false })) {
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
    const rateLimit = await checkSummaryRateLimit(supabase, user.id, body.action)

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

    if (error instanceof Error && error.message === "body-too-large") {
      return jsonError("Тело запроса слишком большое для этого метода.", 413)
    }

    if (error instanceof RouteError) {
      return jsonError(error.publicMessage, error.statusCode, error.creditsRemaining)
    }

    if (isExternalServiceError(error)) {
      return jsonError(getPublicExternalErrorMessage(error), error.statusCode)
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
  let shouldRefundOnFailure = true

  if (!reservation.was_created) {
    return buildProcessingResponse(reservation.job_id, reservation.credits_remaining, reservation.video_title)
  }

  try {
    const result = await startVideoSummary(rawUrl)
    shouldRefundOnFailure = false

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
        ...buildProcessingResponse(reservation.job_id, reservation.credits_remaining, result.videoTitle),
      }
    }

    const completed = await completeSummaryJob(supabase, reservation.job_id, result)

    return {
      ...result,
      creditsRemaining: completed.credits_remaining,
    }
  } catch (error) {
    logSummaryProcessingError("start", error, reservation.job_id)

    if (isTransientProviderError(error)) {
      const nextPollAfterMs = calculateProviderRetryDelayMs(0)

      await scheduleSummaryJobRetry(supabase, {
        jobId: reservation.job_id,
        providerAttemptCount: 0,
        publicMessage: getPublicExternalErrorMessage(error),
        internalMessage: getInternalSummaryFailureDetails(error),
      })

      return buildProcessingResponse(reservation.job_id, reservation.credits_remaining, reservation.video_title, {
        nextPollAfterMs,
      })
    }

    const publicMessage = getPublicProcessingErrorMessage(error)
    const failure = await failSummaryJob(
      supabase,
      reservation.job_id,
      publicMessage,
      getInternalSummaryFailureDetails(error),
      shouldRefundOnFailure,
    )

    if (error instanceof RouteError) {
      throw new RouteError(error.message, getPublicProcessingStatusCode(error), failure.credits_remaining, {
        publicMessage,
      })
    }

    throw new RouteError(publicMessage, getPublicProcessingStatusCode(error), failure.credits_remaining)
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
    throw new RouteError(job.error_message || SUMMARY_FAILED_MESSAGE, 409, creditsRemaining)
  }

  if (shouldWaitForProviderRetry(job)) {
    return buildProcessingResponse(job.id, creditsRemaining, job.video_title, {
      nextPollAfterMs: getRemainingProviderRetryDelayMs(job),
    })
  }

  if (!job.provider_job_id) {
    return retrySummaryStart(supabase, job, creditsRemaining)
  }

  try {
    const result = await pollVideoSummary({
      jobId: job.provider_job_id,
      url: job.normalized_url,
      videoTitle: job.video_title || undefined,
    })

    if (result.status === "processing") {
      return buildProcessingResponse(job.id, creditsRemaining, result.videoTitle)
    }

    const completed = await completeSummaryJob(supabase, job.id, result)

    return {
      ...result,
      creditsRemaining: completed.credits_remaining,
    }
  } catch (error) {
    logSummaryProcessingError("poll", error, job.id)

    if (isTransientProviderError(error)) {
      const nextPollAfterMs = calculateProviderRetryDelayMs(job.provider_attempt_count)

      await scheduleSummaryJobRetry(supabase, {
        jobId: job.id,
        providerAttemptCount: job.provider_attempt_count,
        publicMessage: getPublicExternalErrorMessage(error),
        internalMessage: getInternalSummaryFailureDetails(error),
      })

      return buildProcessingResponse(job.id, creditsRemaining, job.video_title, {
        nextPollAfterMs,
      })
    }

    const publicMessage = getPublicProcessingErrorMessage(error)
    const failure = await failSummaryJob(
      supabase,
      job.id,
      publicMessage,
      getInternalSummaryFailureDetails(error),
      false,
    )

    throw new RouteError(publicMessage, getPublicProcessingStatusCode(error), failure.credits_remaining)
  }
}

async function retrySummaryStart(
  supabase: SupabaseClient,
  job: SummaryJobRow,
  creditsRemaining: number,
): Promise<SummaryCompletedResponse | SummaryProcessingResponse> {
  let shouldRefundOnFailure = true

  try {
    const result = await startVideoSummary(job.original_url)
    shouldRefundOnFailure = false

    if (result.status === "processing") {
      const { error } = await callRpc<{ job_id: string; status: string; video_title: string | null }>(
        supabase,
        "mark_summary_job_processing",
        {
          p_job_id: job.id,
          p_provider_job_id: result.jobId,
          p_video_title: result.videoTitle,
        },
      )

      if (error) {
        throw new RouteError("Не удалось сохранить состояние обработки видео.", 500, creditsRemaining)
      }

      return buildProcessingResponse(job.id, creditsRemaining, result.videoTitle)
    }

    const completed = await completeSummaryJob(supabase, job.id, result)

    return {
      ...result,
      creditsRemaining: completed.credits_remaining,
    }
  } catch (error) {
    logSummaryProcessingError("start", error, job.id)

    if (isTransientProviderError(error)) {
      const nextPollAfterMs = calculateProviderRetryDelayMs(job.provider_attempt_count)

      await scheduleSummaryJobRetry(supabase, {
        jobId: job.id,
        providerAttemptCount: job.provider_attempt_count,
        publicMessage: getPublicExternalErrorMessage(error),
        internalMessage: getInternalSummaryFailureDetails(error),
      })

      return buildProcessingResponse(job.id, creditsRemaining, job.video_title, {
        nextPollAfterMs,
      })
    }

    const publicMessage = getPublicProcessingErrorMessage(error)
    const failure = await failSummaryJob(
      supabase,
      job.id,
      publicMessage,
      getInternalSummaryFailureDetails(error),
      shouldRefundOnFailure,
    )

    throw new RouteError(publicMessage, getPublicProcessingStatusCode(error), failure.credits_remaining)
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
    throw new RouteError("Не удалось создать задачу обработки видео.", 500)
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
    throw new RouteError("Не удалось завершить задачу обработки видео.", 500, undefined, {
      publicMessage: SUMMARY_FAILED_MESSAGE,
    })
  }

  const [completed] = data as CompleteSummaryJobResult[]

  if (!completed) {
    throw new RouteError("Не удалось завершить задачу обработки видео.", 500, undefined, {
      publicMessage: SUMMARY_FAILED_MESSAGE,
    })
  }

  return completed
}

async function failSummaryJob(
  supabase: SupabaseClient,
  jobId: string,
  publicMessage: string,
  internalMessage: string | null,
  refundCredit: boolean,
) {
  const { data, error } = await callRpc<FailSummaryJobResult>(supabase, "fail_summary_job", {
    p_job_id: jobId,
    p_public_error_message: publicMessage,
    p_internal_error_message: internalMessage,
    p_refund_credit: refundCredit,
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

async function scheduleSummaryJobRetry(
  supabase: SupabaseClient,
  options: {
    jobId: string
    providerAttemptCount: number
    publicMessage: string
    internalMessage: string | null
  },
) {
  const nextProviderAttemptAt = new Date(Date.now() + calculateProviderRetryDelayMs(options.providerAttemptCount)).toISOString()
  const { data, error } = await callRpc<ScheduleSummaryJobRetryResult>(supabase, "schedule_summary_job_retry", {
    p_job_id: options.jobId,
    p_next_provider_attempt_at: nextProviderAttemptAt,
    p_public_error_message: options.publicMessage,
    p_internal_error_message: options.internalMessage,
  })

  if (error) {
    throw new RouteError("Не удалось запланировать повтор обработки видео.", 500)
  }

  const [scheduled] = data as ScheduleSummaryJobRetryResult[]

  if (!scheduled) {
    throw new RouteError("Не удалось запланировать повтор обработки видео.", 500)
  }

  return scheduled
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

function buildProcessingResponse(
  jobId: string,
  creditsRemaining: number,
  videoTitle?: string | null,
  options?: {
    nextPollAfterMs?: number | null
  },
): SummaryProcessingResponse {
  return {
    status: "processing",
    jobId,
    videoTitle: videoTitle || PROCESSING_VIDEO_TITLE,
    creditsRemaining,
    nextPollAfterMs: normalizePollDelayMs(options?.nextPollAfterMs ?? DEFAULT_PROCESSING_POLL_DELAY_MS),
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
  const rawBody = await readRequestBodyText(request)

  if (!rawBody.trim()) {
    throw new Error("invalid-body")
  }

  let body: unknown

  try {
    body = JSON.parse(rawBody) as unknown
  } catch {
    throw new Error("invalid-json")
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("invalid-body")
  }

  return body
}

async function readRequestBodyText(request: Request) {
  const stream = request.body

  if (!stream) {
    throw new Error("invalid-body")
  }

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let bodySize = 0
  let rawBody = ""

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      if (!value) {
        continue
      }

      bodySize += value.byteLength

      if (bodySize > MAX_JSON_REQUEST_BYTES) {
        await reader.cancel("body-too-large")
        throw new Error("body-too-large")
      }

      rawBody += decoder.decode(value, { stream: true })
    }

    rawBody += decoder.decode()
  } finally {
    reader.releaseLock()
  }

  return rawBody
}

async function checkSummaryRateLimit(
  supabase: SupabaseClient,
  userId: string,
  action: SummaryAction,
): Promise<SummaryRateLimitResult> {
  const limitConfig = action === "start" ? START_RATE_LIMIT : POLL_RATE_LIMIT
  const { data, error } = await callRpc<ConsumeSummaryRateLimitResult>(supabase, "consume_summary_rate_limit", {
    p_action: action,
    p_limit: limitConfig.limit,
    p_window_seconds: Math.floor(limitConfig.windowMs / 1_000),
  })

  if (error) {
    console.warn("Supabase summarize rate limit RPC failed", {
      action,
      userId,
      message: error.message,
    })

    throw new RouteError(RATE_LIMIT_TEMPORARY_ERROR_MESSAGE, 503)
  }

  const [result] = data as ConsumeSummaryRateLimitResult[]

  if (!result) {
    console.warn("Supabase summarize rate limit returned no rows", {
      action,
      userId,
    })

    throw new RouteError(RATE_LIMIT_TEMPORARY_ERROR_MESSAGE, 503)
  }

  if (!isValidSummaryRateLimitResult(result)) {
    console.warn("Supabase summarize rate limit returned malformed payload", {
      action,
      userId,
      result,
    })

    throw new RouteError(RATE_LIMIT_TEMPORARY_ERROR_MESSAGE, 503)
  }

  return {
    allowed: result.allowed,
    retryAfterSeconds: result.retry_after_seconds,
    remaining: result.remaining,
  }
}

function getPublicProcessingErrorMessage(error: unknown) {
  if (isExternalServiceError(error)) {
    return getPublicExternalErrorMessage(error)
  }

  if (error instanceof RouteError) {
    if (error.statusCode >= 500) {
      return SUMMARY_FAILED_MESSAGE
    }

    if (error.publicMessage.trim()) {
      return error.publicMessage
    }
  }

  return SUMMARY_FAILED_MESSAGE
}

function getPublicExternalErrorMessage(error: { message: string; statusCode: number }) {
  if (error.statusCode === 429) {
    return EXTERNAL_SERVICE_RATE_LIMIT_MESSAGE
  }

  if (error.statusCode >= 500) {
    return EXTERNAL_SERVICE_UNAVAILABLE_MESSAGE
  }

  return SUMMARY_FAILED_MESSAGE
}

function isTransientProviderError(error: unknown): error is { message: string; statusCode: number } {
  if (!isExternalServiceError(error)) {
    return false
  }

  if (error.statusCode === 429 || error.statusCode === 503 || error.statusCode === 504) {
    return true
  }

  if (error.statusCode !== 502) {
    return false
  }

  const message = error.message.toLowerCase()

  if (
    message.includes("не смог вернуть транскрипт") ||
    message.includes("вернул пустой транскрипт") ||
    message.includes("принял задачу, но не вернул jobid")
  ) {
    return false
  }

  return [
    "temporarily unavailable",
    "service unavailable",
    "timed out",
    "timeout",
    "deadline exceeded",
    "не ответил вовремя",
    "временно недоступ",
    "ограничил запросы",
    "вернул ошибку 502",
    "вернул неожиданный ответ",
    "вернул некорректный json",
  ].some((fragment) => message.includes(fragment))
}

function getInternalSummaryFailureDetails(error: unknown): string | null {
  if (isExternalServiceError(error)) {
    return `external:${error.statusCode}:${error.message}`
  }

  if (error instanceof RouteError) {
    return error.message.trim() || null
  }

  if (error instanceof Error) {
    return error.message.trim() || error.name
  }

  return null
}

function getPublicProcessingStatusCode(error: unknown) {
  if (isExternalServiceError(error)) {
    if (error.statusCode === 429) {
      return 429
    }

    if (error.statusCode >= 500) {
      return 503
    }
  }

  if (error instanceof RouteError && error.statusCode < 500) {
    return error.statusCode
  }

  return 500
}

function shouldWaitForProviderRetry(job: Pick<SummaryJobRow, "next_provider_attempt_at">) {
  const retryAtMs = parseTimestamp(job.next_provider_attempt_at)
  return retryAtMs !== null && retryAtMs > Date.now()
}

function getRemainingProviderRetryDelayMs(job: Pick<SummaryJobRow, "next_provider_attempt_at">) {
  const retryAtMs = parseTimestamp(job.next_provider_attempt_at)

  if (retryAtMs === null) {
    return DEFAULT_PROCESSING_POLL_DELAY_MS
  }

  return retryAtMs - Date.now()
}

function calculateProviderRetryDelayMs(providerAttemptCount: number) {
  return Math.min(PROVIDER_RETRY_MAX_DELAY_MS, PROVIDER_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, providerAttemptCount))
}

function normalizePollDelayMs(delayMs: number) {
  if (!Number.isFinite(delayMs)) {
    return DEFAULT_PROCESSING_POLL_DELAY_MS
  }

  return Math.max(1_000, Math.round(delayMs))
}

function parseTimestamp(value: string | null) {
  if (!value) {
    return null
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function isValidSummaryRateLimitResult(value: unknown): value is ConsumeSummaryRateLimitResult {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.allowed === "boolean" &&
    typeof candidate.retry_after_seconds === "number" &&
    Number.isFinite(candidate.retry_after_seconds) &&
    candidate.retry_after_seconds >= 0 &&
    typeof candidate.remaining === "number" &&
    Number.isFinite(candidate.remaining) &&
    candidate.remaining >= 0
  )
}

function logSummaryProcessingError(stage: "start" | "poll", error: unknown, jobId: string) {
  if (isExternalServiceError(error)) {
    console.warn("Summary processing provider error", {
      stage,
      jobId,
      statusCode: error.statusCode,
      message: error.message,
    })

    return
  }

  if (error instanceof RouteError) {
    console.warn("Summary processing route error", {
      stage,
      jobId,
      statusCode: error.statusCode,
      message: error.message,
    })

    return
  }

  console.error("Summary processing unexpected error", {
    stage,
    jobId,
    error,
  })
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
