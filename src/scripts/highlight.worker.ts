import { highlightCode } from './highlight-engine'

globalThis.addEventListener('message', async (event: MessageEvent<{ code: string, language: string }>) => {
  try {
    globalThis.postMessage(await highlightCode(event.data.code, event.data.language))
  }
  catch {
    globalThis.postMessage({ language: 'text' })
  }
})
