"use client"

import { LogOut } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { createBrowserSupabaseClient } from "@/lib/supabase/client"

export function LogoutButton() {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)

  const handleLogout = async () => {
    if (isPending) {
      return
    }

    setIsPending(true)

    try {
      const supabase = createBrowserSupabaseClient()
      await supabase.auth.signOut()
      router.replace("/auth")
      router.refresh()
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleLogout}
      disabled={isPending}
      className="h-10 gap-2 border-border bg-background/60 px-4 hover:border-primary hover:bg-secondary"
    >
      <LogOut className="h-4 w-4" />
      {isPending ? "Выходим..." : "Выйти"}
    </Button>
  )
}
