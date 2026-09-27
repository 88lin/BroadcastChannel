export interface TimelineCursorPayload {
  v: 2
  channel?: string
  sources?: TimelineSourceCursor[]
  history?: TimelineSourceCursor[][]
}

type CompactTimelineSourceCursor = [string, number]

interface CompactTimelineCursorPayload {
  v: 2
  c?: string
  s: CompactTimelineSourceCursor[]
  h: CompactTimelineSourceCursor[][]
}

export interface TimelineSourceCursor {
  before: string
  offset: number
}

const MAX_CURSOR_LENGTH = 2048
const MAX_LEGACY_CURSOR_LENGTH = 8192
const MAX_HISTORY_ENTRIES = 8
const MAX_SOURCE_OFFSET = 1000
const SOURCE_ID_REGEX = /^\d{1,20}$/

export class InvalidTimelineCursorError extends Error {}
export class TimelineCursorBudgetError extends RangeError {}

export function isRecoverableTimelineCursorError(error: unknown): boolean {
  return error instanceof InvalidTimelineCursorError || error instanceof TimelineCursorBudgetError
}

const PERCENT_ESCAPE_REGEX = /%([0-9A-F]{2})/g
const BASE64_PLUS_REGEX = /\+/g
const BASE64_SLASH_REGEX = /\//g
const BASE64_PADDING_REGEX = /=+$/g
const BASE64URL_DASH_REGEX = /-/g
const BASE64URL_UNDERSCORE_REGEX = /_/g

function toCompactTimelineSourceCursor(source: TimelineSourceCursor): CompactTimelineSourceCursor {
  return [source.before, source.offset]
}

function fromCompactTimelineSourceCursor(source: CompactTimelineSourceCursor): TimelineSourceCursor {
  return {
    before: source[0],
    offset: source[1],
  }
}

function toBase64Url(value: string): string {
  const encoded = encodeURIComponent(value).replace(PERCENT_ESCAPE_REGEX, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
  return btoa(encoded)
    .replace(BASE64_PLUS_REGEX, '-')
    .replace(BASE64_SLASH_REGEX, '_')
    .replace(BASE64_PADDING_REGEX, '')
}

function fromBase64Url(value: string): string {
  const normalized = value
    .replace(BASE64URL_DASH_REGEX, '+')
    .replace(BASE64URL_UNDERSCORE_REGEX, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')

  const decoded = atob(normalized)
  const bytes = decoded.split('').map(char => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')
  return decodeURIComponent(bytes)
}

function isValidSourceCursor(source: unknown): source is CompactTimelineSourceCursor {
  return Array.isArray(source)
    && source.length === 2
    && typeof source[0] === 'string'
    && (source[0] === '' || SOURCE_ID_REGEX.test(source[0]))
    && Number.isSafeInteger(source[1])
    && source[1] <= MAX_SOURCE_OFFSET
    && source[1] >= 0
}

function validateCompactPayload(value: unknown): asserts value is CompactTimelineCursorPayload {
  const payload = value as Partial<CompactTimelineCursorPayload> | null
  if (payload?.v !== 2) {
    throw new TypeError('Unsupported timeline cursor version')
  }
  if (payload.c !== undefined && (typeof payload.c !== 'string' || !/^\w{1,64}$/.test(payload.c))) {
    throw new TypeError('Invalid timeline channel scope')
  }
  if (!Array.isArray(payload.s) || !payload.s.length) {
    throw new TypeError('Invalid timeline sources payload')
  }
  if (!Array.isArray(payload.h)) {
    throw new TypeError('Invalid timeline history payload')
  }
  // Iteration also rejects sparse arrays, which JSON would otherwise serialize as null entries.
  for (const source of payload.s) {
    if (!isValidSourceCursor(source)) {
      throw new TypeError('Invalid timeline source shape')
    }
  }
  for (const entry of payload.h) {
    if (!Array.isArray(entry) || entry.length !== payload.s.length) {
      throw new TypeError('Invalid timeline history source count')
    }
    for (const source of entry) {
      if (!isValidSourceCursor(source)) {
        throw new TypeError('Invalid timeline history entry')
      }
    }
  }
}

export function encodeTimelineCursor(payload: TimelineCursorPayload): string {
  const compactPayload = {
    v: payload.v,
    c: payload.channel,
    s: payload.sources?.map(toCompactTimelineSourceCursor),
    h: (payload.history ?? []).slice(-MAX_HISTORY_ENTRIES).map(entry => entry.map(toCompactTimelineSourceCursor)),
  }
  validateCompactPayload(compactPayload)

  let encoded = toBase64Url(JSON.stringify(compactPayload))
  while (encoded.length > MAX_CURSOR_LENGTH && compactPayload.h.length) {
    compactPayload.h.shift()
    encoded = toBase64Url(JSON.stringify(compactPayload))
  }
  if (encoded.length > MAX_CURSOR_LENGTH) {
    throw new TimelineCursorBudgetError('Timeline source state exceeds the URL budget')
  }
  return encoded
}

export function decodeTimelineCursor(cursor: string): TimelineCursorPayload {
  try {
    if (cursor.length > MAX_LEGACY_CURSOR_LENGTH) {
      throw new Error('Timeline cursor is too long')
    }
    const payload: unknown = JSON.parse(fromBase64Url(cursor))
    validateCompactPayload(payload)

    return {
      v: 2,
      ...(payload.c ? { channel: payload.c } : {}),
      sources: payload.s.map(fromCompactTimelineSourceCursor),
      history: payload.h.slice(-MAX_HISTORY_ENTRIES).map(entry => entry.map(fromCompactTimelineSourceCursor)),
    }
  }
  catch (error) {
    throw new InvalidTimelineCursorError(`Invalid timeline cursor: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

export function isRootTimelineCursor(cursor: string, selectedChannel = ''): boolean {
  const payload = decodeTimelineCursor(cursor)
  if ((payload.channel ?? '') !== selectedChannel) {
    throw new InvalidTimelineCursorError('Timeline cursor belongs to a different channel selection')
  }
  if (!selectedChannel)
    return payload.sources!.every(source => source.before === '' && source.offset === 0)
  return payload.sources!.filter(source => source.before === '').length === 1
    && payload.sources!.every(source => (source.before === '' || source.before === '0') && source.offset === 0)
}
