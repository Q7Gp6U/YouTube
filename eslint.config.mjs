import nextVitals from "eslint-config-next/core-web-vitals"
import nextTypescript from "eslint-config-next/typescript"

const config = [
  {
    ignores: [
      ".git/**",
      ".kilo/**",
      ".next/**",
      "node_modules/**",
      "supabase/**",
      "components/ui/sidebar.tsx",
    ],
  },
  ...nextVitals,
  ...nextTypescript,
]

export default config
