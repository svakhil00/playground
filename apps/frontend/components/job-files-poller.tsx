"use client"

import * as React from "react"

type FileItem = {
  jobId?: string
  fileId?: string
  fileName?: string
  fileUrl?: string
  status?: string
  createdAt?: string
}

export function JobFilesPoller({ jobId }: { jobId: string }) {
  const [items, setItems] = React.useState<FileItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

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
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files recorded yet.</p>
      ) : (
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
              </p>
              {item.fileUrl ? (
                <p
                  className="truncate font-mono text-[11px] text-muted-foreground"
                  title={item.fileUrl}
                >
                  {item.fileUrl}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
