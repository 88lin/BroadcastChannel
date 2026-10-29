import type { HighlightResult } from './highlight-engine'

const seen = new WeakSet<HTMLElement>()
const queue: HTMLElement[] = []
let worker: Worker | undefined
let active: HTMLElement | undefined
let timeout: ReturnType<typeof setTimeout> | undefined

function finish(result: HighlightResult) {
  clearTimeout(timeout)
  if (active?.isConnected) {
    if (result.html !== undefined) {
      // The worker receives textContent only; Prism escapes that text before adding
      // its own token spans. Never send upstream HTML to the highlighting engine.
      active.innerHTML = result.html
      active.className = `language-${result.language}`
    }
    active.dataset.highlighted = result.html === undefined ? 'plain' : 'true'
  }
  active = undefined
  pump()
}

function pump() {
  if (active)
    return
  active = queue.shift()
  if (!active)
    return
  if (!active.isConnected) {
    active = undefined
    pump()
    return
  }
  try {
    if (!worker) {
      worker = new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<HighlightResult>) => finish(event.data)
      worker.onerror = (event) => {
        event.preventDefault()
        worker?.terminate()
        worker = undefined
        finish({ language: 'text' })
      }
    }
    const language = active.className.match(/\blanguage-([\w+#-]+)/i)?.[1] ?? 'auto'
    worker.postMessage({ code: active.textContent ?? '', language })
    timeout = setTimeout(() => {
      worker?.terminate()
      worker = undefined
      finish({ language: 'text' })
    }, 10_000)
  }
  catch {
    finish({ language: 'text' })
  }
}

const observer = typeof IntersectionObserver === 'undefined'
  ? undefined
  : new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          observer?.unobserve(entry.target)
          queue.push(entry.target as HTMLElement)
        }
      }
      pump()
    }, { rootMargin: '200px' })

function observeCode() {
  for (const code of document.querySelectorAll<HTMLElement>('.content pre > code')) {
    if (seen.has(code) || code.dataset.highlighted)
      continue
    seen.add(code)
    if (observer)
      observer.observe(code)
    else
      queue.push(code)
  }
  pump()
}

observeCode()
document.addEventListener('astro:page-load', observeCode)
