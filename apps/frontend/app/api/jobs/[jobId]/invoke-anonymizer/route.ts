import { InvokeCommand } from "@aws-sdk/client-lambda"
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { NextResponse } from "next/server"

import { db } from "@/lib/dynamodb"
import { lambdaClient } from "@/lib/lambda"

export const runtime = "nodejs"

const TABLE_NAME = "file-uploads"

type FileItem = {
  fileId?: string
  status?: string
  extractedContent?: string
}

function getFunctionNames(): { model1: string; model2: string } | null {
  const model1 = process.env.ANONYMIZER_LAMBDA_FUNCTION_NAME?.trim() || "arn:aws:lambda:us-east-1:365546889331:function:ai-models-AnonymizerFunction-tOAHw2sJ2YkV"
  const model2 = process.env.MODEL2_LAMBDA_FUNCTION_NAME?.trim() || "arn:aws:lambda:us-east-1:365546889331:function:ai-models-Model2Function-hO1NNOblTw1D"
  if (!model1 || !model2) return null
  return { model1, model2 }
}

function apiGatewayStyleEvent(text: string): Record<string, unknown> {
  return {
    httpMethod: "POST",
    path: "/anonymize",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    isBase64Encoded: false,
  }
}

export async function POST(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params
  const id = jobId?.trim()
  if (!id) return NextResponse.json({ error: "Missing jobId" }, { status: 400 })

  const fns = getFunctionNames()
  if (!fns) {
    return NextResponse.json(
      {
        error: "Model Lambdas are not configured",
        requiredEnv: ["MODEL1_LAMBDA_FUNCTION_NAME", "MODEL2_LAMBDA_FUNCTION_NAME"],
      },
      { status: 501 }
    )
  }

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

  const notExtracted = items.filter((it) => (it.status ?? "").toLowerCase() !== "extracted")
  if (notExtracted.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "All files must have status extracted before running the anonymizer",
        pending: notExtracted.map((it) => ({ fileId: it.fileId, status: it.status })),
      },
      { status: 409 }
    )
  }

  const missingContent = items.filter(
    (it) => typeof it.extractedContent !== "string" || !it.extractedContent.trim()
  )
  if (missingContent.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "All extracted files must have extractedContent",
        pending: missingContent.map((it) => ({ fileId: it.fileId })),
      },
      { status: 409 }
    )
  }

  const results: Array<{
    fileId: string
    ok: boolean
    anonymized_text?: string
    replacements?: unknown
    error?: string
  }> = []

  for (const item of items) {
    const fileId = item.fileId?.trim()
    const text = item.extractedContent?.trim() ?? ""
    if (!fileId) {
      results.push({ fileId: "?", ok: false, error: "Missing fileId" })
      continue
    }

    try {
      const out1 = await lambdaClient.send(
        new InvokeCommand({
          FunctionName: fns.model1,
          InvocationType: "RequestResponse",
          Payload: Buffer.from(JSON.stringify(apiGatewayStyleEvent(text)), "utf-8"),
        })
      )

      if (out1.FunctionError) {
        const errBody = out1.Payload ? new TextDecoder().decode(out1.Payload)
          : ""
        results.push({
          fileId,
          ok: false,
          error: `Model1 error (${out1.FunctionError}): ${errBody.slice(0, 500)}`,
        })
        continue
      }

      const raw1 = out1.Payload ? new TextDecoder().decode(out1.Payload) : "{}"
      const lambdaReturn1 = JSON.parse(raw1) as {
        statusCode?: number
        body?: string
      }

      if (lambdaReturn1.statusCode && lambdaReturn1.statusCode >= 400) {
        results.push({
          fileId,
          ok: false,
          error: `Model1 HTTP ${lambdaReturn1.statusCode}: ${lambdaReturn1.body ?? ""}`.slice(0, 500),
        })
        continue
      }

      const bodyStr1 = lambdaReturn1.body ?? "{}"
      const body1 = JSON.parse(bodyStr1) as {
        ok?: boolean
        anonymized_text?: string
        replacements?: unknown
      }

      const out2 = await lambdaClient.send(
        new InvokeCommand({
          FunctionName: fns.model2,
          InvocationType: "RequestResponse",
          Payload: Buffer.from(JSON.stringify(apiGatewayStyleEvent(text)), "utf-8"),
        })
      )
      if (out2.FunctionError) {
        const errBody = out2.Payload ? new TextDecoder().decode(out2.Payload) : ""
        results.push({
          fileId,
          ok: false,
          error: `Model2 error (${out2.FunctionError}): ${errBody.slice(0, 500)}`,
        })
        continue
      }
      const raw2 = out2.Payload ? new TextDecoder().decode(out2.Payload) : "{}"
      const lambdaReturn2 = JSON.parse(raw2) as { statusCode?: number; body?: string }
      if (lambdaReturn2.statusCode && lambdaReturn2.statusCode >= 400) {
        results.push({
          fileId,
          ok: false,
          error: `Model2 HTTP ${lambdaReturn2.statusCode}: ${lambdaReturn2.body ?? ""}`.slice(0, 500),
        })
        continue
      }
      const bodyStr2 = lambdaReturn2.body ?? "{}"
      const body2 = JSON.parse(bodyStr2) as {
        ok?: boolean
        anonymized_text?: string
        replacements?: unknown
      }

      results.push({
        fileId,
        ok: body1.ok !== false && body2.ok !== false,
        anonymized_text: body1.anonymized_text,
        replacements: body1.replacements,
      })

      if (body1.ok !== false && body2.ok !== false) {
        const safeReplacements1 = Array.isArray(body1.replacements)
          ? body1.replacements.slice(0, 200)
          : []
        const safeReplacements2 = Array.isArray(body2.replacements)
          ? body2.replacements.slice(0, 200)
          : []
        await db.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { jobId: id, fileId },
            UpdateExpression:
              "SET #model1Text = :m1t, #model1Replacements = :m1r, #model1At = :m1a, #model2Text = :m2t, #model2Replacements = :m2r, #model2At = :m2a, #status = :status",
            ExpressionAttributeNames: {
              "#model1Text": "model1Text",
              "#model1Replacements": "model1Replacements",
              "#model1At": "model1At",
              "#model2Text": "model2Text",
              "#model2Replacements": "model2Replacements",
              "#model2At": "model2At",
              "#status": "status",
            },
            ExpressionAttributeValues: {
              ":m1t": body1.anonymized_text ?? "",
              ":m1r": safeReplacements1,
              ":m1a": new Date().toISOString(),
              ":m2t": body2.anonymized_text ?? "",
              ":m2r": safeReplacements2,
              ":m2a": new Date().toISOString(),
              ":status": "anonymized",
            },
          })
        )
      }
    } catch (e) {
      results.push({
        fileId,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const ok = results.every((r) => r.ok)
  return NextResponse.json({ ok, functions: fns, results })
}
