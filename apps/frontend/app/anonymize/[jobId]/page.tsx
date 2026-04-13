import Link from "next/link"

import { JobFilesPoller } from "@/components/job-files-poller"

type Props = { params: Promise<{ jobId: string }> }

export default async function AnonymizeJobPage({ params }: Props) {
  const { jobId } = await params

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background px-6 py-16 text-foreground">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <div className="w-full space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Job started</h1>
          <p className="text-sm text-muted-foreground">
            Your anonymization job has been created. Save this ID to check status
            later.
          </p>
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 font-mono text-sm break-all">
            {jobId}
          </p>
          <Link
            href="/"
            className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Back to home
          </Link>
        </div>

        <JobFilesPoller jobId={jobId} />
      </div>
    </div>
  )
}
