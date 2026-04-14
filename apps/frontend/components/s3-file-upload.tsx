"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

type Status = "idle" | "uploading" | "error"

type FileRow = {
  file: File
  fileId: string
  state: "queued" | "uploading" | "uploaded" | "error"
  error?: string
}

function isAllowedUploadFile(file: File): boolean {
  const name = file.name.toLowerCase()
  if (name.endsWith(".txt") || name.endsWith(".rtf")) return true
  return (
    file.type === "text/plain" ||
    file.type === "application/rtf" ||
    file.type === "text/rtf"
  )
}

function parseS3ErrorXml(text: string): string | null {
  const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1]
  const message = text.match(/<Message>([^<]+)<\/Message>/)?.[1]
  if (!code && !message) return null
  return [code, message].filter(Boolean).join(": ")
}

export function S3FileUpload({ className }: { className?: string }) {
  const router = useRouter()
  const [status, setStatus] = React.useState<Status>("idle")
  const [message, setMessage] = React.useState("")
  const [rows, setRows] = React.useState<FileRow[]>([])

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const files = Array.from(input.files ?? [])
    input.value = ""
    if (files.length === 0) return

    const invalid = files.find((f) => !isAllowedUploadFile(f))
    if (invalid) {
      setStatus("error")
      setMessage("Only .txt and .rtf files are allowed.")
      return
    }

    setRows((prev) => {
      const existing = new Set(
        prev.map((r) => `${r.file.name}::${r.file.size}::${r.file.lastModified}`)
      )
      const next = [...prev]
      for (const file of files) {
        const key = `${file.name}::${file.size}::${file.lastModified}`
        if (existing.has(key)) continue
        next.push({ file, fileId: crypto.randomUUID(), state: "queued" })
        existing.add(key)
      }
      return next
    })
    setStatus("idle")
    setMessage("")
  }

  async function onAnonymize() {
    if (rows.length === 0) {
      setStatus("error")
      setMessage("Choose one or more .txt or .rtf files first.")
      return
    }

    setStatus("uploading")
    setMessage("")

    try {
      const jobRes = await fetch("/api/jobs", { method: "POST" })
      const jobData: unknown = await jobRes.json().catch(() => ({}))
      if (!jobRes.ok) {
        setStatus("error")
        setMessage(
          typeof jobData === "object" &&
            jobData !== null &&
            "error" in jobData &&
            typeof (jobData as { error: unknown }).error === "string"
            ? (jobData as { error: string }).error
            : "Could not create job"
        )
        return
      }
      if (
        typeof jobData !== "object" ||
        jobData === null ||
        !("jobId" in jobData) ||
        typeof (jobData as { jobId: unknown }).jobId !== "string"
      ) {
        setStatus("error")
        setMessage("Invalid job response")
        return
      }

      const { jobId } = jobData as { jobId: string }
      for (const row of rows) {
        setRows((prev) =>
          prev.map((r) => (r.fileId === row.fileId ? { ...r, state: "uploading" } : r))
        )

        const params = new URLSearchParams({
          jobId,
          fileId: row.fileId,
          fileName: row.file.name,
        })
        const urlRes = await fetch(`/api/upload-url?${params}`)
        const urlData: unknown = await urlRes.json().catch(() => ({}))

        if (!urlRes.ok) {
          const errMsg =
            typeof urlData === "object" &&
            urlData !== null &&
            "error" in urlData &&
            typeof (urlData as { error: unknown }).error === "string"
              ? (urlData as { error: string }).error
              : "Failed to get upload URL"
          setRows((prev) =>
            prev.map((r) =>
              r.fileId === row.fileId ? { ...r, state: "error", error: errMsg } : r
            )
          )
          continue
        }

        if (
          typeof urlData !== "object" ||
          urlData === null ||
          !("url" in urlData) ||
          typeof (urlData as { url: unknown }).url !== "string" ||
          !("key" in urlData) ||
          typeof (urlData as { key: unknown }).key !== "string" ||
          !("bucket" in urlData) ||
          typeof (urlData as { bucket: unknown }).bucket !== "string"
        ) {
          setRows((prev) =>
            prev.map((r) =>
              r.fileId === row.fileId
                ? { ...r, state: "error", error: "Invalid response from server" }
                : r
            )
          )
          continue
        }

        const { url, key, bucket } = urlData as { url: string; key: string; bucket: string }
        const putRes = await fetch(url, { method: "PUT", body: row.file })
        if (!putRes.ok) {
          const detail = parseS3ErrorXml(await putRes.text())
          const errMsg = detail
            ? `Upload failed (${putRes.status}) — ${detail}`
            : `Upload failed (${putRes.status})`
          setRows((prev) =>
            prev.map((r) =>
              r.fileId === row.fileId ? { ...r, state: "error", error: errMsg } : r
            )
          )
          continue
        }

        const fileUrl = `s3://${bucket}/${key}`
        const recordRes = await fetch("/api/file-record", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId,
            fileId: row.fileId,
            fileUrl,
            fileName: row.file.name,
          }),
        })
        if (!recordRes.ok) {
          const recordData: unknown = await recordRes.json().catch(() => ({}))
          const errMsg =
            typeof recordData === "object" &&
            recordData !== null &&
            "error" in recordData &&
            typeof (recordData as { error: unknown }).error === "string"
              ? (recordData as { error: string }).error
              : "Upload succeeded but failed to save file metadata"
          setRows((prev) =>
            prev.map((r) =>
              r.fileId === row.fileId ? { ...r, state: "error", error: errMsg } : r
            )
          )
          continue
        }

        setRows((prev) =>
          prev.map((r) => (r.fileId === row.fileId ? { ...r, state: "uploaded" } : r))
        )
      }

      router.push(`/anonymize/${jobId}`)
    } catch {
      setStatus("error")
      setMessage("Network error")
    }
  }

  return (
    <div className={cn("flex w-full flex-col gap-4", className)}>
      <p id="s3-upload-hint" className="text-xs text-muted-foreground">
        <span className="font-mono">.txt</span> or{" "}
        <span className="font-mono">.rtf</span> only. Upload runs when you click
        Anonymize.
      </p>
      <Input
        type="file"
        accept=".txt,.rtf,text/plain,application/rtf,text/rtf"
        multiple
        aria-describedby="s3-upload-hint"
        aria-busy={status === "uploading"}
        disabled={status === "uploading"}
        onChange={onChange}
      />
      {rows.length > 0 ? (
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Selected files: <span className="font-medium text-foreground">{rows.length}</span>
          </p>
          <ul className="space-y-1">
            {rows.map((r) => (
              <li key={r.fileId} className="flex items-center justify-between gap-3">
                <p className="min-w-0 flex-1 truncate text-xs text-foreground" title={r.file.name}>
                  {r.file.name}
                </p>
                <p className="shrink-0 text-[11px] text-muted-foreground">
                  {r.state === "queued"
                    ? "queued"
                    : r.state === "uploading"
                      ? "uploading…"
                      : r.state === "uploaded"
                        ? "uploaded"
                        : "error"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Button
        type="button"
        variant="default"
        className="w-full py-6 text-base"
        disabled={rows.length === 0 || status === "uploading"}
        aria-busy={status === "uploading"}
        onClick={onAnonymize}
      >
        {status === "uploading" ? "Uploading…" : "Anonymize"}
      </Button>
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
