# Anonymizer

## Frontend

- Deployed as **SSR** and **SSG** on **Lambda@Edge** behind **CloudFront** (CDN) to reduce latency.
- **shadcn/ui** is the base for components.
- Components are wired to various **AWS** services.

pages

- homepage: can upload documents to anonymize
- job page: anonymization jobs

## Project workflow

This project was built incrementally (often in small time windows), but the end-to-end flow was planned up-front around a “job” abstraction.

1. **Upload**
  - User uploads a document from the homepage (currently targeted at `.txt`; expandable).
  - A `jobId` is created.
  - File metadata is written to DynamoDB and the raw file is uploaded to S3.
2. **Process**
  - The app redirects to the job page (`/anonymize/:jobId`) which shows job status/results.
  - The backend extracts plain text (including RTF → text support where applicable) and updates DynamoDB.
  - Two separate Lambda functions (“Model 1” and “Model 2”) anonymize the extracted text and store:
    - the anonymized text
    - the replacement pairs (what changed)
    - timestamps/status
3. **Review**
  - The job page polls for updates and, once ready, shows both model outputs side-by-side.
  - Review UI lets you inspect what changed and iteratively adjust replacements (e.g. override a token) while comparing models.
4. **Return later**
  - Because results are keyed by `jobId`, users can return later (even after closing the app) to review the same job.

### Notes / trade-offs (from development)

- **Working style**: built in fragments when time allowed, prioritizing a functional end-to-end workflow first.
- **Scaling choice**: anonymization runs on Lambdas so the “model runners” can scale independently while the webapp stays lightweight.
- **Auth**: authentication was intentionally out of scope for this version.
- **UI polish**: current UI focuses on functionality and reviewer flow first; polish can come after the interaction model is solid.
- **File types**: the happy path is `.txt` today; expanding file support is a straightforward next step.
- **Model choice shortcut**: the original plan was to use `eternisai/Anonymizer-4B` (high-quality semantic replacement), but it was too heavy for Lambda. The current approach uses lighter inference to avoid paying for an always-on server.

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


| Key           | Attribute |
| ------------- | --------- |
| Partition key | `jobId`   |
| Sort key      | `fileId`  |


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
- **Export/download**: download anonymized outputs (per model and/or final reviewed text) as `.txt` (and later, original file format where possible).

