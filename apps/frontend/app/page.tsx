import { S3FileUpload } from "@/components/s3-file-upload"
import { JobIdRedirect } from "@/components/jobid-redirect"
import { ThemeToggle } from "@/components/theme-toggle"

const EXAMPLE_JOB_ID = "c1f86653-520c-44be-a831-77aa47166893"

export default function Page() {
  return (
    <div className="relative flex min-h-svh flex-col bg-background text-foreground">
      <div className="absolute top-6 right-6 z-10">
        <ThemeToggle />
      </div>
      <header className="px-6 pt-12 pb-10 sm:pt-14 sm:pb-12">
        <h1 className="text-center text-4xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl md:text-6xl">
          Anonymizer
        </h1>
      </header>
      <main className="flex flex-1 flex-row items-start justify-center px-6 pb-16">
        <div className="w-full max-w-5xl">
          <S3FileUpload />
          <JobIdRedirect />
          <div className="mt-6 flex items-center justify-center">
            <a
              href={`/anonymize/${EXAMPLE_JOB_ID}`}
              className="text-sm font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              View example dataset
            </a>
          </div>
        </div>
      </main>
    </div>
  )
}
