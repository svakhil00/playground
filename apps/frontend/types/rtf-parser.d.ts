declare module "rtf-parser" {
  interface RtfDocument {
    content?: unknown[]
    value?: string
  }

  interface Parse {
    (cb: (err: Error | null, doc: RtfDocument) => void): NodeJS.WritableStream
    string: (rtf: string, cb: (err: Error | null, doc: RtfDocument) => void) => void
    stream: (
      stream: NodeJS.ReadableStream,
      cb: (err: Error | null, doc: RtfDocument) => void
    ) => NodeJS.WritableStream
  }

  const parse: Parse
  export = parse
}
