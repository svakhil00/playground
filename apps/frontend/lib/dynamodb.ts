import { DynamoDBClient, type DynamoDBClientConfig } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"

const region =
  process.env.AWS_REGION?.trim() ||
  process.env.S3_REGION?.trim() ||
  "us-east-1"

function clientConfig(): DynamoDBClientConfig {
  const config: DynamoDBClientConfig = { region }
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

const client = new DynamoDBClient(clientConfig())

export const db = DynamoDBDocumentClient.from(client)
