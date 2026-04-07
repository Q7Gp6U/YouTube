"use client"

import { startTransition, useEffect, useMemo, useRef, useState, type ElementType, type MutableRefObject } from "react"
import { Gift, Play, Target, Zap } from "lucide-react"

import { Logo } from "@/components/logo"
import { SummaryResult } from "@/components/summary-result"
import { ThinkingAnimation } from "@/components/thinking-animation"
import { UrlInputForm } from "@/components/url-input-form"
import type {
  SummaryCompletedResponse,
  SummaryEssenceFrame,
  SummaryProcessingResponse,
  SummaryResponse,
} from "@/lib/video-summary-types"

type AppState = "idle" | "loading" | "result"

const MAX_POLL_ATTEMPTS = 18
const POLL_INTERVAL_STEPS_MS = [2500, 4000, 6000, 8000, 10000]

export default function Home() {
  const [appState, setAppState] = useState<AppState>("idle")
  const [summary, setSummary] = useState("")
  const [videoTitle, setVideoTitle] = useState("")
  const [essenceFrame, setEssenceFrame] = useState<SummaryEssenceFrame | undefined>(undefined)
  const [submittedUrl, setSubmittedUrl] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [loadingStatus, setLoadingStatus] = useState("Готовим запрос к транскрипту...")
  const [loadingHint, setLoadingHint] = useState("Обычно результат приходит без перезагрузки страницы.")
  const [loadingVideoTitle, setLoadingVideoTitle] = useState("")

  const abortControllerRef = useRef<AbortController | null>(null)
  const activeRequestIdRef = useRef(0)
  const videoThumbnailUrls = useMemo(() => getYouTubeThumbnailUrls(submittedUrl), [submittedUrl])

  useEffect(() => {
    return () => {
      abortActiveRequest(abortControllerRef)
    }
  }, [])

  const handleSubmit = async (url: string) => {
    abortActiveRequest(abortControllerRef)

    const controller = new AbortController()
    abortControllerRef.current = controller
    const requestId = activeRequestIdRef.current + 1
    activeRequestIdRef.current = requestId

    setAppState("loading")
    setSummary("")
    setVideoTitle("")
    setEssenceFrame(undefined)
    setSubmittedUrl(url)
    setErrorMessage("")
    setLoadingVideoTitle("")
    setLoadingStatus("Проверяем ссылку и запускаем обработку...")
    setLoadingHint("Если Supadata вернет асинхронную задачу, интерфейс дождется результата автоматически.")

    try {
      const startResult = await requestSummary({
        action: "start",
        url,
      }, controller.signal)

      if (requestId !== activeRequestIdRef.current) {
        return
      }

      if (startResult.status === "processing") {
        setLoadingVideoTitle(startResult.videoTitle)
        setLoadingStatus("Транскрипт еще собирается. Повторяем запрос с безопасной паузой...")
        setLoadingHint("Интервалы между проверками постепенно растут, чтобы не упираться в лимиты Vercel free.")

        const completed = await pollUntilComplete(url, startResult, controller.signal, requestId)
        applyCompletedSummary(completed)
        return
      }

      applyCompletedSummary(startResult)
    } catch (error) {
      if (isAbortError(error)) {
        return
      }

      setAppState("idle")
      setErrorMessage(getErrorMessage(error))
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
      }
    }
  }

  const handleReset = () => {
    abortActiveRequest(abortControllerRef)
    setAppState("idle")
    setSummary("")
    setVideoTitle("")
    setEssenceFrame(undefined)
    setSubmittedUrl("")
    setErrorMessage("")
    setLoadingVideoTitle("")
  }

  const applyCompletedSummary = (result: SummaryCompletedResponse) => {
    startTransition(() => {
      setSummary(result.summary)
      setVideoTitle(result.videoTitle)
      setEssenceFrame(result.essenceFrame)
      setAppState("result")
    })
  }

  const pollUntilComplete = async (
    url: string,
    processingResult: SummaryProcessingResponse,
    signal: AbortSignal,
    requestId: number,
  ): Promise<SummaryCompletedResponse> => {
    let currentTitle = processingResult.videoTitle

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      const delayMs = getPollInterval(attempt)

      setLoadingVideoTitle(currentTitle)
      setLoadingStatus(
        attempt === 0
          ? "Supadata обрабатывает видео. Ждем первую готовую порцию данных..."
          : `Видео еще в очереди. Проверка ${attempt + 1} из ${MAX_POLL_ATTEMPTS} через ${Math.round(
              delayMs / 1000,
            )} сек.`,
      )
      setLoadingHint("Страница остается открытой и мягко повторяет запросы, пока бэкенд не вернет готовую выжимку.")

      await wait(delayMs, signal)

      if (requestId !== activeRequestIdRef.current) {
        throw createAbortError()
      }

      const pollResult = await requestSummary({
        action: "poll",
        url,
        jobId: processingResult.jobId,
        videoTitle: currentTitle,
      }, signal)

      if (requestId !== activeRequestIdRef.current) {
        throw createAbortError()
      }

      if (pollResult.status === "processing") {
        currentTitle = pollResult.videoTitle
        setLoadingVideoTitle(pollResult.videoTitle)
        continue
      }

      return pollResult
    }

    throw new Error("Видео обрабатывается слишком долго. Попробуйте еще раз через минуту.")
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-50 w-full border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Logo />

          <nav className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex">
            <a href="#how-it-works" className="transition-colors hover:text-foreground">
              Как это работает
            </a>
            <a href="#what-you-get" className="transition-colors hover:text-primary">
              Что внутри
            </a>
          </nav>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
        {(appState === "idle" || appState === "loading") && (
          <div className="flex w-full max-w-3xl flex-col items-center gap-10 animate-fade-in-up">
            <div className="rounded-full border border-primary/20 bg-primary/10 px-4 py-2">
              <div className="flex items-center gap-2">
                <Play className="h-4 w-4 fill-primary text-primary" />
                <span className="text-sm font-medium text-primary">
                  Работает не само, а умно - на базе ИИ
                </span>
              </div>
            </div>

            <div className="flex flex-col items-center space-y-6 text-center">
              <h1 className="text-5xl font-bold leading-tight tracking-tight text-foreground sm:text-6xl">
                Посмотрим
                <br />
                <span className="text-primary">YouTube за вас</span>
              </h1>

              <p className="text-xl leading-relaxed text-muted-foreground">
                Вставь ссылку, получи суть видео буквами
              </p>
            </div>

            <div className="w-full max-w-2xl space-y-3">
              <UrlInputForm onSubmit={handleSubmit} isLoading={appState === "loading"} />

              {errorMessage && (
                <div
                  role="alert"
                  className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                >
                  {errorMessage}
                </div>
              )}

              {appState === "loading" && (
                <div className="rounded-2xl border border-border bg-card/80 px-4 py-4 text-sm shadow-sm">
                  <p className="font-medium text-foreground">{loadingStatus}</p>
                  {loadingVideoTitle && <p className="mt-1 text-muted-foreground">{loadingVideoTitle}</p>}
                  <p className="mt-2 text-muted-foreground">{loadingHint}</p>
                </div>
              )}
            </div>

            {appState === "loading" && (
              <div className="pt-2">
                <ThinkingAnimation statusText={loadingStatus} hintText={loadingHint} />
              </div>
            )}

            <div id="what-you-get" className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-6 sm:grid-cols-3">
              <FeatureCard icon={Zap} title="Быстро" description="Результат за 10 секунд" />
              <FeatureCard icon={Target} title="Точно" description="ИИ выделяет главное" />
              <FeatureCard icon={Gift} title="Бесплатно" description="Без регистрации" />
            </div>
          </div>
        )}

        {appState === "result" && (
          <SummaryResult
            summary={summary}
            videoTitle={videoTitle}
            essenceFrame={essenceFrame}
            thumbnailUrls={videoThumbnailUrls}
            onReset={handleReset}
          />
        )}
      </main>

      <footer className="border-t border-border bg-card/30 py-6">
        <div
          id="how-it-works"
          className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground sm:flex-row"
        >
          <p>© 2024 Кратко и точка. Все права защищены.</p>
          <div className="flex items-center gap-4">
            <span>Supadata для транскрипта</span>
            <span>Gemini для выжимки</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

