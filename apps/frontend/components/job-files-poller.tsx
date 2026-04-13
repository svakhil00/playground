"use client"

import * as React from "react"

type FileItem = {
  jobId?: string
  fileId?: string
  fileName?: string
  fileUrl?: string
  status?: string
  createdAt?: string
  extractedContent?: string
  extractedAt?: string
}

export function JobFilesPoller({ jobId }: { jobId: string }) {
  const [items, setItems] = React.useState<FileItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [extractState, setExtractState] = React.useState<
    "idle" | "starting" | "done" | "error"
  >("idle")
  const [extractMessage, setExtractMessage] = React.useState<string>("")

  const fetchFiles = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/files`)
      const data: unknown = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(
          typeof data === "object" &&
            data !== null &&
            "error" in data &&
            typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Failed to load files"
        )
        return
      }

      setError(null)
      if (
        typeof data === "object" &&
        data !== null &&
        "items" in data &&
        Array.isArray((data as { items: unknown }).items)
      ) {
        setItems((data as { items: FileItem[] }).items)
      } else {
        setItems([])
      }
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }, [jobId])

  React.useEffect(() => {
    void fetchFiles()
    const intervalId = window.setInterval(() => {
      void fetchFiles()
    }, 5000)
    return () => window.clearInterval(intervalId)
  }, [fetchFiles])

  React.useEffect(() => {
    if (extractState !== "idle") return
    if (!items.length) return
    const allUploaded = items.every(
      (it) => (it.status ?? "").toLowerCase() === "uploaded"
    )
    if (!allUploaded) return

    setExtractState("starting")
    setExtractMessage("Extracting text from uploaded files…")
    void (async () => {
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/extract`, {
          method: "POST",
        })
        const data: unknown = await res.json().catch(() => ({}))
        if (!res.ok) {
          setExtractState("error")
          setExtractMessage(
            typeof data === "object" &&
              data !== null &&
              "error" in data &&
              typeof (data as { error: unknown }).error === "string"
              ? (data as { error: string }).error
              : `Extract failed (${res.status})`
          )
          return
        }
        setExtractState("done")
        setExtractMessage("Extract complete.")
        await fetchFiles()
      } catch {
        setExtractState("error")
        setExtractMessage("Extract failed (network error).")
      }
    })()
  }, [items, jobId, extractState, fetchFiles])

  return (
    <div className="w-full max-w-md space-y-3 text-left">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">Files for this job</h2>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading files…</p>
      ) : error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && !error && extractState === "starting" ? (
        <p className="text-sm text-muted-foreground">{extractMessage}</p>
      ) : null}
      {!loading && !error && extractState === "error" ? (
        <p className="text-sm text-destructive" role="alert">
          {extractMessage}
        </p>
      ) : null}
      {!loading && !error && extractState === "done" ? (
        <p className="text-sm text-muted-foreground">{extractMessage}</p>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files recorded yet.</p>
      ) : null}

      {!loading && !error && items.length > 0 ? (
        <ul className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
          {items.map((item) => (
            <li
              key={`${item.fileId ?? "file"}-${item.createdAt ?? ""}`}
              className="border-b border-border pb-2 last:border-0 last:pb-0"
            >
              <p
                className="truncate text-sm font-medium text-foreground"
                title={item.fileName}
              >
                {item.fileName ?? item.fileId ?? "—"}
              </p>
              <p className="truncate font-mono text-xs text-muted-foreground" title={item.fileId}>
                {item.fileId ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {item.status ?? "—"}
                {item.createdAt ? ` · ${item.createdAt}` : null}
                {item.extractedAt ? ` · extracted ${item.extractedAt}` : null}
              </p>
              {item.fileUrl ? (
                <p
                  className="truncate font-mono text-[11px] text-muted-foreground"
                  title={item.fileUrl}
                >
                  {item.fileUrl}
                </p>
              ) : null}
              {(item.status ?? "").toLowerCase() === "extracted" &&
              item.extractedContent !== undefined &&
              item.extractedContent !== "" ? (
                <div className="mt-2 rounded-md border border-border bg-background p-2">
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Extracted content
                  </p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap wrap-break-word font-mono text-xs text-foreground">
                    {item.extractedContent}
                  </pre>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
