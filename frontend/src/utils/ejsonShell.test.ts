import { describe, expect, it } from 'vitest'
import { formatExtendedJsonValue, stringifyExtendedJsonShell } from './ejsonShell'
import { shellToJson } from './queryParser'

describe('ejsonShell', () => {
  it('renders $numberInt as NumberInt()', () => {
    expect(formatExtendedJsonValue({ $numberInt: '3' })).toBe('NumberInt(3)')
  })

  it('renders nested canonical Extended JSON in shell style', () => {
    const result = stringifyExtendedJsonShell({
      ClusterSize: { $numberInt: '3' },
      limit: { $numberLong: '9223372036854775807' },
    })

    expect(result).toContain('"ClusterSize": NumberInt(3)')
    expect(result).toContain('"limit": NumberLong("9223372036854775807")')
  })

  it('round-trips shell numeric constructors back to canonical Extended JSON', () => {
    const shell = stringifyExtendedJsonShell({ ClusterSize: { $numberInt: '3' } })
    expect(JSON.parse(shellToJson(shell))).toEqual({
      ClusterSize: { $numberInt: '3' },
    })
  })
})
