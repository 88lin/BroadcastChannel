type Prism = typeof import('prismjs')

const aliases: Record<string, string> = {
  'html': 'markup',
  'xml': 'markup',
  'js': 'javascript',
  'ts': 'typescript',
  'py': 'python',
  'yml': 'yaml',
  'sh': 'bash',
  'shell': 'bash',
  'c++': 'cpp',
  'c#': 'csharp',
  'plaintext': 'text',
  'none': 'text',
}

const languageLoaders: Record<string, () => Promise<unknown>> = {
  bash: () => import('prismjs-components-importer/cjs/prism-bash'),
  c: () => import('prismjs-components-importer/cjs/prism-c'),
  clojure: () => import('prismjs-components-importer/cjs/prism-clojure'),
  cpp: () => import('prismjs-components-importer/cjs/prism-cpp'),
  csharp: () => import('prismjs-components-importer/cjs/prism-csharp'),
  css: () => import('prismjs-components-importer/cjs/prism-css'),
  dart: () => import('prismjs-components-importer/cjs/prism-dart'),
  docker: () => import('prismjs-components-importer/cjs/prism-docker'),
  elixir: () => import('prismjs-components-importer/cjs/prism-elixir'),
  go: () => import('prismjs-components-importer/cjs/prism-go'),
  ini: () => import('prismjs-components-importer/cjs/prism-ini'),
  markup: () => import('prismjs-components-importer/cjs/prism-markup'),
  java: () => import('prismjs-components-importer/cjs/prism-java'),
  javascript: () => import('prismjs-components-importer/cjs/prism-javascript'),
  json: () => import('prismjs-components-importer/cjs/prism-json'),
  julia: () => import('prismjs-components-importer/cjs/prism-julia'),
  kotlin: () => import('prismjs-components-importer/cjs/prism-kotlin'),
  lua: () => import('prismjs-components-importer/cjs/prism-lua'),
  markdown: () => import('prismjs-components-importer/cjs/prism-markdown'),
  pascal: () => import('prismjs-components-importer/cjs/prism-pascal'),
  php: () => import('prismjs-components-importer/cjs/prism-php'),
  python: () => import('prismjs-components-importer/cjs/prism-python'),
  ruby: () => import('prismjs-components-importer/cjs/prism-ruby'),
  rust: () => import('prismjs-components-importer/cjs/prism-rust'),
  sql: () => import('prismjs-components-importer/cjs/prism-sql'),
  toml: () => import('prismjs-components-importer/cjs/prism-toml'),
  typescript: () => import('prismjs-components-importer/cjs/prism-typescript'),
  yaml: () => import('prismjs-components-importer/cjs/prism-yaml'),
}

let prismPromise: Promise<Prism> | undefined

function getPrism(): Promise<Prism> {
  if (!prismPromise) {
    // Set these before importing Prism, otherwise its default worker handler parses
    // our structured messages as JSON strings and installs a second message listener.
    Object.assign(globalThis, { Prism: { manual: true, disableWorkerMessageHandler: true } })
    prismPromise = import('prismjs').then(module => module.default)
  }
  return prismPromise
}

export interface HighlightResult {
  language: string
  html?: string
}

export async function highlightCode(code: string, hint = 'auto'): Promise<HighlightResult> {
  let language = hint.toLowerCase()
  language = Object.hasOwn(aliases, language) ? aliases[language] : language
  // Very large snippets remain readable and do not generate an unbounded token DOM.
  if (!code.trim() || code.length > 100_000 || language === 'text')
    return { language: 'text' }
  if (language === 'auto') {
    const { default: flourite } = await import('flourite')
    language = flourite(code, { shiki: true, noUnknown: true }).language?.toLowerCase() || 'text'
    language = Object.hasOwn(aliases, language) ? aliases[language] : language
  }
  if (!Object.hasOwn(languageLoaders, language))
    return { language: 'text' }
  const prism = await getPrism()
  if (!prism.languages[language])
    await languageLoaders[language]()
  const grammar = prism.languages[language]
  return grammar ? { language, html: prism.highlight(code, grammar, language) } : { language: 'text' }
}
