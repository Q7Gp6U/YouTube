"use client"

import { createBrowserClient } from "@supabase/ssr"

import type { Database } from "@/lib/database.types"
import { getSupabaseEnv } from "@/lib/supabase/env"

let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null

export function createBrowserSupabaseClient() {
  if (browserClient) {
    return browserClient
  }

  const { url, anonKey } = getSupabaseEnv()

  browserClient = createBrowserClient<Database>(url, anonKey)
  return browserClient
}
