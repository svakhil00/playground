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
  model1At?: string
  model1Text?: string
  model1Replacements?: Array<{ original?: string; replacement?: string }>
  model2At?: string
  model2Text?: string
  model2Replacements?: Array<{ original?: string; replacement?: string }>
  evaluation?: {
    model1: {
      replacements: { total: number; byType: Array<{ type: string; count: number }> }
      possibleMisses: Array<{ kind: string; match: string }>
    }
    model2: {
      replacements: { total: number; byType: Array<{ type: string; count: number }> }
      possibleMisses: Array<{ kind: string; match: string }>
    }
    disagreement: {
      model1Only: Array<{ original: string; replacement: string }>
      model2Only: Array<{ original: string; replacement: string }>
    }
  } | null
}

function formatWhen(iso: string | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

type Replacement = { original?: string; replacement?: string }

function pairKey(r: Replacement): string {
  return `${r.original ?? ""}→${r.replacement ?? ""}`
}

function getTypeFromReplacementToken(token: string | undefined): string | null {
  if (!token) return null
  const t = token.trim()
  const stripped = t.startsWith("[") && t.endsWith("]") ? t.slice(1, -1) : t
  const m = stripped.match(/^([A-Z_]+)_\d+$/)
  return m?.[1] ?? null
}

function isNameReplacement(r: Replacement): boolean {
  const t = getTypeFromReplacementToken(r.replacement)
  if (!t) return false
  return t === "NAME" || t.endsWith("_NAME") || t.includes("NAME") || t.includes("PERSON")
}

function applyReverts(text: string, replacements: Replacement[], revertedKeys: Set<string>): string {
  let out = text
  for (const r of replacements) {
    const key = pairKey(r)
    if (!revertedKeys.has(key)) continue
    if (!r.original || !r.replacement) continue
    out = out.split(r.replacement).join(r.original)
  }
  return out
}

function applyOverrides(
  text: string,
  replacements: Replacement[],
  revealedKeys: Set<string>,
  overridesByKey: Record<string, string>
): string {
  let out = text
  for (const r of replacements) {
    const key = pairKey(r)
    if (revealedKeys.has(key)) continue
    const next = overridesByKey[key]
    if (!next) continue
    if (!r.replacement) continue
    out = out.split(r.replacement).join(next)
  }
  return out
}

type HoverState = {
  r: Replacement
  x: number
  y: number
} | null

function renderHighlightedText(
  text: string,
  replacements: Replacement[],
  revealedKeys: Set<string>,
  overridesByKey: Record<string, string>,
  onHover: (next: HoverState) => void,
  onToggleReveal: (r: Replacement) => void
): React.ReactNode {
  const active = replacements.filter((r) => r.replacement && r.original)

  const uniq = Array.from(
    new Set(active.map((r) => r.replacement as string))
  ).sort((a, b) => b.length - a.length)

  if (uniq.length === 0) return text

  const re = new RegExp(`(${uniq.map(escapeRegExp).join("|")})`, "g")
  const parts = text.split(re)

  return parts.map((part, idx) => {
    const r = active.find((x) => x.replacement === part)
    if (!r) return <React.Fragment key={idx}>{part}</React.Fragment>
    const key = pairKey(r)
    const override = overridesByKey[key]
    const shown = revealedKeys.has(key) ? (r.original ?? part) : (override ?? part)
    return (
      <span
        key={idx}
        onMouseEnter={(e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          onHover({ r, x: rect.left, y: rect.bottom })
        }}
        onMouseLeave={() => onHover(null)}
        onClick={() => onToggleReveal(r)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onToggleReveal(r)
        }}
        className="cursor-pointer"
      >
        <mark
          className="rounded-sm bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-500/30"
        >
          {shown}
        </mark>
      </span>
    )
  })
}

