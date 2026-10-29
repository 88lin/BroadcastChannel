import type { GetChannelInfoParams } from '../../types'
import type { LoadedChannelDocument, RequestContext } from './types'
import * as cheerio from 'cheerio'
import { $fetch } from 'ofetch'
import { getBooleanEnv, getEnv, getStaticProxy, getTelegramHost } from '../env'

interface TelegramRequestOptions {
  timeout?: number
  retry?: number
}

interface TelegramHtmlParams extends TelegramRequestOptions {
  host: string
  channel: string
  id?: string
  before?: string
  after?: string
  q?: string
  headers: Record<string, string>
}

interface LoadChannelDocumentParams extends GetChannelInfoParams, TelegramRequestOptions {
  channel?: string
  id?: string
}

function getRequiredEnv(context: RequestContext, name: string): string {
  const value = getEnv(import.meta.env, context, name)
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required env: ${name}`)
  }
  return value
}

export function getTelegramRequestHeaders(): Record<string, string> {
  return {
    'accept': 'text/html,application/xhtml+xml',
    'user-agent': 'BroadcastChannel/0.2.0',
  }
}

async function fetchTelegramHtml({ host, channel, id, before, after, q, headers, timeout = 15000, retry = 3 }: TelegramHtmlParams): Promise<string> {
  const requestUrl = id
    ? `https://${host}/${channel}/${id}?embed=1&mode=tme`
    : `https://${host}/s/${channel}`

  return await $fetch<string, 'text'>(requestUrl, {
    headers,
    query: {
      before: before || undefined,
      after: after || undefined,
      q: q || undefined,
    },
    responseType: 'text',
    timeout,
    retry,
    retryDelay: 100,
  })
}

const pendingHtml = new Map<string, Promise<string>>()

function loadTelegramHtml(params: TelegramHtmlParams): Promise<string> {
  const { host, channel, id = '', before = '', after = '', q = '', timeout = 15000, retry = 3 } = params
  // Retain only active fetches. Parsed results, rather than duplicate raw HTML, are cached.
  // Short metadata requests must not join a slower content request (or vice versa).
  const key = JSON.stringify({ host, channel, id, before, after, q, timeout, retry })
  const pending = pendingHtml.get(key)
  if (pending)
    return pending
  const request = fetchTelegramHtml(params).finally(() => {
    pendingHtml.delete(key)
  })
  pendingHtml.set(key, request)
  return request
}

export async function loadChannelDocument(
  context: RequestContext,
  params: LoadChannelDocumentParams = {},
): Promise<LoadedChannelDocument> {
  const { before, after, q, id, timeout, retry } = params
  const host = getTelegramHost(import.meta.env, context)
  const channel = params.channel ?? getRequiredEnv(context, 'CHANNEL')
  const staticProxy = getStaticProxy(import.meta.env, context)
  const reactionsEnabled = getBooleanEnv(import.meta.env, context, 'REACTIONS')
  const html = await loadTelegramHtml({
    host,
    channel,
    id,
    before,
    after,
    q,
    timeout,
    retry,
    headers: getTelegramRequestHeaders(),
  })

  return {
    // Telegram supplies HTML fragments; htmlparser2 avoids parse5's browser tree repair.
    $: cheerio.load(html, { xml: { xmlMode: false } }, false),
    channel,
    telegramHost: host,
    staticProxy,
    reactionsEnabled,
  }
}
