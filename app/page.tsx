"use client"

import { startTransition, useEffect, useMemo, useRef, useState, type ElementType, type MutableRefObject } from "react"
import { ArrowLeft, Gift, Play, Sparkles, Target, X, Zap } from "lucide-react"

import { Logo } from "@/components/logo"
import { SummaryResult } from "@/components/summary-result"
import { ThinkingAnimation } from "@/components/thinking-animation"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { UrlInputForm } from "@/components/url-input-form"
import type {
  SummaryCompletedResponse,
  SummaryEssenceFrame,
  SummaryProcessingResponse,
  SummaryResponse,
} from "@/lib/video-summary-types"

type AppState = "idle" | "loading" | "result"
type InfoPanelKey = "how-it-works" | "what-you-get"
type StepItem = {
  step: string
  title: string
  description: string
}
type FeatureItem = {
  icon: ElementType
  title: string
  description: string
}

const MAX_POLL_ATTEMPTS = 18
const POLL_INTERVAL_STEPS_MS = [2500, 4000, 6000, 8000, 10000]
const INFO_PANEL_COPY: Record<InfoPanelKey, { eyebrow: string; title: string; description: string }> = {
  "how-it-works": {
    eyebrow: "Как это работает",
    title: "Никакой магии. Просто очень деловой ИИ, которому показали YouTube.",
    description:
      "Сервис вытаскивает транскрипт, вылавливает главное и возвращает короткую выжимку без обязательного просмотра вступления, рекламы и философской паузы на три минуты.",
  },
  "what-you-get": {
    eyebrow: "Что внутри",
    title: "Все, что нужно для быстрого знакомства с видео, без лишнего театра.",
    description:
      "Здесь не пытаются заменить весь ролик. Здесь честно показывают, что в нем главное, и экономят вам время, нервы и пару ненужных мотивационных абзацев.",
  },
}
const HOW_IT_WORKS_STEPS: StepItem[] = [
  {
    step: "01",
    title: "Берем ссылку",
    description: "Проверяем, что это YouTube, а не очередной квест с неожиданным сюжетом.",
  },
  {
    step: "02",
    title: "Слушаем вместо вас",
    description: "Supadata собирает транскрипт, а модель без жалости вырезает словесные круги почета.",
  },
  {
    step: "03",
    title: "Отдаем суть",
    description: "На выходе - понятный текст, кадр по делу и кнопка озвучки, если браузер не вредничает.",
  },
]
const WHAT_YOU_GET_FEATURES: FeatureItem[] = [
  {
    icon: Zap,
    title: "Быстро",
    description: "Результат приходит без долгого ритуала обновления страницы.",
  },
  {
    icon: Target,
    title: "Точно",
    description: "Модель собирает главное, а не коллекцию случайных фраз из середины ролика.",
  },
  {
    icon: Gift,
    title: "Бесплатно",
    description: "Без регистрации, подписки и драматичной кнопки 'начать пробный период'.",
  },
]

export default function Home() {
  const [appState, setAppState] = useState<AppState>("idle")
  const [activeInfoPanel, setActiveInfoPanel] = useState<InfoPanelKey | null>(null)
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
            <button
              type="button"
              onClick={() => setActiveInfoPanel("how-it-works")}
              className="cursor-pointer transition-colors hover:text-foreground"
            >
              Как это работает
            </button>
            <button
              type="button"
              onClick={() => setActiveInfoPanel("what-you-get")}
              className="cursor-pointer transition-colors hover:text-primary"
            >
              Что внутри
            </button>
          </nav>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center px-4 py-16">
        {(appState === "idle" || appState === "loading") && (
          <div className="flex min-h-[calc(100vh-18rem)] w-full max-w-3xl flex-col items-center justify-center gap-10 animate-fade-in-up">
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

        <div className="mt-20 flex w-full max-w-5xl flex-col gap-8">
          <section
            id="how-it-works"
            className="scroll-mt-28 rounded-[2rem] border border-border bg-card/70 px-6 py-8 shadow-sm sm:px-8"
          >
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-primary">Как это работает</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Никакой магии. Просто очень деловой ИИ, которому показали YouTube.
              </h2>
              <p className="mt-4 text-base leading-7 text-muted-foreground">
                Сервис вытаскивает транскрипт, вылавливает главное и возвращает короткую выжимку без обязательного
                просмотра вступления, рекламы и философской паузы на три минуты.
              </p>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {HOW_IT_WORKS_STEPS.map((step) => (
                <StepCard key={step.step} step={step.step} title={step.title} description={step.description} />
              ))}
            </div>
          </section>

          <section
            id="what-you-get"
            className="scroll-mt-28 rounded-[2rem] border border-border bg-card/50 px-6 py-8 shadow-sm sm:px-8"
          >
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-primary">Что внутри</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Все, что нужно для быстрого знакомства с видео, без лишнего театра.
              </h2>
              <p className="mt-4 text-base leading-7 text-muted-foreground">
                Здесь не пытаются заменить весь ролик. Здесь честно показывают, что в нем главное, и экономят вам
                время, нервы и пару ненужных мотивационных абзацев.
              </p>
            </div>

            <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
              {WHAT_YOU_GET_FEATURES.map((feature) => (
                <FeatureCard
                  key={feature.title}
                  icon={feature.icon}
                  title={feature.title}
                  description={feature.description}
                />
              ))}
            </div>
          </section>
        </div>

        <Dialog open={activeInfoPanel !== null} onOpenChange={(open) => !open && setActiveInfoPanel(null)}>
          <DialogContent
            showCloseButton={false}
            className="top-0 left-0 h-screen w-screen max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none border-0 bg-background p-0 sm:max-w-none"
          >
            {activeInfoPanel && <InfoPanelDialog panel={activeInfoPanel} onClose={() => setActiveInfoPanel(null)} />}
          </DialogContent>
        </Dialog>
      </main>

      <footer className="border-t border-border bg-card/30 py-6">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground sm:flex-row">
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

function InfoPanelDialog({
  panel,
  onClose,
}: {
  panel: InfoPanelKey
  onClose: () => void
}) {
  const copy = INFO_PANEL_COPY[panel]

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            Назад
          </button>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            aria-label="Закрыть раздел"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
        <DialogHeader className="space-y-3 text-left">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-primary">{copy.eyebrow}</p>
          <DialogTitle className="max-w-3xl text-3xl leading-tight font-bold tracking-tight text-foreground sm:text-5xl">
            {copy.title}
          </DialogTitle>
          <DialogDescription className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
            {copy.description}
          </DialogDescription>
        </DialogHeader>

        {panel === "how-it-works" ? (
          <div className="grid gap-4 md:grid-cols-3">
            {HOW_IT_WORKS_STEPS.map((step) => (
              <StepCard key={step.step} step={step.step} title={step.title} description={step.description} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {WHAT_YOU_GET_FEATURES.map((feature) => (
              <FeatureCard
                key={feature.title}
                icon={feature.icon}
                title={feature.title}
                description={feature.description}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StepCard({
  step,
  title,
  description,
}: {
  step: string
  title: string
  description: string
}) {
  return (
    <div className="rounded-2xl border border-border bg-background/80 p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {step}
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-primary">
          <Sparkles className="h-5 w-5" />
        </div>
      </div>
      <h3 className="mt-4 text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  )
}
