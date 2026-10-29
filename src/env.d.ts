/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

// These browser-only side-effect imports register grammars on the shared Prism instance.
declare module 'prismjs-components-importer/cjs/*' {}

declare namespace App {
  interface Locals {
    SITE_URL: string
    RSS_URL: string
    RSS_PREFIX: string
  }
}

declare module 'sanitize-html' {
  export interface SanitizeHtmlFrame {
    tag: string
    attribs: Record<string, string>
  }

  export interface SanitizeHtmlOptions {
    allowedTags?: string[]
    allowedAttributes?: Record<string, string[]>
    exclusiveFilter?: (frame: SanitizeHtmlFrame) => boolean
  }

  interface SanitizeHtml {
    (dirty: string, options?: SanitizeHtmlOptions): string
    defaults: {
      allowedTags: string[]
      allowedAttributes: Record<string, string[]>
    }
  }

  const sanitizeHtml: SanitizeHtml

  export default sanitizeHtml
}
