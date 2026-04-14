# Anonymizer

## Frontend

- Deployed as **SSR** and **SSG** on **Lambda@Edge** behind **CloudFront** (CDN) to reduce latency.
- **shadcn/ui** is the base for components.
- Components are wired to various **AWS** services.

## Backend

- **Next.js** API routes and server logic, hosted on **AWS Lambda** for independent scaling and minimal cost when idle.
- Enforcing upload **size limits**, strict **type checks**, and similar **safety validation** (including scanning) was **out of scope** for this version.

## S3

- Files are uploaded to **S3** before processing.

## DynamoDB

Each uploaded file is stored as its own item. Original content and anonymized changes live in the same table.

| Key            | Attribute |
| -------------- | --------- |
| Partition key  | `jobId`   |
| Sort key       | `fileId`  |

## Improvements (deferred)

- Job/file **status** values (`uploaded`, `extracted`, `anonymized`, etc.) are not centralized in a single shared definition; skipped to save time.