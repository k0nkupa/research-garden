import { describe, expect, it } from 'vitest'
import { errorEnvelope, okEnvelope } from './envelope'

const REVISION = 'sha256:garden-revision'

describe('okEnvelope', () => {
  it('carries ok, the data, and the Garden Revision', () => {
    const envelope = okEnvelope({ items: [] }, REVISION)

    expect(envelope).toEqual({ ok: true, data: { items: [] }, gardenRevision: REVISION, warnings: [] })
  })

  it('carries warnings when given', () => {
    const envelope = okEnvelope({ items: [] }, REVISION, ['a warning'])

    expect(envelope.warnings).toEqual(['a warning'])
  })
})

describe('errorEnvelope', () => {
  it('carries ok: false, the code, the message, and the Garden Revision', () => {
    const envelope = errorEnvelope('lookup', 'No such item.', REVISION)

    expect(envelope).toEqual({
      ok: false,
      error: { code: 'lookup', message: 'No such item.', retryable: false },
      gardenRevision: REVISION,
      warnings: [],
    })
  })

  it.each(['permission', 'staleness', 'write'] as const)('marks %s as retryable', (code) => {
    const envelope = errorEnvelope(code, 'x', REVISION)

    if (envelope.ok) throw new Error('expected an error envelope')
    expect(envelope.error.retryable).toBe(true)
  })

  it.each([
    'browser',
    'lookup',
    'schema',
    'relation',
    'inspection',
    'confirmation',
    'invalid-input',
    'internal',
  ] as const)(
    'marks %s as not retryable',
    (code) => {
      const envelope = errorEnvelope(code, 'x', REVISION)

      if (envelope.ok) throw new Error('expected an error envelope')
      expect(envelope.error.retryable).toBe(false)
    },
  )
})
