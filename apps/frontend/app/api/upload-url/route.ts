import { PutObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

function s3ClientConfig(region: string): S3ClientConfig {
  const config: S3ClientConfig = {
    region,
    // WHEN_SUPPORTED adds CRC32 to presigned PutObject URLs; browsers don't send
    // matching checksums → S3 returns 403.
    requestChecksumCalculation: "WHEN_REQUIRED",
  }

  // Amplify reserves the AWS_* prefix for env vars; use S3_* in hosting and
  // keep AWS_* as fallback for local ~/.aws / .env.local.
  const accessKeyId =
    process.env.S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey =
    process.env.S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY
  if (accessKeyId && secretAccessKey) {
    config.credentials = {
      accessKeyId,
      secretAccessKey,
      ...((process.env.S3_SESSION_TOKEN ?? process.env.AWS_SESSION_TOKEN)
        ? {
            sessionToken:
              process.env.S3_SESSION_TOKEN ?? process.env.AWS_SESSION_TOKEN,
          }
        : {}),
    }
  }

  return config
}

export async function GET() {
  const bucket = process.env.S3_BUCKET_NAME
  const region = process.env.S3_REGION ?? process.env.AWS_REGION
  if (!bucket || !region) {
    return NextResponse.json(
      { error: "Missing S3_BUCKET_NAME or S3_REGION (or AWS_REGION for local)" },
      { status: 500 }
    )
  }

  const prefix = (process.env.S3_UPLOAD_PREFIX ?? "uploads").replace(/^\/+|\/+$/g, "")
  const key = `${prefix}/${Date.now()}-${crypto.randomUUID()}`

  const s3 = new S3Client(s3ClientConfig(region))

  try {
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: 60 }
    )

    if (
      url.includes("x-amz-checksum-") ||
      url.includes("x-amz-sdk-checksum-algorithm")
    ) {
      console.error(
        "[api/upload-url] Presigned URL still contains checksum params (SDK default checksum mode)."
      )
    }

    return Response.json({ url, key })
  } catch (err) {
    console.error("[api/upload-url]", err)
    return NextResponse.json({ error: "Could not create upload URL" }, { status: 502 })
  }
}
