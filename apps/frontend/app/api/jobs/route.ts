export const runtime = "nodejs"

export async function POST() {
  const jobId = crypto.randomUUID()
  return Response.json({ jobId })
}
