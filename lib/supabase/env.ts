type SupabaseEnv = {
  url: string
  anonKey: string
}

let cachedEnv: SupabaseEnv | null = null

export function getSupabaseEnv(): SupabaseEnv {
  if (cachedEnv) {
    return cachedEnv
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()

  if (!url || !anonKey) {
    throw new Error("Не настроены переменные окружения NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_ANON_KEY.")
  }

  cachedEnv = {
    url,
    anonKey,
  }

  return cachedEnv
}
