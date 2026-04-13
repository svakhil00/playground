"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

type Status = "idle" | "uploading" | "error"

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
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null)

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const file = input.files?.[0]
    input.value = ""
    if (!file) return

    if (!isAllowedUploadFile(file)) {
      setSelectedFile(null)
      setStatus("error")
      setMessage("Only .txt and .rtf files are allowed.")
      return
    }

    setSelectedFile(file)
    setStatus("idle")
    setMessage("")
  }

  async function onAnonymize() {
    if (!selectedFile) {
      setStatus("error")
      setMessage("Choose a .txt or .rtf file first.")
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
      const fileId = crypto.randomUUID()

      const params = new URLSearchParams({
        jobId,
        fileId,
        fileName: selectedFile.name,
      })
      const urlRes = await fetch(`/api/upload-url?${params}`)
      const urlData: unknown = await urlRes.json().catch(() => ({}))

      if (!urlRes.ok) {
        setStatus("error")
        setMessage(
          typeof urlData === "object" &&
            urlData !== null &&
            "error" in urlData &&
            typeof (urlData as { error: unknown }).error === "string"
            ? (urlData as { error: string }).error
            : "Failed to get upload URL"
        )
        return
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
        setStatus("error")
        setMessage("Invalid response from server")
        return
      }

      const { url, key, bucket } = urlData as {
        url: string
        key: string
        bucket: string
      }

      const putRes = await fetch(url, {
        method: "PUT",
        body: selectedFile,
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

      const fileUrl = `s3://${bucket}/${key}`

      const recordRes = await fetch("/api/file-record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          fileId,
          fileUrl,
          fileName: selectedFile.name,
        }),
      })
      if (!recordRes.ok) {
        const recordData: unknown = await recordRes.json().catch(() => ({}))
        setStatus("error")
        setMessage(
          typeof recordData === "object" &&
            recordData !== null &&
            "error" in recordData &&
            typeof (recordData as { error: unknown }).error === "string"
            ? (recordData as { error: string }).error
            : "Upload succeeded but failed to save file metadata"
        )
        return
      }

      router.push(`/anonymize/${jobId}`)
    } catch {
      setStatus("error")
      setMessage("Network error")
    }
  }

  return (
    <div className={cn("flex w-full flex-col gap-2", className)}>
      <p id="s3-upload-hint" className="text-xs text-muted-foreground">
        <span className="font-mono">.txt</span> or{" "}
        <span className="font-mono">.rtf</span> only. Upload runs when you click
        Anonymize.
      </p>
      <Input
        type="file"
        accept=".txt,.rtf,text/plain,application/rtf,text/rtf"
        aria-describedby="s3-upload-hint"
        aria-busy={status === "uploading"}
        disabled={status === "uploading"}
        onChange={onChange}
      />
      {selectedFile && status !== "uploading" ? (
        <p className="truncate text-xs text-muted-foreground" title={selectedFile.name}>
          Selected: <span className="font-medium text-foreground">{selectedFile.name}</span>
        </p>
      ) : null}
      <Button
        type="button"
        variant="default"
        className="w-full"
        disabled={!selectedFile || status === "uploading"}
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
