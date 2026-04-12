import { redirect } from "next/navigation"

import { AuthPageClient } from "@/components/auth-page-client"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
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
