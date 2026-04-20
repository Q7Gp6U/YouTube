import { NextResponse, type NextRequest } from "next/server"

import { updateSession } from "@/lib/supabase/proxy"

const PROTECTED_PATHS = new Set(["/"])

export async function proxy(request: NextRequest) {
  if (process.env.NODE_ENV !== "production" && process.env.TEST_BYPASS_AUTH === "1") {
    return NextResponse.next({
      request,
    })
  }

  const { response, user } = await updateSession(request)
  const { pathname } = request.nextUrl

  if (PROTECTED_PATHS.has(pathname) && !user) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = "/auth"
    redirectUrl.searchParams.set("redirectedFrom", pathname)
    return NextResponse.redirect(redirectUrl)
  }

  if (pathname === "/auth" && user) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = "/"
    redirectUrl.search = ""
    return NextResponse.redirect(redirectUrl)
  }

  return response
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
