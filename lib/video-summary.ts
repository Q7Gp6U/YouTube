import { GoogleGenAI, ThinkingLevel } from "@google/genai"

import type {
  SummaryCompletedResponse,
  SummaryPollRequest,
  SummaryProcessingResponse,
} from "@/lib/video-summary-types"

const SUPADATA_BASE_URL = "https://api.supadata.ai/v1"
const GEMINI_MODEL = "gemini-3.1-flash-lite-preview"
const MAX_TRANSCRIPT_CHARACTERS = 60_000
const CHUNK_SIZE = 12_000
const SUPADATA_METADATA_TIMEOUT_MS = 5_000
const SUPADATA_TRANSCRIPT_INITIAL_TIMEOUT_MS = 18_000
const SUPADATA_TRANSCRIPT_POLL_TIMEOUT_MS = 8_000
const GEMINI_TIMEOUT_MS = 18_000
const SUPADATA_METADATA_RETRY_ATTEMPTS = 0
const SUPADATA_TRANSCRIPT_INITIAL_RETRY_ATTEMPTS = 1
const SUPADATA_TRANSCRIPT_POLL_RETRY_ATTEMPTS = 2
const GEMINI_RETRY_ATTEMPTS = 1
const RETRY_DELAY_MS = 750
const MAX_URL_LENGTH = 2_000
const MAX_JOB_ID_LENGTH = 256

type SupadataTranscriptResponse =
  | {
      content: string
      lang?: string
      availableLangs?: string[]
    }
  | {
      jobId: string
    }

type SupadataTranscriptAcceptedResponse = {
  jobId: string
  status?: "queued" | "active" | "processing"
}

type SupadataTranscriptJobResponse = {
  status: "queued" | "active" | "processing" | "completed" | "failed"
  content?: string
  lang?: string
  availableLangs?: string[]
  error?: {
    message?: string
    details?: string
  }
}

type SupadataMetadataResponse = {
  title: string | null
}

type SupadataApiResponse<T> = {
  status: number
  payload: T
}

let geminiClient: GoogleGenAI | null = null

class ExternalServiceError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 500) {
    super(message)
    this.name = "ExternalServiceError"
    this.statusCode = statusCode
  }
}

export function normalizeYouTubeUrl(rawUrl: string): string {
  if (rawUrl.length > MAX_URL_LENGTH) {
    throw new ExternalServiceError("Ссылка на YouTube-видео слишком длинная.", 400)
  }

  let parsedUrl: URL

  try {
    parsedUrl = new URL(rawUrl.trim())
  } catch {
    throw new ExternalServiceError("Введите корректную ссылку на YouTube-видео.", 400)
  }

  const hostname = parsedUrl.hostname.replace(/^www\./, "").toLowerCase()
  let videoId = ""

  if (hostname === "youtu.be") {
    videoId = parsedUrl.pathname.slice(1)
  } else if (hostname.endsWith("youtube.com")) {
    if (parsedUrl.pathname === "/watch") {
      videoId = parsedUrl.searchParams.get("v") ?? ""
    } else {
      const segments = parsedUrl.pathname.split("/").filter(Boolean)
      const supportedPrefixes = new Set(["shorts", "embed", "live"])

      if (segments.length >= 2 && supportedPrefixes.has(segments[0])) {
        videoId = segments[1]
      }
    }
  }

  if (!videoId) {
    throw new ExternalServiceError("Ссылка должна вести на конкретное YouTube-видео.", 400)
  }

  return `https://www.youtube.com/watch?v=${videoId}`
}

export async function startVideoSummary(
  rawUrl: string,
): Promise<SummaryCompletedResponse | SummaryProcessingResponse> {
  const url = normalizeYouTubeUrl(rawUrl)

  const [transcriptResponse, videoTitle] = await Promise.all([
    fetchSupadataTranscript(url),
    resolveVideoTitle(url),
  ])

  if ("jobId" in transcriptResponse) {
    return {
      status: "processing",
      jobId: transcriptResponse.jobId,
      videoTitle,
    }
  }

  return createCompletedSummary({
    transcript: transcriptResponse.content,
    transcriptLanguage: transcriptResponse.lang,
    videoTitle,
  })
}

