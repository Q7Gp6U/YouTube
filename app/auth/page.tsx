import { redirect } from "next/navigation"

import { AuthPageClient } from "@/components/auth-page-client"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  if (process.env.NODE_ENV !== "production" && process.env.TEST_BYPASS_AUTH === "1") {
    redirect("/")
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect("/")
  }

  const params = await searchParams

  return <AuthPageClient initialError={params.error} />
}
