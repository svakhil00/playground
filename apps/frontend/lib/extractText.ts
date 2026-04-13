import { promisify } from "node:util"

import rtfParser from "rtf-parser"

const parseRtfString = promisify(rtfParser.string)

type RtfDoc = { content?: unknown[]; value?: string }

function walkRtf(node: unknown, out: string[]): void {
  if (node == null) return
  if (typeof node === "string") {
    out.push(node)
    return
  }
  if (typeof node === "object") {
    const o = node as { value?: unknown; content?: unknown[] }
    if (typeof o.value === "string") out.push(o.value)
    if (Array.isArray(o.content)) for (const c of o.content) walkRtf(c, out)
  }
}

function isProbablyRtf(raw: string, fileName: string): boolean {
  const lower = fileName.toLowerCase()
  if (lower.endsWith(".rtf")) return true
  const start = raw.trimStart()
  return start.startsWith("{\\rtf")
}

/**
 * Raw S3 bytes as UTF-8 string → plain text for storage.
 * `.rtf` files are parsed; `.txt` and unknown types are returned as-is (BOM stripped).
 */
export async function extractPlainTextFromUpload(
  rawUtf8: string,
  fileName: string
): Promise<string> {
  let text = rawUtf8
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  if (!isProbablyRtf(rawUtf8, fileName)) {
    return text
  }

  try {
    const doc = (await parseRtfString(rawUtf8)) as RtfDoc
    const parts: string[] = []
    walkRtf(doc, parts)
    const plain = parts.join("").replace(/\u00a0/g, " ")
    return plain.trim() || text
  } catch {
    return text
  }
}