export async function pollVideoSummary(
  request: SummaryPollRequest,
): Promise<SummaryCompletedResponse | SummaryProcessingResponse> {
  const url = normalizeYouTubeUrl(request.url)
  const jobId = normalizeJobId(request.jobId)
  const jobResult = await fetchSupadataTranscriptJob(jobId)

  if (jobResult.status === "queued" || jobResult.status === "active" || jobResult.status === "processing") {
    return {
      status: "processing",
      jobId,
      videoTitle: request.videoTitle || "Видео обрабатывается",
    }
  }

  if (jobResult.status === "failed") {
    const message =
      jobResult.error?.details ||
      jobResult.error?.message ||
      "Supadata не смог вернуть транскрипт для этого видео."

    throw new ExternalServiceError(message, 502)
  }

  if (!jobResult.content?.trim()) {
    throw new ExternalServiceError("Supadata вернул пустой транскрипт.", 502)
  }

  const videoTitle = request.videoTitle || (await resolveVideoTitle(url))

  return createCompletedSummary({
    transcript: jobResult.content,
    transcriptLanguage: jobResult.lang,
    videoTitle,
  })
}

export function isExternalServiceError(error: unknown): error is ExternalServiceError {
  return error instanceof ExternalServiceError
}

async function createCompletedSummary({
  transcript,
  transcriptLanguage,
  videoTitle,
}: {
  transcript: string
  transcriptLanguage?: string
  videoTitle: string
}): Promise<SummaryCompletedResponse> {
  if (!transcript.trim()) {
    throw new ExternalServiceError("Не удалось получить текст транскрипта для обработки.", 502)
  }

  const { summary, model } = await summarizeTranscript({
    transcript,
    videoTitle,
  })

  return {
    status: "completed",
    summary,
    videoTitle,
    model,
    transcriptLanguage,
  }
}

async function fetchSupadataMetadata(url: string): Promise<SupadataMetadataResponse> {
  const params = new URLSearchParams({ url })
  const { payload } = await fetchSupadata<SupadataMetadataResponse>(`/metadata?${params.toString()}`, {
    retries: SUPADATA_METADATA_RETRY_ATTEMPTS,
    timeoutMs: SUPADATA_METADATA_TIMEOUT_MS,
  })
  return payload
}

async function resolveVideoTitle(url: string): Promise<string> {
  const metadata = await fetchSupadataMetadataSafely(url)
  return metadata?.title?.trim() || "Видео без названия"
}

async function fetchSupadataMetadataSafely(url: string): Promise<SupadataMetadataResponse | null> {
  try {
    return await fetchSupadataMetadata(url)
  } catch (error) {
    if (!isExternalServiceError(error)) {
      throw error
    }

    console.warn("Supadata metadata request failed; using fallback title", {
      message: error.message,
      statusCode: error.statusCode,
      url,
    })

    return null
  }
}

async function fetchSupadataTranscript(url: string): Promise<SupadataTranscriptResponse> {
  const params = new URLSearchParams({
    url,
    text: "true",
    mode: "auto",
  })

  const { status, payload } = await fetchSupadata<
    SupadataTranscriptResponse | SupadataTranscriptJobResponse | SupadataTranscriptAcceptedResponse
  >(`/transcript?${params.toString()}`, {
    retries: SUPADATA_TRANSCRIPT_INITIAL_RETRY_ATTEMPTS,
    timeoutMs: SUPADATA_TRANSCRIPT_INITIAL_TIMEOUT_MS,
  })

  return normalizeSupadataTranscriptResponse(status, payload)
}

async function fetchSupadataTranscriptJob(jobId: string): Promise<SupadataTranscriptJobResponse> {
  const normalizedJobId = normalizeJobId(jobId)
  const { status, payload } = await fetchSupadata<
    SupadataTranscriptJobResponse | SupadataTranscriptResponse
  >(`/transcript/${encodeURIComponent(normalizedJobId)}`, {
    retries: SUPADATA_TRANSCRIPT_POLL_RETRY_ATTEMPTS,
    timeoutMs: SUPADATA_TRANSCRIPT_POLL_TIMEOUT_MS,
  })

  return normalizeSupadataTranscriptJobResponse(status, payload)
}

