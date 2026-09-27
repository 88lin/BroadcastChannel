import { describe, expect, it } from 'vitest'
import { decodeTimelineCursor, encodeTimelineCursor, InvalidTimelineCursorError, isRecoverableTimelineCursorError, isRootTimelineCursor, TimelineCursorBudgetError } from './timeline-cursor'

const source = { before: '123', offset: 4 }
const root = { before: '', offset: 0 }
const rawCursor = (payload: unknown) => btoa(JSON.stringify(payload))

describe('timeline cursors', () => {
  it('preserves and checks the selected channel in scoped back links', () => {
    const payload = { v: 2 as const, channel: 'beta', sources: [{ before: '0', offset: 0 }, root], history: [] }
    const encoded = encodeTimelineCursor(payload)
    expect(decodeTimelineCursor(encoded)).toEqual(payload)
    expect(isRootTimelineCursor(encoded, 'beta')).toBe(true)
    expect(() => isRootTimelineCursor(encoded, 'alpha')).toThrow(InvalidTimelineCursorError)
    expect(() => isRootTimelineCursor(encoded)).toThrow(InvalidTimelineCursorError)
  })

  it.each(['', '../beta', 'alpha,beta', 123, null])('rejects invalid channel scope %s', (channel) => {
    const encoded = rawCursor({ v: 2, c: channel, s: [['', 0]], h: [] })
    expect(() => decodeTimelineCursor(encoded)).toThrow(InvalidTimelineCursorError)
    expect(() => encodeTimelineCursor({ v: 2, channel, sources: [root] } as Parameters<typeof encodeTimelineCursor>[0])).toThrow(TypeError)
  })

  it('round-trips sources and back navigation in URL-safe form', () => {
    const payload = { v: 2 as const, sources: [source, root], history: [[root, root]] }
    const encoded = encodeTimelineCursor(payload)
    expect(encoded).toMatch(/^[\w-]+$/)
    expect(decodeTimelineCursor(encoded)).toEqual(payload)
  })

  it('recognizes root by source positions rather than empty history', () => {
    expect(isRootTimelineCursor(encodeTimelineCursor({ v: 2, sources: [root], history: [] }))).toBe(true)
    expect(isRootTimelineCursor(encodeTimelineCursor({ v: 2, sources: [source], history: [] }))).toBe(false)
  })

  it('bounds history by both entry count and URL size', () => {
    const sources = Array.from({ length: 12 }, () => ({ ...source }))
    const encoded = encodeTimelineCursor({ v: 2, sources, history: Array.from({ length: 100 }, () => [...sources]) })
    expect(encoded.length).toBeLessThanOrEqual(2048)
    const decoded = decodeTimelineCursor(encoded)
    expect(decoded.sources).toEqual(sources)
    expect(decoded.history!.length).toBeLessThanOrEqual(8)
    expect(decoded.history!.length).toBeGreaterThan(0)
  })

  it('accepts existing v2 links and retains only recent history', () => {
    const encoded = rawCursor({ v: 2, s: [['123', 4]], h: Array.from({ length: 30 }, () => [['', 0]]) })
    expect(decodeTimelineCursor(encoded).history).toHaveLength(8)
  })

  it('round-trips the maximum supported offset', () => {
    const payload = { v: 2 as const, sources: [{ before: '123', offset: 1000 }], history: [] }
    expect(decodeTimelineCursor(encodeTimelineCursor(payload))).toEqual(payload)
  })

  it.each([
    { v: 2, sources: [], history: [] },
    { v: 2, history: [] },
    { v: 2, sources: [{ before: '123', offset: 1001 }], history: [] },
    { v: 2, sources: [{ before: 'abc', offset: 0 }], history: [] },
    { v: 2, sources: [{ before: '123', offset: Number.NaN }], history: [] },
    { v: 2, sources: [source], history: [[root, root]] },
    { v: 2, sources: [source], history: [[{ before: '', offset: 1001 }]] },
    { v: 2, sources: Array.from({ length: 1 }), history: [] },
    { v: 1, sources: [source], history: [] },
  ])('rejects invalid encoder input instead of issuing a broken link %#', (payload) => {
    expect(() => encodeTimelineCursor(payload as Parameters<typeof encodeTimelineCursor>[0])).toThrow(TypeError)
  })

  it('distinguishes an oversized generated source state from other range errors', () => {
    const payload = { v: 2 as const, sources: Array.from<typeof source>({ length: 1000 }).fill(source), history: [] }
    expect(() => encodeTimelineCursor(payload)).toThrow(TimelineCursorBudgetError)
    expect(() => encodeTimelineCursor(payload)).toThrow(RangeError)
  })

  it('only recovers invalid input and cursor budget exhaustion during navigation', () => {
    expect(isRecoverableTimelineCursorError(new InvalidTimelineCursorError('Invalid input'))).toBe(true)
    expect(isRecoverableTimelineCursorError(new TimelineCursorBudgetError('URL budget exceeded'))).toBe(true)
    expect(isRecoverableTimelineCursorError(new RangeError('Unrelated range error'))).toBe(false)
    expect(isRecoverableTimelineCursorError(new TypeError('Invalid server state'))).toBe(false)
    expect(isRecoverableTimelineCursorError(new Error('Upstream unavailable'))).toBe(false)
  })

  it.each([
    '123-456',
    'not-base64!',
    'x'.repeat(8193),
    rawCursor(null),
    rawCursor({ v: 1 }),
    rawCursor({ v: 2, s: [], h: [] }),
    rawCursor({ v: 2, s: [['abc', 0]], h: [] }),
    rawCursor({ v: 2, s: [['123', -1]], h: [] }),
    rawCursor({ v: 2, s: [['123', 1.5]], h: [] }),
    rawCursor({ v: 2, s: [['123', 1001]], h: [] }),
    rawCursor({ v: 2, s: [['123', 0]], h: [[['', 0], ['', 0]]] }),
  ])('rejects malformed or excessive cursor %#', (cursor) => {
    expect(() => decodeTimelineCursor(cursor)).toThrow(InvalidTimelineCursorError)
  })
})
