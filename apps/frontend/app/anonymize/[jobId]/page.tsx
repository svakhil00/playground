import Link from "next/link"

import { JobFilesPoller } from "@/components/job-files-poller"
import { JobIdCopy } from "@/components/job-id-copy"
import { ThemeToggle } from "@/components/theme-toggle"

type Props = { params: Promise<{ jobId: string }> }

export default async function AnonymizeJobPage({ params }: Props) {
  const { jobId } = await params

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-start gap-6 bg-background px-3 py-6 text-foreground sm:px-4 sm:py-8">
      <div className="absolute top-6 left-6 z-10">
        <Link
          href="/"
          className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Back to home
        </Link>
      </div>
      <div className="absolute top-6 right-6 z-10">
        <ThemeToggle />
      </div>
      <div className="flex w-full max-w-6xl flex-col items-center gap-4">
        <div className="w-full space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Job started</h1>
          <p className="text-sm text-muted-foreground">
            Your anonymization job has been created. Save this ID to check status
            later.
          </p>
          <div className="flex items-center justify-center gap-2">
            <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 font-mono text-sm break-all">
              {jobId}
            </p>
            <JobIdCopy jobId={jobId} />
          </div>
        </div>

        <JobFilesPoller jobId={jobId} />
      </div>
    </div>
  )
}
