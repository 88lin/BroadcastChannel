import type { AstroEnvContext } from '../types'
import { getStringEnv, parseCsvList } from './env'

export class InvalidChannelError extends Error {}

export function getConfiguredChannels(context: AstroEnvContext): string[] {
  return parseCsvList(getStringEnv(import.meta.env, context, 'CHANNEL'))
}

export function resolveSelectedChannel(channels: string[], value?: string | null): string {
  if (!value?.trim())
    return ''
  const selected = channels.find(channel => channel.toLowerCase() === value.trim().toLowerCase())
  if (!selected)
    throw new InvalidChannelError('Unknown channel')
  return selected
}

export function getSelectedChannel(context: AstroEnvContext): string {
  const url = context.url ?? (context.request ? new URL(context.request.url) : undefined)
  if (!url?.searchParams.has('channel'))
    return ''
  if (url.searchParams.getAll('channel').length !== 1)
    throw new InvalidChannelError('Select one channel at a time')
  return resolveSelectedChannel(getConfiguredChannels(context), url.searchParams.get('channel'))
}

/** Keep the selection in navigable URLs without changing stable post IDs. */
export function withChannel(path: string, channel: string): string {
  const url = new URL(path, 'https://broadcast.invalid')
  if (channel)
    url.searchParams.set('channel', channel)
  else
    url.searchParams.delete('channel')
  return /^https?:\/\//.test(path) ? url.toString() : `${url.pathname}${url.search}${url.hash}`
}

export function getPostChannel(id: string, channels: string[]): string {
  return channels.find(channel => id.startsWith(`${channel}-`)) ?? channels[0] ?? ''
}
