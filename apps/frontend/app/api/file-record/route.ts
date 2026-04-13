import { PutCommand } from "@aws-sdk/lib-dynamodb"
import { NextResponse } from "next/server"

import { db } from "@/lib/dynamodb"

export const runtime = "nodejs"

const TABLE_NAME = "file-uploads"

function sanitizeOriginalFileName(name: string): string {
  return name.replace(/^.*[/\\]/, "").replace(/\0/g, "").trim().slice(0, 255)
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 })
  }

  const { jobId, fileId, fileUrl, fileName } = body as Record<string, unknown>

  if (typeof jobId !== "string" || !jobId.trim()) {
    return NextResponse.json(
      { error: "Missing or invalid jobId" },
      { status: 400 }
    )
  }
  if (typeof fileId !== "string" || !fileId.trim()) {
    return NextResponse.json(
      { error: "Missing or invalid fileId" },
      { status: 400 }
    )
  }
  if (typeof fileName !== "string" || !fileName.trim()) {
    return NextResponse.json(
      { error: "Missing or invalid fileName" },
      { status: 400 }
    )
  }

  const safeFileName = sanitizeOriginalFileName(fileName)
  if (!safeFileName) {
    return NextResponse.json(
      { error: "Invalid fileName after sanitization" },
      { status: 400 }
    )
  }

  try {
    await db.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          jobId: jobId.trim(),
          fileId: fileId.trim(),
          fileName: safeFileName,
          fileUrl:
            typeof fileUrl === "string" && fileUrl.trim() ? fileUrl.trim() : "",
          status: "uploaded",
          createdAt: new Date().toISOString(),
        },
      })
    )

    return Response.json({ success: true })
  } catch (err) {
    console.error("[api/file-record]", err)
    return NextResponse.json({ error: "Failed to create item" }, { status: 500 })
  }
}
