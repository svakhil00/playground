"use client"

import * as React from "react"

import { Clipboard, Check } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

export function JobIdCopy({ jobId }: { jobId: string }) {
  const [copied, setCopied] = React.useState(false)

  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      className="h-9 w-9"
      onClick={() => {
        void navigator.clipboard.writeText(jobId)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      }}
      title={copied ? "Copied" : "Copy job ID"}
      aria-label={copied ? "Copied job ID" : "Copy job ID"}
    >
      {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
    </Button>
  )
}

