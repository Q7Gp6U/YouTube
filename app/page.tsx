import { HomePageClient } from "@/components/home-page-client"
import { requireAuthenticatedUserContext } from "@/lib/auth/server"

export default async function HomePage() {
  const user = await requireAuthenticatedUserContext()

  return <HomePageClient user={user} />
}
