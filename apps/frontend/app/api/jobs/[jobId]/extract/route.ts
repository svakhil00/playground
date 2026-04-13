import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { NextResponse } from "next/server"

import { db } from "@/lib/dynamodb"
import { extractPlainTextFromUpload } from "@/lib/extractText"

export const runtime = "nodejs"

const TABLE_NAME = "file-uploads"

/** DynamoDB item max is 400 KB; leave margin for other attributes. */
const MAX_EXTRACTED_BYTES = 350_000

function parseS3Url(s3Url: string): { bucket: string; key: string } | null {
  const trimmed = s3Url.trim()
  if (!trimmed.startsWith("s3://")) return null
  const rest = trimmed.slice("s3://".length)
  const slash = rest.indexOf("/")
  if (slash <= 0) return null
  const bucket = rest.slice(0, slash)
  const key = rest.slice(slash + 1)
  if (!bucket || !key) return null
  return { bucket, key }
}

async function streamToString(body: unknown): Promise<string> {
  if (!body || typeof body !== "object" || !("on" in body)) {
    throw new Error("Unexpected S3 body type")
  }
  const readable = body as NodeJS.ReadableStream
  const chunks: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    readable.on("data", (chunk) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    )
    readable.on("error", reject)
    readable.on("end", resolve)
  })
  return Buffer.concat(chunks).toString("utf-8")
}

function getAwsRegion(): string {
  return (
    process.env.AWS_REGION?.trim() ||
    process.env.S3_REGION?.trim() ||
    process.env.NEXT_PUBLIC_S3_REGION?.trim() ||
    "us-east-1"
  )
}

type FileItem = {
  jobId?: string
  fileId?: string
  fileName?: string
  fileUrl?: string
  status?: string
}

export async function POST(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params
  const id = jobId?.trim()
  if (!id) return NextResponse.json({ error: "Missing jobId" }, { status: 400 })

  const region = getAwsRegion()
  const s3 = new S3Client({ region })

  const result = await db.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "jobId = :jid",
      ExpressionAttributeValues: { ":jid": id },
    })
  )

  const items = (result.Items ?? []) as FileItem[]
  if (items.length === 0) {
    return NextResponse.json({ ok: false, error: "No files found for jobId" }, { status: 404 })
  }

  const notUploaded = items.filter((it) => (it.status ?? "").toLowerCase() !== "uploaded")
  if (notUploaded.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "Not all files are uploaded yet",
        pending: notUploaded.map((it) => ({ fileId: it.fileId, status: it.status })),
      },
      { status: 409 }
    )
  }

  let extracted = 0
  const errors: Array<{ fileId?: string; error: string }> = []

  for (const item of items) {
    try {
      const fileId = item.fileId?.trim()
      if (!fileId) throw new Error("Missing fileId in record")
      const url = item.fileUrl?.trim()
      if (!url) throw new Error("Missing fileUrl in record")
      const loc = parseS3Url(url)
      if (!loc) throw new Error("fileUrl is not a valid s3://bucket/key URL")

      const obj = await s3.send(new GetObjectCommand({ Bucket: loc.bucket, Key: loc.key }))
      const raw = await streamToString(obj.Body)
      const extractedText = await extractPlainTextFromUpload(raw, item.fileName ?? "")
      const bytes = Buffer.byteLength(extractedText, "utf8")
      if (bytes > MAX_EXTRACTED_BYTES) {
        throw new Error(
          `Extracted text too large for a single DynamoDB item (${bytes} bytes; max ~${MAX_EXTRACTED_BYTES})`
        )
      }

      const extractedAt = new Date().toISOString()
      await db.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { jobId: id, fileId },
          UpdateExpression:
            "SET #extractedContent = :extractedContent, #extractedAt = :extractedAt, #status = :status REMOVE #content, #ingestedAt, #ingestStatus",
          ExpressionAttributeNames: {
            "#extractedContent": "extractedContent",
            "#extractedAt": "extractedAt",
            "#status": "status",
            "#content": "content",
            "#ingestedAt": "ingestedAt",
            "#ingestStatus": "ingestStatus",
          },
          ExpressionAttributeValues: {
            ":extractedContent": extractedText,
            ":extractedAt": extractedAt,
            ":status": "extracted",
          },
        })
      )
      extracted += 1
    } catch (e) {
      errors.push({
        fileId: item.fileId,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const ok = errors.length === 0
  return NextResponse.json({
    ok,
    destination: "dynamodb",
    table: TABLE_NAME,
    extracted,
    total: items.length,
    errors,
  })
}
