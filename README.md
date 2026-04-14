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

## Lambda
- AI inference runs on **AWS Lambda** to **scale to zero** and keep costs low when idle.
- For larger / heavier models, a dedicated server (often with a GPU) is typically a better fit, but that adds always-on infrastructure cost.

## DynamoDB

Each uploaded file is stored as its own item. Original content and anonymized changes live in the same table.

| Key            | Attribute |
| -------------- | --------- |
| Partition key  | `jobId`   |
| Sort key       | `fileId`  |


## AI

### Original approach (too large for Lambda)

Originally, I wanted to use the Hugging Face model `eternisai/Anonymizer-4B`:

- **Goal**: small language model (SLM) for **semantically similar replacement** of PII (better privacy + readability than simple redaction).
- **Description**: strongest model in the Enchanted anonymizer series; marketed as effectively matching GPT-4.1 while being far smaller.
- **Intended use**:
  - Primary: high-accuracy anonymizer inside Enchanted
  - Secondary: enterprise / research deployments where top-quality anonymization is critical
- **Training details**: based on Qwen3-4B, ~30k samples; SFT → GRPO with GPT-4.1 as judge; reported score 9.55/10.
- **Limitations**: largest model in the series; not suitable for mobile inference (as of Aug 2025); needs MacBook-class hardware for real-time use.

In practice, it was **too large to package and run on AWS Lambda** without moving to a hosted server/GPU setup, so this project uses the current (lighter) approach to **avoid paying for an always-on inference server**.

## Improvements (deferred)

- Job/file **status** values (`uploaded`, `extracted`, `anonymized`, etc.) are not centralized in a single shared definition; skipped to save time.