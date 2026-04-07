"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { ArrowRight, Play } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface UrlInputFormProps {
  onSubmit: (url: string) => Promise<void> | void
  isLoading?: boolean
}

export function UrlInputForm({ onSubmit, isLoading }: UrlInputFormProps) {
  const [url, setUrl] = useState("")
  const [isFocused, setIsFocused] = useState(false)
  const submitLockRef = useRef(false)

  useEffect(() => {
    if (!isLoading) {
      submitLockRef.current = false
    }
  }, [isLoading])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const normalizedUrl = url.trim()

    if (!normalizedUrl || submitLockRef.current || isLoading) {
      return
    }

    submitLockRef.current = true

    try {
      await onSubmit(normalizedUrl)
    } finally {
      submitLockRef.current = false
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl">
      <div
        className={`relative flex items-center rounded-2xl transition-all duration-300 ${
          isFocused ? "ring-2 ring-primary shadow-lg shadow-primary/20" : ""
        }`}
      >
        <div className="pointer-events-none absolute left-4 flex items-center">
          <div className="flex h-8 w-10 items-center justify-center rounded-md bg-primary">
            <Play className="h-4 w-4 fill-primary-foreground text-primary-foreground" />
          </div>
        </div>

        <Input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="Вставьте ссылку на YouTube-видео..."
          className="h-16 rounded-2xl border-border bg-card pr-44 text-base placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
          style={{ paddingLeft: "4.5rem" }}
          disabled={isLoading}
          inputMode="url"
          autoComplete="url"
        />

        <div className="absolute right-2">
          <Button
            type="submit"
            disabled={!url.trim() || isLoading}
            className="h-12 gap-2 rounded-xl bg-primary px-6 font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 hover:shadow-xl hover:shadow-primary/40 disabled:shadow-none"
          >
            {isLoading ? "Обрабатываем..." : "Получить суть"}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </form>
  )
}
