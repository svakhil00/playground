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

  const key = process.env.AWS_ACCESS_KEY_ID
  const secret = process.env.AWS_SECRET_ACCESS_KEY
  if (key && secret) {
    config.credentials = {
      accessKeyId: key,
      secretAccessKey: secret,
      ...(process.env.AWS_SESSION_TOKEN
        ? { sessionToken: process.env.AWS_SESSION_TOKEN }
        : {}),
    }
  }

  return config
}

export async function GET() {
  const bucket = process.env.S3_BUCKET_NAME
  const region = process.env.AWS_REGION
  if (!bucket || !region) {
    return NextResponse.json(
      { error: "Missing S3_BUCKET_NAME or AWS_REGION" },
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
        "[api/upload-url] Presigned URL still contains checksum params. Set AWS_REQUEST_CHECKSUM_CALCULATION=when_required in the deployment environment."
      )
    }

    return Response.json({ url, key })
  } catch (err) {
    console.error("[api/upload-url]", err)
    return NextResponse.json({ error: "Could not create upload URL" }, { status: 502 })
  }
}