async function fetchSupadata<T>(
  path: string,
  requestOptions: {
    retries: number
    timeoutMs: number
  },
): Promise<SupadataApiResponse<T>> {
  const response = await fetchWithRetry(`${SUPADATA_BASE_URL}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "x-api-key": getRequiredEnv("SUPADATA_API_KEY"),
    },
    cache: "no-store",
    serviceName: "Supadata",
    timeoutMs: requestOptions.timeoutMs,
    retries: requestOptions.retries,
  })

  return {
    status: response.status,
    payload: await parseJsonResponse<T>(response, "Supadata"),
  }
}

async function summarizeTranscript({
  transcript,
  videoTitle,
}: {
  transcript: string
  videoTitle: string
}): Promise<{ summary: string; model: string }> {
  const preparedTranscript = trimTranscript(transcript)
  const transcriptChunks = splitTranscript(preparedTranscript, CHUNK_SIZE)

  if (transcriptChunks.length === 1) {
    return callGemini({
      prompt: buildSinglePrompt(videoTitle, transcriptChunks[0]),
      maxOutputTokens: 500,
    })
  }

  const chunkSummaries: string[] = []
  let resolvedModel = GEMINI_MODEL

  for (const [index, chunk] of transcriptChunks.entries()) {
    const partial = await callGemini({
      prompt: buildChunkPrompt(videoTitle, chunk, index + 1, transcriptChunks.length),
      maxOutputTokens: 350,
    })

    chunkSummaries.push(partial.summary)
    resolvedModel = partial.model
  }

  const combined = await callGemini({
    prompt: buildCombinePrompt(videoTitle, chunkSummaries),
    maxOutputTokens: 500,
  })

  return {
    summary: combined.summary,
    model: combined.model || resolvedModel,
  }
}

async function callGemini({
  prompt,
  maxOutputTokens,
}: {
  prompt: string
  maxOutputTokens: number
}): Promise<{ summary: string; model: string }> {
  const ai = getGeminiClient()
  let lastError: unknown

  for (let attempt = 0; attempt <= GEMINI_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction:
            "Ты делаешь краткие содержания YouTube-видео. Всегда отвечай только на русском языке. Не выдумывай факты. Если транскрипт шумный или неполный, аккуратно восстанови смысл только там, где он явно следует из текста. Если часть информации неясна, прямо укажи это на русском языке без домыслов.",
          temperature: 0.2,
          maxOutputTokens,
          responseMimeType: "text/plain",
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.MINIMAL,
          },
          httpOptions: {
            timeout: GEMINI_TIMEOUT_MS,
            retryOptions: {
              attempts: 1,
            },
          },
        },
      })

      const summary = ensureRussianSummary(response.text ?? "")

      if (!summary) {
        throw new ExternalServiceError("Gemini вернул пустой ответ при создании краткого содержания.", 502)
      }

      return {
        summary,
        model: response.modelVersion || GEMINI_MODEL,
      }
    } catch (error) {
      lastError = error

      if (attempt === GEMINI_RETRY_ATTEMPTS || !isRetryableGeminiError(error)) {
        throw createGeminiRequestError(error)
      }

      await wait(RETRY_DELAY_MS * (attempt + 1))
    }
  }

  throw createGeminiRequestError(lastError)
}

async function parseJsonResponse<T>(response: Response, serviceName: string): Promise<T> {
  const rawText = await response.text()
  const payload = rawText ? tryParseJson(rawText) : null

  if (!response.ok) {
    const message =
      response.status === 429
        ? `${serviceName} временно ограничил запросы. Попробуйте еще раз через минуту.`
        : extractErrorMessage(payload) || `${serviceName} вернул ошибку ${response.status}.`
    throw new ExternalServiceError(message, response.status >= 400 && response.status < 600 ? response.status : 502)
  }

  if (payload === null) {
    throw new ExternalServiceError(`${serviceName} вернул некорректный JSON-ответ.`, 502)
  }

  return payload as T
}

async function fetchWithRetry(
  input: string,
  init: RequestInit & {
    retries: number
    serviceName: string
    timeoutMs: number
  },
): Promise<Response> {
  const { retries, serviceName, timeoutMs, ...requestInit } = init
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(input, {
        ...requestInit,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!shouldRetryResponse(response.status) || attempt === retries) {
        return response
      }

      await wait(getRetryDelay(attempt, response))
      continue
    } catch (error) {
      clearTimeout(timeoutId)
      lastError = error

      if (attempt === retries || !isRetryableFetchError(error)) {
        throw createRequestError(serviceName, error)
      }

      await wait(getRetryDelay(attempt))
    }
  }

  throw createRequestError(serviceName, lastError)
}

function tryParseJson(rawText: string): unknown | null {
  try {
    return JSON.parse(rawText)
  } catch {
    return null
  }
}

function extractErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null
  }

  if ("error" in payload) {
    const errorValue = payload.error

    if (typeof errorValue === "string") {
      return errorValue
    }

    if (errorValue && typeof errorValue === "object" && "message" in errorValue) {
      const nestedMessage = errorValue.message
      if (typeof nestedMessage === "string" && nestedMessage.trim()) {
        return nestedMessage
      }
    }
  }

  if ("message" in payload && typeof payload.message === "string" && payload.message.trim()) {
    return payload.message
  }

  return null
}

function normalizeSupadataTranscriptResponse(
  statusCode: number,
  payload: SupadataTranscriptResponse | SupadataTranscriptJobResponse | SupadataTranscriptAcceptedResponse,
): SupadataTranscriptResponse {
  if (statusCode === 202) {
    if (hasJobId(payload)) {
      return { jobId: payload.jobId }
    }

    throw new ExternalServiceError("Supadata принял задачу, но не вернул jobId.", 502)
  }

  if (hasTranscriptContent(payload)) {
    return {
      content: payload.content,
      lang: payload.lang,
      availableLangs: payload.availableLangs,
    }
  }

  if (hasJobId(payload)) {
    return { jobId: payload.jobId }
  }

  if (hasSupadataStatus(payload) && payload.status === "failed") {
    const message = payload.error?.details || payload.error?.message || "Supadata не смог вернуть транскрипт для этого видео."
    throw new ExternalServiceError(message, 502)
  }

  throw new ExternalServiceError("Supadata вернул неожиданный ответ при запросе транскрипта.", 502)
}

function normalizeSupadataTranscriptJobResponse(
  statusCode: number,
  payload: SupadataTranscriptJobResponse | SupadataTranscriptResponse,
): SupadataTranscriptJobResponse {
  if (hasSupadataStatus(payload)) {
    if (payload.status === "processing") {
      return {
        ...payload,
        status: "active",
      }
    }

    return payload
  }

  if (statusCode === 202) {
    return { status: "queued" }
  }

  if (hasTranscriptContent(payload)) {
    return {
      status: "completed",
      content: payload.content,
      lang: payload.lang,
      availableLangs: payload.availableLangs,
    }
  }

  throw new ExternalServiceError("Supadata вернул неожиданный ответ при проверке статуса транскрипта.", 502)
}

function ensureRussianSummary(summary: string): string {
  const normalized = summary.trim()

  if (!normalized) {
    return ""
  }

  if (/[А-Яа-яЁё]/.test(normalized)) {
    return normalized
  }

  throw new ExternalServiceError("Gemini вернул ответ не на русском языке.", 502)
}

function trimTranscript(transcript: string): string {
  const normalized = transcript
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  if (normalized.length <= MAX_TRANSCRIPT_CHARACTERS) {
    return normalized
  }

  const headLength = Math.floor(MAX_TRANSCRIPT_CHARACTERS * 0.6)
  const tailLength = MAX_TRANSCRIPT_CHARACTERS - headLength

  return [
    normalized.slice(0, headLength),
    "[... часть очень длинного транскрипта пропущена ...]",
    normalized.slice(-tailLength),
  ].join("\n\n")
}

function splitTranscript(transcript: string, maxChunkSize: number): string[] {
  const sentences = transcript.split(/(?<=[.!?])\s+/).filter(Boolean)

  if (sentences.length === 0) {
    return [transcript]
  }

  const chunks: string[] = []
  let currentChunk = ""

  for (const sentence of sentences) {
    if (sentence.length > maxChunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim())
        currentChunk = ""
      }

      for (let offset = 0; offset < sentence.length; offset += maxChunkSize) {
        chunks.push(sentence.slice(offset, offset + maxChunkSize).trim())
      }

      continue
    }

    const nextChunk = currentChunk ? `${currentChunk} ${sentence}` : sentence

    if (nextChunk.length > maxChunkSize) {
      chunks.push(currentChunk.trim())
      currentChunk = sentence
      continue
    }

    currentChunk = nextChunk
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim())
  }

  return chunks
}

function buildSinglePrompt(videoTitle: string, transcript: string): string {
  return [
    `Название видео: ${videoTitle}`,
    "",
    "Ниже транскрипт YouTube-видео. Сделай краткое содержание на русском языке.",
    "Формат ответа:",
    "Кратко: 1-2 предложения о сути видео.",
    "Главное:",
    "- 4-6 ключевых мыслей или фактов.",
    "Вывод: 1 короткое заключение.",
    "Не пиши про таймкоды, не ссылайся на то, что это транскрипт, не добавляй вымышленные детали.",
    "Весь ответ должен быть только на русском языке.",
    "",
    transcript,
  ].join("\n")
}

function buildChunkPrompt(
  videoTitle: string,
  transcriptChunk: string,
  chunkNumber: number,
  totalChunks: number,
): string {
  return [
    `Название видео: ${videoTitle}`,
    `Часть ${chunkNumber} из ${totalChunks}.`,
    "",
    "Сделай промежуточное краткое содержание только этой части видео на русском языке.",
    "Верни 4-5 коротких пунктов с главными мыслями без вступления и без вывода.",
    "Пиши только на русском языке.",
    "",
    transcriptChunk,
  ].join("\n")
}

function buildCombinePrompt(videoTitle: string, chunkSummaries: string[]): string {
  return [
    `Название видео: ${videoTitle}`,
    "",
    "Ниже идут краткие содержания частей одного YouTube-видео.",
    "Объедини их в единое итоговое краткое содержание строго на русском языке.",
    "Формат ответа:",
    "Кратко: 1-2 предложения.",
    "Главное:",
    "- 4-6 ключевых пунктов.",
    "Вывод: 1 короткое предложение.",
    "Не упоминай части, не повторяй одну и ту же мысль несколько раз.",
    "Весь ответ должен быть только на русском языке.",
    "",
    chunkSummaries.join("\n\n"),
  ].join("\n")
}

function hasJobId(value: unknown): value is { jobId: string } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "jobId" in value &&
      typeof value.jobId === "string" &&
      value.jobId.trim(),
  )
}

function hasTranscriptContent(
  value: unknown,
): value is { content: string; lang?: string; availableLangs?: string[] } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "content" in value &&
      typeof value.content === "string" &&
      value.content.trim(),
  )
}

function hasSupadataStatus(value: unknown): value is SupadataTranscriptJobResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      "status" in value &&
      typeof value.status === "string" &&
      ["queued", "active", "processing", "completed", "failed"].includes(value.status),
  )
}

function normalizeJobId(jobId: string): string {
  const normalized = jobId.trim()

  if (!normalized) {
    throw new ExternalServiceError("Для проверки статуса нужен jobId от Supadata.", 400)
  }

  if (normalized.length > MAX_JOB_ID_LENGTH) {
    throw new ExternalServiceError("jobId от Supadata имеет некорректную длину.", 400)
  }

  return normalized
}

function getRequiredEnv(name: "SUPADATA_API_KEY" | "GEMINI_API_KEY"): string {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new ExternalServiceError(`Не настроена переменная окружения ${name}.`, 500)
  }

  return value
}

function shouldRetryResponse(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

function isRetryableFetchError(error: unknown): boolean {
  if (error instanceof ExternalServiceError) {
    return false
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return true
  }

  return error instanceof TypeError
}

function isRetryableGeminiError(error: unknown): boolean {
  if (error instanceof ExternalServiceError) {
    return false
  }

  if (!error || typeof error !== "object") {
    return false
  }

  const status =
    "status" in error && typeof error.status === "number"
      ? error.status
      : "code" in error && typeof error.code === "number"
        ? error.code
        : null

  return status !== null ? shouldRetryResponse(status) : error instanceof TypeError
}

function createRequestError(serviceName: string, error: unknown): ExternalServiceError {
  if (error instanceof ExternalServiceError) {
    return error
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return new ExternalServiceError(`${serviceName} не ответил вовремя. Попробуйте еще раз.`, 504)
  }

  return new ExternalServiceError(`${serviceName} временно недоступен. Попробуйте еще раз.`, 502)
}

function createGeminiRequestError(error: unknown): ExternalServiceError {
  if (error instanceof ExternalServiceError) {
    return error
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return new ExternalServiceError("Gemini не ответил вовремя. Попробуйте еще раз.", 504)
  }

  if (error instanceof Error) {
    const status =
      "status" in error && typeof error.status === "number"
        ? error.status
        : "code" in error && typeof error.code === "number"
          ? error.code
          : null
    const message = error.message.trim()

    if (status && status >= 400 && status < 600 && message) {
      return new ExternalServiceError(message, status)
    }

    if (message) {
      return new ExternalServiceError(message, 502)
    }
  }

  return new ExternalServiceError("Gemini временно недоступен. Попробуйте еще раз.", 502)
}

function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey: getRequiredEnv("GEMINI_API_KEY"),
    })
  }

  return geminiClient
}

function getRetryDelay(attempt: number, response?: Response): number {
  const retryAfterHeader = response ? response.headers.get("retry-after") : null
  const retryAfterMs = parseRetryAfter(retryAfterHeader)

  if (retryAfterMs !== null) {
    return retryAfterMs
  }

  return RETRY_DELAY_MS * (attempt + 1)
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) {
    return null
  }

  const numericSeconds = Number(value)
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return numericSeconds * 1_000
  }

  const targetTime = Date.parse(value)
  if (Number.isNaN(targetTime)) {
    return null
  }

  return Math.max(0, targetTime - Date.now())
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
