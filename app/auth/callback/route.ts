import { NextResponse } from "next/server"

import { createServerSupabaseClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const next = getSafeNextPath(requestUrl.searchParams.get("next"))

  if (!code) {
    return NextResponse.redirect(new URL("/auth?error=Ссылка входа недействительна или уже использована.", request.url))
  }

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    const authUrl = new URL("/auth", request.url)
    authUrl.searchParams.set("error", "Не удалось завершить вход по ссылке. Попробуйте войти снова.")
    return NextResponse.redirect(authUrl)
  }

  return NextResponse.redirect(new URL(next, request.url))
}

function getSafeNextPath(next: string | null) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/"
  }

  return next
}