export function JobFilesPoller({ jobId }: { jobId: string }) {
  const [items, setItems] = React.useState<FileItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [extractState, setExtractState] = React.useState<
    "idle" | "starting" | "done" | "error"
  >("idle")
  const [anonymizerState, setAnonymizerState] = React.useState<
    "idle" | "starting" | "done" | "error"
  >("idle")
  const [extractMessage, setExtractMessage] = React.useState<string>("")
  const [anonymizerMessage, setAnonymizerMessage] = React.useState<string>("")
  const [revealedByFileId, setRevealedByFileId] = React.useState<
    Record<string, string[]>
  >({})
  const [overridesByFileId, setOverridesByFileId] = React.useState<
    Record<string, Record<string, string>>
  >({})
  const [reviewIndexByFileId, setReviewIndexByFileId] = React.useState<
    Record<string, number>
  >({})
  const [focusedModelByFileId, setFocusedModelByFileId] = React.useState<
    Record<string, "model1" | "model2">
  >({})
  const [copiedFileId, setCopiedFileId] = React.useState<string | null>(null)
  const [selectedFileKey, setSelectedFileKey] = React.useState<string | null>(null)
  const [hover, setHover] = React.useState<HoverState>(null)

  const anonymizerStartedRef = React.useRef(false)

  React.useEffect(() => {
    anonymizerStartedRef.current = false
    setSelectedFileKey(null)
  }, [jobId])

  React.useEffect(() => {
    if (items.length === 0) return
    const keys = items.map((it) => it.fileId ?? it.fileName ?? "")
    if (selectedFileKey && keys.includes(selectedFileKey)) return
    // Default to the first file that has something to show (anonymized > extracted > anything).
    let best: FileItem = items[0]!
    const anonymized = items.find(
      (it) =>
        (it.status ?? "").toLowerCase() === "anonymized" &&
        typeof it.model1Text === "string" &&
        it.model1Text.trim() !== ""
    )
    if (anonymized) best = anonymized
    const extracted =
      anonymized ??
      items.find(
        (it) =>
          (it.status ?? "").toLowerCase() === "extracted" &&
          typeof it.extractedContent === "string" &&
          it.extractedContent.trim() !== ""
      )
    if (extracted) best = extracted

    setSelectedFileKey(best.fileId ?? best.fileName ?? null)
  }, [items, selectedFileKey])

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
        await fetchFiles()
      } catch {
        setExtractState("error")
        setExtractMessage("Extract failed (network error).")
      }
    })()
  }, [items, jobId, extractState, fetchFiles])

  /** After every file is `extracted` with content, invoke the Python anonymizer Lambda once. */
  React.useEffect(() => {
    if (anonymizerStartedRef.current) return
    if (!items.length) return
    const allExtracted = items.every(
      (it) => (it.status ?? "").toLowerCase() === "extracted"
    )
    if (!allExtracted) return
    const allHaveContent = items.every(
      (it) => typeof it.extractedContent === "string" && it.extractedContent.trim() !== ""
    )
    if (!allHaveContent) return
    const anyPendingAnonymizer = items.some((it) => !it.model1At || !it.model2At)
    if (!anyPendingAnonymizer) return

    anonymizerStartedRef.current = true
    setAnonymizerState("starting")
    setAnonymizerMessage("Running anonymizer…")
    void (async () => {
      try {
        const res = await fetch(
          `/api/jobs/${encodeURIComponent(jobId)}/invoke-anonymizer`,
          { method: "POST" }
        )
        const data: unknown = await res.json().catch(() => ({}))
        const payload = data as { ok?: boolean; error?: string; results?: unknown }
        if (!res.ok || payload.ok === false) {
          anonymizerStartedRef.current = false
          setAnonymizerState("error")
          setAnonymizerMessage(
            typeof payload.error === "string"
              ? payload.error
              : !res.ok
                ? `Anonymizer failed (${res.status})`
                : "One or more files failed anonymization"
          )
          return
        }
        setAnonymizerState("done")
        await fetchFiles()
      } catch {
        anonymizerStartedRef.current = false
        setAnonymizerState("error")
        setAnonymizerMessage("Anonymizer failed (network error).")
      }
    })()
  }, [items, jobId, fetchFiles])

  return (
    <div className="w-full max-w-6xl space-y-4 text-left">
      {hover ? (
        <div
          className="fixed z-50 w-80 rounded-md border border-border bg-popover p-3 text-left text-xs text-popover-foreground shadow-md"
          style={{
            left: Math.min(hover.x, window.innerWidth - 340),
            top: hover.y + 8,
          }}
          onMouseEnter={() => setHover(hover)}
          onMouseLeave={() => setHover(null)}
        >
          <span className="mb-2 block">
            <span className="font-medium">Original:</span>{" "}
            <span className="font-mono">{String(hover.r.original)}</span>
          </span>
        </div>
      ) : null}

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
      {!loading && !error && anonymizerState === "starting" ? (
        <p className="text-sm text-muted-foreground">{anonymizerMessage}</p>
      ) : null}
      {!loading && !error && anonymizerState === "error" ? (
        <p className="text-sm text-destructive" role="alert">
          {anonymizerMessage}
        </p>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files recorded yet.</p>
      ) : null}

      {!loading && !error && items.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[220px_1fr]">
          <ul className="max-h-[78vh] overflow-auto space-y-2 rounded-lg border border-border bg-muted/20 p-3">
            {items.map((item) => (
              <li
                key={`${item.fileId ?? "file"}-${item.createdAt ?? ""}`}
                className={
                  "rounded-md border p-3 " +
                  ((item.fileId ?? item.fileName ?? "") === selectedFileKey
                    ? "border-primary bg-primary/5"
                    : "border-border bg-background hover:bg-muted/30")
                }
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() =>
                    setSelectedFileKey(item.fileId ?? item.fileName ?? null)
                  }
                >
                  <p
                    className="truncate text-sm font-medium text-foreground"
                    title={item.fileName}
                  >
                    {item.fileName ?? item.fileId ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.status ?? "—"}
                    {item.createdAt
                      ? ` · uploaded ${formatWhen(item.createdAt) ?? item.createdAt}`
                      : null}
                  </p>
                </button>
              </li>
            ))}
          </ul>

          <div className="space-y-4">
            {items
              .filter(
                (it) => (it.fileId ?? it.fileName ?? "") === selectedFileKey
              )
              .map((item) => {
              const status = (item.status ?? "").toLowerCase()
              const showExtracted =
                status === "extracted" &&
                typeof item.extractedContent === "string" &&
                item.extractedContent.trim() !== ""
              const showAnonymized =
                status === "anonymized" &&
                typeof item.model1Text === "string" &&
                item.model1Text.trim() !== "" &&
                typeof item.model2Text === "string" &&
                item.model2Text.trim() !== ""

              if (!showExtracted && !showAnonymized) {
                return (
                  <section
                    key={`content-${item.fileId ?? item.fileName ?? "file"}`}
                    className="rounded-lg border border-border bg-background"
                  >
                    <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
                      <div className="flex min-w-0 flex-col gap-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {item.fileName ?? item.fileId ?? "—"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          No extracted/anonymized content yet.
                        </p>
                      </div>
                    </div>
                    <div className="p-4 text-sm text-muted-foreground">
                      Waiting for processing…
                    </div>
                  </section>
                )
              }

              const title = item.fileName ?? item.fileId ?? "—"
              const replacements1 = item.model1Replacements ?? []
              const replacements2 = item.model2Replacements ?? []
              const fileKey = item.fileId ?? title
              const focusedModel = focusedModelByFileId[fileKey] ?? "model1"
              const scopeKey = `${fileKey}:${focusedModel}`
              const overridesByKey = overridesByFileId[scopeKey] ?? {}
              const baseBody = showAnonymized ? item.model1Text! : item.extractedContent!
              const body1ForRender = showAnonymized ? item.model1Text! : baseBody
              const body2ForRender = showAnonymized ? item.model2Text! : ""
              const model1ScopeKey = `${fileKey}:model1`
              const model2ScopeKey = `${fileKey}:model2`
              const revealedKeys1 = new Set(revealedByFileId[model1ScopeKey] ?? [])
              const revealedKeys2 = new Set(revealedByFileId[model2ScopeKey] ?? [])
              const overridesByKey1 = overridesByFileId[model1ScopeKey] ?? {}
              const overridesByKey2 = overridesByFileId[model2ScopeKey] ?? {}
              const body1ForCopy = showAnonymized
                ? applyOverrides(
                    applyReverts(item.model1Text!, replacements1, revealedKeys1),
                    replacements1,
                    revealedKeys1,
                    overridesByKey1
                  )
                : baseBody
              const body2ForCopy = showAnonymized
                ? applyOverrides(
                    applyReverts(item.model2Text!, replacements2, revealedKeys2),
                    replacements2,
                    revealedKeys2,
                    overridesByKey2
                  )
                : ""
              const evaluation = item.evaluation
              const summary1 = evaluation?.model1.replacements ?? { total: 0, byType: [] }
              const summary2 = evaluation?.model2.replacements ?? { total: 0, byType: [] }
              const misses1 = evaluation?.model1.possibleMisses ?? []
              const misses2 = evaluation?.model2.possibleMisses ?? []

              const focusedReplacements =
                focusedModel === "model2" ? replacements2 : replacements1
              const nameReplacements = focusedReplacements.filter(
                (r) => r.original && r.replacement && isNameReplacement(r)
              )
              const nameKeys = Array.from(new Set(nameReplacements.map(pairKey)))
              const reviewIdxRaw = reviewIndexByFileId[scopeKey] ?? 0
              const reviewIdx =
                nameKeys.length === 0
                  ? 0
                  : Math.min(Math.max(reviewIdxRaw, 0), nameKeys.length - 1)
              const activeNameKey = nameKeys[reviewIdx] ?? null
              const activeNameReplacement =
                activeNameKey
                  ? (nameReplacements.find((r) => pairKey(r) === activeNameKey) ?? null)
                  : null

              return (
                <section
                  key={`content-${item.fileId ?? title}`}
                  className="rounded-lg border border-border bg-background"
                >
                  <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="truncate text-sm font-medium text-foreground">{title}</p>
                    <p className="text-xs text-muted-foreground">
                      {showAnonymized ? "Models complete" : "Extracted text"}
                      {item.extractedAt
                        ? ` · extracted ${formatWhen(item.extractedAt) ?? item.extractedAt}`
                        : null}
                      {item.model1At ? ` · model 1 ${formatWhen(item.model1At) ?? item.model1At}` : null}
                      {item.model2At ? ` · model 2 ${formatWhen(item.model2At) ?? item.model2At}` : null}
                    </p>
                    </div>
                    {/* Copy buttons live per-model below */} 
                  </div>
                  {showAnonymized ? (
                    <div className="p-4">
                      <details className="mb-4 rounded-md border border-border bg-background p-3">
                        <summary className="cursor-pointer text-sm font-medium text-foreground">
                          Details
                        </summary>
                        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                          <div className="rounded-md border border-border bg-background p-3">
                            <p className="text-xs font-medium text-muted-foreground">Model 1</p>
                            <p className="mt-1 text-sm text-foreground">
                              Replacements: <span className="font-semibold">{summary1.total}</span> · Possible misses:{" "}
                              <span className="font-semibold">{misses1.length}</span>
                            </p>
                            <p className="mt-3 text-xs font-medium text-muted-foreground">Counts by PII type</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {summary1.byType.length ? (
                                summary1.byType.map((x) => (
                                  <span
                                    key={`m1-${x.type}`}
                                    className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-foreground"
                                  >
                                    {x.type} · {x.count}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-muted-foreground">No replacements</span>
                              )}
                            </div>
                            <p className="mt-3 text-xs font-medium text-muted-foreground">Possible misses</p>
                            <div className="mt-2 max-h-28 overflow-auto rounded-md border border-border bg-background p-2">
                              {misses1.length ? (
                                <ul className="space-y-1 text-xs text-foreground">
                                  {misses1.slice(0, 50).map((x) => (
                                    <li key={`miss1-${x.kind}-${x.match}`}>
                                      <span className="font-medium">{x.kind}</span>: {x.match}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-xs text-muted-foreground">No obvious patterns found</p>
                              )}
                            </div>
                          </div>

                          <div className="rounded-md border border-border bg-background p-3">
                            <p className="text-xs font-medium text-muted-foreground">Model 2</p>
                            <p className="mt-1 text-sm text-foreground">
                              Replacements: <span className="font-semibold">{summary2.total}</span> · Possible misses:{" "}
                              <span className="font-semibold">{misses2.length}</span>
                            </p>
                            <p className="mt-3 text-xs font-medium text-muted-foreground">Counts by PII type</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {summary2.byType.length ? (
                                summary2.byType.map((x) => (
                                  <span
                                    key={`m2-${x.type}`}
                                    className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-foreground"
                                  >
                                    {x.type} · {x.count}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-muted-foreground">No replacements</span>
                              )}
                            </div>
                            <p className="mt-3 text-xs font-medium text-muted-foreground">Possible misses</p>
                            <div className="mt-2 max-h-28 overflow-auto rounded-md border border-border bg-background p-2">
                              {misses2.length ? (
                                <ul className="space-y-1 text-xs text-foreground">
                                  {misses2.slice(0, 50).map((x) => (
                                    <li key={`miss2-${x.kind}-${x.match}`}>
                                      <span className="font-medium">{x.kind}</span>: {x.match}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-xs text-muted-foreground">No obvious patterns found</p>
                              )}
                            </div>
                          </div>
                        </div>
                      </details>

                      <div className="mb-4 rounded-md border border-border bg-background p-3">
                        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-muted-foreground">Review names</p>
                            <p className="mt-1 text-sm text-foreground">
                              {nameKeys.length ? (
                                <>
                                  <span className="font-semibold">{reviewIdx + 1}</span> /{" "}
                                  <span className="font-semibold">{nameKeys.length}</span>
                                  {activeNameReplacement?.original ? (
                                    <>
                                      {" "}
                                      · <span className="text-muted-foreground">original</span>{" "}
                                      <span className="font-mono">{activeNameReplacement.original}</span>
                                    </>
                                  ) : null}
                                  {activeNameReplacement?.replacement ? (
                                    <>
                                      {" "}
                                      · <span className="text-muted-foreground">token</span>{" "}
                                      <span className="font-mono">{activeNameReplacement.replacement}</span>
                                    </>
                                  ) : null}
                                </>
                              ) : (
                                <span className="text-muted-foreground">No name tokens detected</span>
                              )}
                            </p>
                          </div>

                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className={
                                  "rounded-full border px-2 py-1 text-xs font-medium " +
                                  (focusedModel === "model1"
                                    ? "border-primary bg-primary/10 text-foreground"
                                    : "border-border bg-background text-muted-foreground hover:bg-muted")
                                }
                                onClick={() =>
                                  setFocusedModelByFileId((prev) => ({ ...prev, [fileKey]: "model1" }))
                                }
                                aria-pressed={focusedModel === "model1"}
                              >
                                Model 1
                              </button>
                              <button
                                type="button"
                                className={
                                  "rounded-full border px-2 py-1 text-xs font-medium " +
                                  (focusedModel === "model2"
                                    ? "border-primary bg-primary/10 text-foreground"
                                    : "border-border bg-background text-muted-foreground hover:bg-muted")
                                }
                                onClick={() =>
                                  setFocusedModelByFileId((prev) => ({ ...prev, [fileKey]: "model2" }))
                                }
                                aria-pressed={focusedModel === "model2"}
                              >
                                Model 2
                              </button>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                                disabled={nameKeys.length === 0}
                                onClick={() => {
                                  if (nameKeys.length === 0) return
                                  setReviewIndexByFileId((prev) => ({
                                    ...prev,
                                    [scopeKey]: (reviewIdx - 1 + nameKeys.length) % nameKeys.length,
                                  }))
                                }}
                              >
                                Previous
                              </button>
                              <button
                                type="button"
                                className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                                disabled={nameKeys.length === 0}
                                onClick={() => {
                                  if (nameKeys.length === 0) return
                                  setReviewIndexByFileId((prev) => ({
                                    ...prev,
                                    [scopeKey]: (reviewIdx + 1) % nameKeys.length,
                                  }))
                                }}
                              >
                                Next
                              </button>
                            </div>

                            <div className="flex min-w-0 items-center gap-2">
                              <input
                                className="h-9 w-full min-w-[240px] rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
                                placeholder="Custom replacement (e.g. NAME_1 → Ethan)"
                                disabled={!activeNameKey}
                                value={activeNameKey ? (overridesByKey[activeNameKey] ?? "") : ""}
                                onChange={(e) => {
                                  const v = e.target.value
                                  if (!activeNameKey) return
                                  setOverridesByFileId((prev) => ({
                                    ...prev,
                                    [scopeKey]: { ...(prev[scopeKey] ?? {}), [activeNameKey]: v },
                                  }))
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                                }}
                              />
                              <button
                                type="button"
                                className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                                disabled={!activeNameKey || !overridesByKey[activeNameKey]}
                                onClick={() => {
                                  if (!activeNameKey) return
                                  setOverridesByFileId((prev) => {
                                    const nextFile = { ...(prev[scopeKey] ?? {}) }
                                    delete nextFile[activeNameKey]
                                    return { ...prev, [scopeKey]: nextFile }
                                  })
                                }}
                              >
                                Clear
                              </button>
                            </div>
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Tip: click any highlighted token to reveal the original; use this field to override the anonymized name without revealing it.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <div className="min-w-0">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-xs font-medium text-muted-foreground">
                            Model 1
                          </p>
                          <button
                            type="button"
                            className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
                            title={
                              copiedFileId === `${item.fileId ?? title}:model1`
                                ? "Copied"
                                : "Copy model 1"
                            }
                            onClick={() => {
                              const id = `${item.fileId ?? title}:model1`
                              void navigator.clipboard.writeText(body1ForCopy)
                              setCopiedFileId(id)
                              window.setTimeout(() => {
                                setCopiedFileId((cur) => (cur === id ? null : cur))
                              }, 1200)
                            }}
                          >
                            {copiedFileId === `${item.fileId ?? title}:model1`
                              ? "Copied"
                              : "Copy"}
                          </button>
                        </div>
                        <pre className="h-[70vh] overflow-auto whitespace-pre-wrap wrap-break-word rounded-md border border-border bg-background p-4 font-mono text-sm leading-relaxed text-foreground">
                          {renderHighlightedText(
                            body1ForRender,
                            replacements1,
                            revealedKeys1,
                            overridesByKey1,
                            setHover,
                            (r) => {
                              setFocusedModelByFileId((prev) => ({ ...prev, [fileKey]: "model1" }))
                              const key = pairKey(r)
                              setRevealedByFileId((prev) => {
                                const cur = new Set(prev[model1ScopeKey] ?? [])
                                if (cur.has(key)) cur.delete(key)
                                else cur.add(key)
                                return { ...prev, [model1ScopeKey]: Array.from(cur) }
                              })
                            }
                          )}
                        </pre>
                      </div>
                      <div className="min-w-0">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-xs font-medium text-muted-foreground">
                            Model 2
                          </p>
                          <button
                            type="button"
                            className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
                            title={
                              copiedFileId === `${item.fileId ?? title}:model2`
                                ? "Copied"
                                : "Copy model 2"
                            }
                            onClick={() => {
                              const id = `${item.fileId ?? title}:model2`
                              void navigator.clipboard.writeText(body2ForCopy)
                              setCopiedFileId(id)
                              window.setTimeout(() => {
                                setCopiedFileId((cur) => (cur === id ? null : cur))
                              }, 1200)
                            }}
                          >
                            {copiedFileId === `${item.fileId ?? title}:model2`
                              ? "Copied"
                              : "Copy"}
                          </button>
                        </div>
                        <pre className="h-[70vh] overflow-auto whitespace-pre-wrap wrap-break-word rounded-md border border-border bg-background p-4 font-mono text-sm leading-relaxed text-foreground">
                          {renderHighlightedText(
                            body2ForRender,
                            replacements2,
                            revealedKeys2,
                            overridesByKey2,
                            setHover,
                            (r) => {
                              setFocusedModelByFileId((prev) => ({ ...prev, [fileKey]: "model2" }))
                              const key = pairKey(r)
                              setRevealedByFileId((prev) => {
                                const cur = new Set(prev[model2ScopeKey] ?? [])
                                if (cur.has(key)) cur.delete(key)
                                else cur.add(key)
                                return { ...prev, [model2ScopeKey]: Array.from(cur) }
                              })
                            }
                          )}
                        </pre>
                      </div>
                    </div>
                    </div>
                  ) : (
                    <pre className="h-[78vh] overflow-auto whitespace-pre-wrap wrap-break-word p-4 font-mono text-sm leading-relaxed text-foreground">
                      {body1ForRender}
                    </pre>
                  )}
                </section>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
