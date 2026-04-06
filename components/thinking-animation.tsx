"use client"

import { useEffect, useState } from "react"
import { Brain, FileText, Play, Sparkles, Wand2 } from "lucide-react"

const stages = [
  { icon: Play, text: "Получаем транскрипт видео..." },
  { icon: Brain, text: "Анализируем содержание..." },
  { icon: Sparkles, text: "Выделяем главное..." },
  { icon: FileText, text: "Готовим краткую выжимку..." },
]

interface ThinkingAnimationProps {
  statusText?: string
  hintText?: string
}

export function ThinkingAnimation({
  statusText,
  hintText = "Обычно это занимает от нескольких секунд до минуты",
}: ThinkingAnimationProps) {
  const [currentStage, setCurrentStage] = useState(0)
  const [progress, setProgress] = useState(18)

  useEffect(() => {
    const stageInterval = window.setInterval(() => {
      setCurrentStage((prev) => (prev + 1) % stages.length)
    }, 2000)

    const progressInterval = window.setInterval(() => {
      setProgress((prev) => {
        if (prev >= 92) {
          return 24
        }

        return prev + 1.1
      })
    }, 120)

    return () => {
      window.clearInterval(stageInterval)
      window.clearInterval(progressInterval)
    }
  }, [])

  const CurrentIcon = stages[currentStage].icon

  return (
    <div className="flex flex-col items-center gap-10">
      <div className="relative flex h-48 w-48 items-center justify-center">
        <div className="absolute inset-0 rounded-full border-2 border-primary/40 animate-ring-expand" />
        <div
          className="absolute inset-0 rounded-full border-2 border-primary/40 animate-ring-expand"
          style={{ animationDelay: "0.5s" }}
        />
        <div
          className="absolute inset-0 rounded-full border-2 border-primary/40 animate-ring-expand"
          style={{ animationDelay: "1s" }}
        />

        <div className="absolute inset-4 rounded-full border border-primary/20" />

        <div className="relative z-10 flex h-28 w-28 items-center justify-center rounded-2xl bg-primary shadow-2xl shadow-primary/30 animate-pulse-glow">
          <CurrentIcon className="h-12 w-12 text-primary-foreground transition-all duration-500" />
        </div>

        <div
          className="absolute right-8 top-4 h-3 w-3 rounded-full bg-primary/60 animate-float"
          style={{ animationDelay: "0.2s" }}
        />
        <div
          className="absolute bottom-8 left-4 h-2 w-2 rounded-full bg-primary/40 animate-float"
          style={{ animationDelay: "0.5s" }}
        />
        <div
          className="absolute left-6 top-12 h-2 w-2 rounded-full bg-primary/50 animate-float"
          style={{ animationDelay: "0.8s" }}
        />
      </div>

      <div className="flex flex-col items-center gap-5">
        <div className="flex items-center gap-3">
          <Wand2 className="h-5 w-5 animate-bounce-subtle text-primary" />
          <p className="text-center text-xl font-semibold text-foreground">{statusText ?? stages[currentStage].text}</p>
        </div>

        <div className="h-2 w-72 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all duration-200 ease-out"
            style={{ width: `${Math.min(Math.round(progress), 100)}%` }}
          />
        </div>

        <p className="text-center text-sm font-medium text-muted-foreground">
          {hintText}
        </p>
      </div>

      <div className="flex gap-3">
        {stages.map((stage, index) => (
          <div
            key={stage.text}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-all duration-300 ${
              index === currentStage
                ? "scale-110 bg-primary text-primary-foreground"
                : index < currentStage
                  ? "bg-primary/40 text-primary-foreground"
                  : "bg-secondary text-muted-foreground"
            }`}
          >
            <stage.icon className="h-4 w-4" />
          </div>
        ))}
      </div>
    </div>
  )
}
