"use client"

import { Play } from "lucide-react"

export function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex h-9 w-12 items-center justify-center rounded-lg bg-primary">
        <Play className="h-4 w-4 fill-primary-foreground text-primary-foreground" />
      </div>

      <span className="text-xl font-bold tracking-tight text-foreground">Кратко и точка</span>
    </div>
  )
}
