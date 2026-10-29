import type { Reaction } from '../types'
import { LRUCache } from 'lru-cache'

const weekInMs = 7 * 24 * 60 * 60 * 1000
const locales = new LRUCache<string, string>({ max: 16 })
const relativeFormatters = new LRUCache<string, Intl.RelativeTimeFormat>({ max: 16 })
const absoluteFormatters = new LRUCache<string, Intl.DateTimeFormat[]>({ max: 16 })

function resolveLocale(locale = 'en'): string {
  const cached = locales.get(locale)
  if (cached)
    return cached
  let resolved = 'en'
  try {
    resolved = Intl.DateTimeFormat.supportedLocalesOf(locale)[0] ?? 'en'
  }
  catch {}
  locales.set(locale, resolved)
  return resolved
}

function roundRelativeTime(diffInMs: number, unitInMs: number): number {
  return Math.sign(diffInMs) * Math.round(Math.abs(diffInMs) / unitInMs)
}

function formatRelativeTime(date: Date, locale: string): string {
  const diffInMs = date.getTime() - Date.now()
  const absoluteDiffInMs = Math.abs(diffInMs)
  let formatter = relativeFormatters.get(locale)
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'always' })
    relativeFormatters.set(locale, formatter)
  }

  if (absoluteDiffInMs < 60 * 1000) {
    return formatter.format(roundRelativeTime(diffInMs, 1000), 'second')
  }

  if (absoluteDiffInMs < 60 * 60 * 1000) {
    return formatter.format(roundRelativeTime(diffInMs, 60 * 1000), 'minute')
  }

  if (absoluteDiffInMs < 24 * 60 * 60 * 1000) {
    return formatter.format(roundRelativeTime(diffInMs, 60 * 60 * 1000), 'hour')
  }

  return formatter.format(roundRelativeTime(diffInMs, 24 * 60 * 60 * 1000), 'day')
}

function formatAbsoluteTime(date: Date, timezone: string | undefined, locale: string): string {
  const key = `${locale}:${timezone ?? ''}`
  let formatters = absoluteFormatters.get(key)
  if (!formatters) {
    formatters = [
      new Intl.DateTimeFormat(locale, { hour: '2-digit', hourCycle: 'h23', minute: '2-digit', timeZone: timezone }),
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: timezone }),
      new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: 'short' }),
    ]
    absoluteFormatters.set(key, formatters)
  }
  const [time, dateText, weekday] = formatters.map(formatter => formatter.format(date))

  return `${time} · ${dateText} · ${weekday}`
}

export function formatPostTime(datetime: string, timezone?: string, locale?: string): string {
  const resolvedLocale = resolveLocale(locale)
  const postTime = new Date(datetime)
  const isOlderThanWeek = postTime.getTime() < Date.now() - weekInMs

  return isOlderThanWeek
    ? formatAbsoluteTime(postTime, timezone, resolvedLocale)
    : formatRelativeTime(postTime, resolvedLocale)
}

export function getTagHref(tag: string): string {
  return `/search/result?q=${encodeURIComponent(`#${tag}`)}`
}

export function getReactionLabel(reaction: Reaction): string {
  const reactionName = reaction.isPaid ? 'Paid reaction' : `${reaction.emoji || 'Custom emoji'} reaction`

  return `${reactionName}, count ${reaction.count}`
}
