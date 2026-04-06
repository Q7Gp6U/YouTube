"use client"

import { useState } from "react"
import { Check, Copy, Play, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"

interface SummaryResultProps {
  summary: string
  videoTitle: string
  onReset: () => void
}

export function SummaryResult({ summary, videoTitle, onReset }: SummaryResultProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(summary)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mx-auto w-full max-w-2xl animate-fade-in-up">
      <div className="mb-6 flex items-center justify-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary">
          <Check className="h-5 w-5 text-primary-foreground" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">Готово!</h2>
      </div>

      <div className="mb-4 flex items-center gap-2 rounded-xl bg-secondary px-4 py-3">
        <Play className="h-4 w-4 fill-primary text-primary" />
        <p className="truncate text-sm font-medium text-foreground">{videoTitle}</p>
      </div>

      <div className="relative rounded-2xl border border-border bg-card p-6 shadow-lg">
        <div className="absolute right-4 top-4">
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
                <span>Копировать</span>
              </>
            )}
          </Button>
        </div>

        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-primary">
          Краткое содержание
        </h3>

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
