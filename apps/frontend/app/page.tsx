import { ThemeToggle } from "@/components/theme-toggle"

export default function Page() {
  return (
    <div className="relative min-h-svh">
      <div className="absolute top-6 right-6">
        <ThemeToggle />
      </div>
    </div>
  )
}
