import { QueryCommand } from "@aws-sdk/lib-dynamodb"
import { NextResponse } from "next/server"

import { db } from "@/lib/dynamodb"

export const runtime = "nodejs"

const TABLE_NAME = "file-uploads"

type RouteContext = { params: Promise<{ jobId: string }> }

type Replacement = { original?: string; replacement?: string }

function getTypeFromReplacementToken(token: string | undefined): string | null {
  if (!token) return null
  const t = token.trim()
  const stripped = t.startsWith("[") && t.endsWith("]") ? t.slice(1, -1) : t
  const m = stripped.match(/^([A-Z_]+)_\d+$/)
  return m?.[1] ?? null
}

function summarizeReplacements(replacements: Replacement[]): {
  total: number
  byType: Array<{ type: string; count: number }>
} {
  const counts: Record<string, number> = {}
  let total = 0
  for (const r of replacements) {
    if (!r.original || !r.replacement) continue
    total += 1
    const t = getTypeFromReplacementToken(r.replacement) ?? "UNKNOWN"
    counts[t] = (counts[t] ?? 0) + 1
  }
  const byType = Object.entries(counts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
  return { total, byType }
}

function normalizeOriginal(s: string | undefined): string | null {
  if (!s) return null
  const t = s.trim()
  if (!t) return null
  return t.toLowerCase()
}

function disagreementByOriginal(
  replacements1: Replacement[],
  replacements2: Replacement[]
): {
  model1Only: Array<{ original: string; replacement: string }>
  model2Only: Array<{ original: string; replacement: string }>
} {
  const a = new Map<string, { original: string; replacement: string }>()
  const b = new Map<string, { original: string; replacement: string }>()

  for (const r of replacements1) {
    const key = normalizeOriginal(r.original)
    if (!key || !r.replacement || !r.original) continue
    if (!a.has(key)) a.set(key, { original: r.original, replacement: r.replacement })
  }
  for (const r of replacements2) {
    const key = normalizeOriginal(r.original)
    if (!key || !r.replacement || !r.original) continue
    if (!b.has(key)) b.set(key, { original: r.original, replacement: r.replacement })
  }

  const model1Only: Array<{ original: string; replacement: string }> = []
  const model2Only: Array<{ original: string; replacement: string }> = []

  for (const [k, v] of a.entries()) if (!b.has(k)) model1Only.push(v)
  for (const [k, v] of b.entries()) if (!a.has(k)) model2Only.push(v)

  model1Only.sort((x, y) => x.original.localeCompare(y.original))
  model2Only.sort((x, y) => x.original.localeCompare(y.original))

  return { model1Only, model2Only }
}

function possibleMisses(text: string): Array<{ kind: string; match: string }> {
  const hits: Array<{ kind: string; match: string }> = []
  const uniq = new Set<string>()
  const patterns: Array<{ kind: string; re: RegExp }> = [
    { kind: "email", re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
    { kind: "phone", re: /\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
    { kind: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  ]

  for (const { kind, re } of patterns) {
    for (const m of text.matchAll(re)) {
      const val = m[0]
      const key = `${kind}:${val}`
      if (uniq.has(key)) continue
      uniq.add(key)
      hits.push({ kind, match: val })
    }
  }
  return hits
}

export async function GET(_request: Request, context: RouteContext) {
  const { jobId } = await context.params
  const id = jobId?.trim()
  if (!id) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 })
  }

  try {
    const result = await db.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "jobId = :jid",
        ExpressionAttributeValues: {
          ":jid": id,
        },
      })
    )

    const items = (result.Items ?? []) as Array<
      Record<string, unknown> & {
        model1Text?: string
        model1Replacements?: Replacement[]
        model2Text?: string
        model2Replacements?: Replacement[]
      }
    >

    const withEval = items.map((it) => {
      const r1 = Array.isArray(it.model1Replacements) ? it.model1Replacements : []
      const r2 = Array.isArray(it.model2Replacements) ? it.model2Replacements : []
      const t1 = typeof it.model1Text === "string" ? it.model1Text : ""
      const t2 = typeof it.model2Text === "string" ? it.model2Text : ""
      const evaluation =
        t1 || t2 || r1.length || r2.length
          ? {
              model1: {
                replacements: summarizeReplacements(r1),
                possibleMisses: t1 ? possibleMisses(t1) : [],
              },
              model2: {
                replacements: summarizeReplacements(r2),
                possibleMisses: t2 ? possibleMisses(t2) : [],
              },
              disagreement: disagreementByOriginal(r1, r2),
            }
          : null

      return { ...it, evaluation }
    })

    return Response.json({ items: withEval })
  } catch (err) {
    console.error("[api/jobs/[jobId]/files]", err)
    return NextResponse.json(
      { error: "Failed to fetch files for job" },
      { status: 500 }
    )
  }
}
