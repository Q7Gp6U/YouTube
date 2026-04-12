import { redirect } from "next/navigation"

import type { Database } from "@/lib/database.types"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export type AuthenticatedAppUser = {
  id: string
  email: string
  displayName: string
  creditsRemaining: number
}

export async function getAuthenticatedUserContext(): Promise<AuthenticatedAppUser | null> {
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
