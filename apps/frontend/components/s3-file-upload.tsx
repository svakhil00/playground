"use client"

import * as React from "react"

import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

type Status = "idle" | "uploading" | "success" | "error"

function parseS3ErrorXml(text: string): string | null {
  const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1]
  const message = text.match(/<Message>([^<]+)<\/Message>/)?.[1]
  if (!code && !message) return null
  return [code, message].filter(Boolean).join(": ")
}

export function S3FileUpload({ className }: { className?: string }) {
  const [status, setStatus] = React.useState<Status>("idle")
  const [message, setMessage] = React.useState("")

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const file = input.files?.[0]
    input.value = ""
    if (!file) return

    setStatus("uploading")
    setMessage("")

    try {
      const res = await fetch("/api/upload-url")
      const data: unknown = await res.json().catch(() => ({}))

      if (!res.ok) {
        setStatus("error")
        setMessage(
          typeof data === "object" &&
            data !== null &&
            "error" in data &&
            typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Failed to get upload URL"
        )
        return
      }

      if (
        typeof data !== "object" ||
        data === null ||
        !("url" in data) ||
        typeof (data as { url: unknown }).url !== "string"
      ) {
        setStatus("error")
        setMessage("Invalid response from server")
        return
      }

      const { url } = data as { url: string }

      const putRes = await fetch(url, {
        method: "PUT",
        body: file,
      })

      if (!putRes.ok) {
        const detail = parseS3ErrorXml(await putRes.text())
        setStatus("error")
        setMessage(
          detail
            ? `Upload failed (${putRes.status}) — ${detail}`
            : `Upload failed (${putRes.status})`
        )
        return
      }

      setStatus("success")
      setMessage("Uploaded successfully.")
    } catch {
      setStatus("error")
      setMessage("Network error")
    }
  }

  return (
    <div className={cn("flex w-full flex-col gap-2", className)}>
      <Input
        type="file"
        aria-busy={status === "uploading"}
        disabled={status === "uploading"}
        onChange={onChange}
      />
      {message ? (
        <p
          role="status"
          className={cn(
            "text-sm",
            status === "error" ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {message}
        </p>
      ) : null}
    </div>
  )
}