async function requestSummary(
  body:
    | {
        action: "start"
        url: string
      }
    | {
        action: "poll"
        url: string
        jobId: string
        videoTitle?: string
      },
  signal?: AbortSignal,
): Promise<SummaryCompletedResponse | SummaryProcessingResponse> {
  const response = await fetch("/api/summarize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  })

  const payload = (await response.json()) as SummaryResponse

  if (!response.ok || payload.status === "error") {
    throw new Error(payload.status === "error" ? payload.message : "Сервис вернул ошибку.")
  }

  return payload
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return "Не удалось обработать видео. Попробуйте еще раз."
}

function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }

    const timeoutId = window.setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort)
      resolve()
    }, delayMs)

    const handleAbort = () => {
      window.clearTimeout(timeoutId)
      signal?.removeEventListener("abort", handleAbort)
      resolve()
    }

    signal?.addEventListener("abort", handleAbort)
  })
}

function getPollInterval(attempt: number): number {
  return POLL_INTERVAL_STEPS_MS[Math.min(attempt, POLL_INTERVAL_STEPS_MS.length - 1)]
}

function abortActiveRequest(controllerRef: MutableRefObject<AbortController | null>) {
  controllerRef.current?.abort()
  controllerRef.current = null
}

function createAbortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError")
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function getYouTubeThumbnailUrls(rawUrl: string): string[] {
  const videoId = extractYouTubeVideoId(rawUrl)

  if (!videoId) {
    return []
  }

  return ["maxresdefault", "sddefault", "hqdefault", "mqdefault"].map(
    (variant) => `https://i.ytimg.com/vi/${videoId}/${variant}.jpg`,
  )
}

function extractYouTubeVideoId(rawUrl: string): string | null {
  try {
    const parsedUrl = new URL(rawUrl.trim())
    const hostname = parsedUrl.hostname.replace(/^www\./, "").toLowerCase()

    if (hostname === "youtu.be") {
      return normalizeVideoId(parsedUrl.pathname.slice(1))
    }

    if (!hostname.endsWith("youtube.com")) {
      return null
    }

    if (parsedUrl.pathname === "/watch") {
      return normalizeVideoId(parsedUrl.searchParams.get("v"))
    }

    const segments = parsedUrl.pathname.split("/").filter(Boolean)
    const supportedPrefixes = new Set(["shorts", "embed", "live"])

    if (segments.length >= 2 && supportedPrefixes.has(segments[0])) {
      return normalizeVideoId(segments[1])
    }

    return null
  } catch {
    return null
  }
}

function normalizeVideoId(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const normalized = value.trim()
  return normalized ? normalized : null
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: ElementType
  title: string
  description: string
}) {
  return (
    <div className="group flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 transition-all hover:border-primary/50">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 transition-colors group-hover:bg-primary/20">
        <Icon className="h-6 w-6 text-primary" />
      </div>
      <h3 className="font-semibold text-foreground">{title}</h3>
      <p className="text-center text-sm text-muted-foreground">{description}</p>
    </div>
  )
}
