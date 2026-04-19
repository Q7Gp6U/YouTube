import { redirect } from "next/navigation"

import type { Database } from "@/lib/database.types"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export type AuthenticatedAppUser = {
  id: string
  email: string
  displayName: string
  creditsRemaining: number
}

function getBypassUserContext(): AuthenticatedAppUser | null {
  if (process.env.NODE_ENV === "production" || process.env.TEST_BYPASS_AUTH !== "1") {
    return null
  }

  return {
    id: process.env.TEST_BYPASS_USER_ID?.trim() || "00000000-0000-4000-8000-000000000001",
    email: process.env.TEST_BYPASS_USER_EMAIL?.trim() || "e2e@example.com",
    displayName: process.env.TEST_BYPASS_USER_NAME?.trim() || "E2E User",
    creditsRemaining: Number.parseInt(process.env.TEST_BYPASS_CREDITS?.trim() || "9", 10) || 9,
  }
}

export async function getAuthenticatedUserContext(): Promise<AuthenticatedAppUser | null> {
  const bypassUser = getBypassUserContext()

  if (bypassUser) {
    return bypassUser
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const { data } = await supabase
    .from("profiles")
    .select("email, full_name, credits_balance")
    .eq("id", user.id)
    .maybeSingle()

  const profile = data as Pick<Database["public"]["Tables"]["profiles"]["Row"], "email" | "full_name" | "credits_balance"> | null

  const email = profile?.email?.trim() || user.email?.trim() || ""
  const fallbackName = (user.user_metadata?.full_name as string | undefined)?.trim() || email || "Пользователь"

  return {
    id: user.id,
    email,
    displayName: profile?.full_name?.trim() || fallbackName,
    creditsRemaining: profile?.credits_balance ?? 0,
  }
}

export async function requireAuthenticatedUserContext() {
  const context = await getAuthenticatedUserContext()

  if (!context) {
    redirect("/auth")
  }

  return context
}
