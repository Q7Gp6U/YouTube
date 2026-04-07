"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Copy, Play, RotateCcw, Square, Volume2 } from "lucide-react"

import { AspectRatio } from "@/components/ui/aspect-ratio"
import { Button } from "@/components/ui/button"
import type { SummaryEssenceFrame } from "@/lib/video-summary-types"

interface SummaryResultProps {
  summary: string
  videoTitle: string
  essenceFrame?: SummaryEssenceFrame
  thumbnailUrls: string[]
  onReset: () => void
}

export function SummaryResult({ summary, videoTitle, essenceFrame, thumbnailUrls, onReset }: SummaryResultProps) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState("")
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [speechError, setSpeechError] = useState("")
  const [thumbnailIndex, setThumbnailIndex] = useState(0)
  const [hasEssenceFrameError, setHasEssenceFrameError] = useState(false)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)

  const activeThumbnailUrl = thumbnailUrls[thumbnailIndex]
  const shouldShowEssenceFrame = Boolean(essenceFrame && !hasEssenceFrameError)

  useEffect(() => {
    setThumbnailIndex(0)
  }, [thumbnailUrls])

  useEffect(() => {
    setHasEssenceFrameError(false)
  }, [essenceFrame])

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  const handleCopy = async () => {
    const success = await copyText(summary)

    if (!success) {
      setCopyError("Браузер не дал скопировать текст автоматически.")
      setCopied(false)
      return
    }

    setCopyError("")
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const handleSpeakToggle = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setSpeechError("Озвучка недоступна в этом браузере.")
      return
    }

    const { speechSynthesis } = window

    if (isSpeaking) {
      speechSynthesis.cancel()
      utteranceRef.current = null
      setIsSpeaking(false)
      return
    }

    const utterance = new SpeechSynthesisUtterance(summary)
    const voice = pickRussianVoice(speechSynthesis.getVoices())

    utterance.lang = voice?.lang || "ru-RU"
    utterance.voice = voice || null
    utterance.rate = 1
    utterance.pitch = 1
    utterance.onstart = () => {
      setSpeechError("")
      setIsSpeaking(true)
    }
    utterance.onend = () => {
      utteranceRef.current = null
      setIsSpeaking(false)
    }
    utterance.onerror = () => {
      utteranceRef.current = null
      setIsSpeaking(false)
      setSpeechError("Не удалось озвучить этот текст.")
    }

    speechSynthesis.cancel()
    utteranceRef.current = utterance
    speechSynthesis.speak(utterance)
  }

  const handleThumbnailError = () => {
    setThumbnailIndex((currentIndex) => {
      if (currentIndex >= thumbnailUrls.length - 1) {
        return currentIndex
      }

      return currentIndex + 1
    })
  }

  return (
    <div className="mx-auto w-full max-w-2xl animate-fade-in-up">
      <div className="mb-6 flex items-center justify-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary">
          <Check className="h-5 w-5 text-primary-foreground" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">Готово!</h2>
      </div>

      <div className="mb-4 overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
        {shouldShowEssenceFrame && essenceFrame ? (
          <AspectRatio ratio={essenceFrame.frameWidth / essenceFrame.frameHeight}>
            <div className="relative h-full w-full overflow-hidden bg-secondary" role="img" aria-label={`Кадр по сути видео ${videoTitle}`}>
              <img
                src={essenceFrame.sheetUrl}
                alt=""
                aria-hidden="true"
                className="pointer-events-none absolute left-0 top-0 block max-w-none select-none"
                loading="eager"
                onError={() => setHasEssenceFrameError(true)}
                style={{
                  width: `${essenceFrame.columns * 100}%`,
                  height: `${essenceFrame.rows * 100}%`,
                  transform: `translate(-${(essenceFrame.column * 100) / essenceFrame.columns}%, -${(essenceFrame.row * 100) / essenceFrame.rows}%)`,
                }}
              />

              <div className="absolute bottom-3 right-3 rounded-full bg-background/80 px-3 py-1 text-xs font-medium text-foreground backdrop-blur">
                {formatTimestamp(essenceFrame.timestampMs)}
              </div>
            </div>
          </AspectRatio>
        ) : activeThumbnailUrl ? (
          <AspectRatio ratio={16 / 9}>
            <img
              src={activeThumbnailUrl}
              alt={`Превью видео ${videoTitle}`}
              className="h-full w-full object-cover"
              loading="eager"
              onError={handleThumbnailError}
            />
          </AspectRatio>
        ) : null}

        <div className="flex items-center gap-2 px-4 py-3">
          <Play className="h-4 w-4 fill-primary text-primary" />
          <p className="truncate text-sm font-medium text-foreground">{videoTitle}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-lg">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-primary">
            Краткое содержание
          </h3>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-9 gap-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-green-500" />
                  <span className="text-green-500">Скопировано</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  <span>Скопировать текст</span>
                </>
              )}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleSpeakToggle}
              className="h-9 gap-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              {isSpeaking ? (
                <>
                  <Square className="h-4 w-4" />
                  <span>Остановить</span>
                </>
              ) : (
                <>
                  <Volume2 className="h-4 w-4" />
                  <span>Прослушать</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {(copyError || speechError) && (
          <p className="mb-4 text-sm text-muted-foreground">{copyError || speechError}</p>
        )}

        <p className="whitespace-pre-line text-lg leading-relaxed text-foreground">{summary}</p>
      </div>

      <div className="mt-8 flex justify-center">
        <Button
          variant="outline"
          onClick={onReset}
          className="h-12 gap-2 border-border px-6 text-base hover:border-primary hover:bg-secondary"
        >
          <RotateCcw className="h-4 w-4" />
          Сгенерировать для другого видео
        </Button>
      </div>
    </div>
  )
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    return fallbackCopyText(text)
  }

  return fallbackCopyText(text)
}

function fallbackCopyText(text: string): boolean {
  try {
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.setAttribute("readonly", "true")
    textarea.style.position = "fixed"
    textarea.style.left = "-9999px"
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand("copy")
    document.body.removeChild(textarea)
    return copied
  } catch {
    return false
  }
}

function pickRussianVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) {
    return null
  }

  const russianVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith("ru"))

  return russianVoice || voices[0]
}

function formatTimestamp(timestampMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(timestampMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}
