"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

export function JobIdRedirect() {
  const router = useRouter()
  const [jobId, setJobId] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const id = jobId.trim()
    if (!id) {
      setError("Enter a job ID.")
      return
    }
    setError(null)
    router.push(`/anonymize/${encodeURIComponent(id)}`)
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-2">
      <p className="text-xs text-muted-foreground">
        Already have a job ID? Paste it to view status.
      </p>
      <div className="flex gap-2">
        <Input
          value={jobId}
          onChange={(e) => setJobId(e.currentTarget.value)}
          placeholder="Job ID (UUID)"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          className="font-mono"
          aria-invalid={!!error}
        />
        <Button type="submit" variant="secondary">
          Go
        </Button>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  )
}

