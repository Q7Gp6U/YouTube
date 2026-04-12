"use client"

import { Play, ShieldCheck, Sparkles, Wallet } from "lucide-react"
import { useRouter } from "next/navigation"
import { useMemo, useState, type FormEvent } from "react"

import { Logo } from "@/components/logo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createBrowserSupabaseClient } from "@/lib/supabase/client"

type AuthMode = "login" | "signup"

const BENEFITS = [
  {
    icon: Wallet,
    title: "10 тестовых кредитов сразу",
    description: "После регистрации можно без доплат прогнать первые видео и проверить UX на реальных роликах.",
  },
  {
    icon: ShieldCheck,
    title: "Только для своих",
    description: "Главная страница и результаты доступны только после входа, а данные разделены по пользователям.",
  },
  {
    icon: Sparkles,
    title: "Без лишних шагов",
    description: "Регистрируетесь, сразу попадаете в приложение и получаете выжимку без лишнего ритуала.",
  },
] as const

export function AuthPageClient({ initialError }: { initialError?: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<AuthMode>("login")
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [errorMessage, setErrorMessage] = useState(initialError || "")
  const [notice, setNotice] = useState("")
  const [isPending, setIsPending] = useState(false)

  const title = useMemo(
    () =>
      mode === "login"
        ? "Войдите и продолжайте смотреть YouTube не глазами"
        : "Создайте аккаунт и сразу получите доступ",
    [mode],
  )

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (isPending) {
      return
    }

    setIsPending(true)
    setErrorMessage("")
    setNotice("")

    try {
      const supabase = createBrowserSupabaseClient()

      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: fullName.trim() || null,
            },
          },
        })

        if (error) {
          throw error
        }

        if (data.session) {
          router.replace("/")
          router.refresh()
          return
        }

        setNotice("Аккаунт создан. Если вход не открылся сразу, в этом окружении может быть включено дополнительное подтверждение email.")
        setMode("login")
        return
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (error) {
        throw error
      }

      router.replace("/")
      router.refresh()
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/40 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Logo />
          <div className="rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
            Вход нужен, чтобы считать кредиты честно
          </div>
        </div>
      </header>

      <main className="mx-auto grid min-h-[calc(100vh-73px)] max-w-6xl gap-8 px-4 py-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(24rem,0.95fr)] lg:items-center">
        <section className="space-y-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
            <Play className="h-4 w-4 fill-primary text-primary" />
            Регистрация занимает минуту и не тормозит доступ
          </div>

          <div className="space-y-4">
            <h1 className="max-w-3xl text-4xl leading-tight font-bold tracking-tight text-foreground sm:text-5xl">
              YouTube по-прежнему длинный. Теперь хотя бы доступ к сокращению под контролем.
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              Зарегистрируйтесь, сразу попадите в приложение, получите 10 стартовых кредитов и тратьте их только на
              те ролики, которые правда хочется не смотреть целиком.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {BENEFITS.map((benefit) => {
              const Icon = benefit.icon

              return (
                <div key={benefit.title} className="rounded-[1.5rem] border border-border bg-card/80 p-5 shadow-[0_0_24px_rgba(255,0,0,0.06)]">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-[0_0_18px_rgba(255,0,0,0.18)]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="mt-4 text-lg font-semibold text-foreground">{benefit.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{benefit.description}</p>
                </div>
              )
            })}
          </div>
        </section>

        <section className="rounded-[2rem] border border-border bg-card/90 p-6 shadow-[0_0_40px_rgba(255,0,0,0.08)] sm:p-8">
          <div className="mb-6 flex gap-2 rounded-2xl bg-secondary p-1">
            <ModeSwitchButton label="Вход" isActive={mode === "login"} onClick={() => setMode("login")} />
            <ModeSwitchButton label="Регистрация" isActive={mode === "signup"} onClick={() => setMode("signup")} />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-semibold text-foreground">{title}</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {mode === "login"
                ? "Используйте email и пароль, чтобы открыть доступ к главной странице и своему балансу кредитов."
                : "После регистрации вы сразу попадете в приложение, а профиль и 10 тестовых кредитов создадутся автоматически."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === "signup" && (
              <div className="space-y-2">
                <label htmlFor="fullName" className="text-sm font-medium text-foreground">
                  Имя или псевдоним
                </label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Как к вам обращаться"
                  className="h-12 rounded-xl bg-background"
                  autoComplete="name"
                />
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-foreground">
                Email
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="h-12 rounded-xl bg-background"
                autoComplete="email"
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-foreground">
                Пароль
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Минимум 6 символов"
                className="h-12 rounded-xl bg-background"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={6}
                required
              />
            </div>

            {(errorMessage || notice) && (
              <div
                className={`rounded-2xl border 
                  px-4 py-3 text-sm ${
                  errorMessage
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-primary/30 bg-primary/10 text-foreground"
                }`}
              >
                {errorMessage || notice}
              </div>
            )}

            <Button type="submit" disabled={isPending} className="h-12 w-full rounded-xl text-base font-semibold">
              {isPending
                ? mode === "login"
                  ? "Входим..."
                  : "Создаем аккаунт..."
                : mode === "login"
                  ? "Войти"
                  : "Зарегистрироваться и получить 10 кредитов"}
            </Button>
          </form>
        </section>
      </main>
    </div>
  )
}

function ModeSwitchButton({
  isActive,
  label,
  onClick,
}: {
  isActive: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
        isActive ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  )
}

function getAuthErrorMessage(error: unknown) {
  if (!(error instanceof Error) || !error.message.trim()) {
    return "Не удалось выполнить вход. Попробуйте еще раз."
  }

  if (/invalid login credentials/i.test(error.message)) {
    return "Неверный email или пароль."
  }

  if (/email not confirmed/i.test(error.message)) {
    return "В этом окружении для входа пока требуется подтверждение email. Обычно после отключения этой настройки доступ открывается сразу."
  }

  return error.message
}
