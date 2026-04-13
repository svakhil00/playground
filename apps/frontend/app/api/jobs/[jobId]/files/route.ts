import { QueryCommand } from "@aws-sdk/lib-dynamodb"
import { NextResponse } from "next/server"

import { db } from "@/lib/dynamodb"

export const runtime = "nodejs"

const TABLE_NAME = "file-uploads"

type RouteContext = { params: Promise<{ jobId: string }> }

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

    return Response.json({ items: result.Items ?? [] })
  } catch (err) {
    console.error("[api/jobs/[jobId]/files]", err)
    return NextResponse.json(
      { error: "Failed to fetch files for job" },
      { status: 500 }
    )
  }
}
