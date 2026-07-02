import { describe, it, expect } from 'vitest'
import { tokenize, TokenizeError } from './tokenizer'

function types(sql: string): string[] {
  return tokenize(sql).filter((t) => t.type !== 'eof').map((t) => t.type)
}

function values(sql: string): string[] {
  return tokenize(sql).filter((t) => t.type !== 'eof').map((t) => t.value)
}

describe('tokenizer', () => {
  it('recognizes keywords case-insensitively', () => {
    expect(values('select FROM Where')).toEqual(['SELECT', 'FROM', 'WHERE'])
  })

  it('keeps identifiers case-sensitive', () => {
    expect(values('SELECT userName')).toEqual(['SELECT', 'userName'])
  })

  it('tokenizes single-quoted strings with escaped quotes', () => {
    const toks = tokenize("WHERE name = 'O''Brien'").filter((t) => t.type === 'string')
    expect(toks[0].value).toBe("O'Brien")
  })

  it('throws on unclosed string literal with position', () => {
    expect(() => tokenize("WHERE a = 'abc")).toThrow(TokenizeError)
  })

  it('tokenizes double-quoted dotted identifiers', () => {
    const toks = tokenize('WHERE "address.city" = 1').filter((t) => t.type === 'identifier')
    expect(toks[0].value).toBe('address.city')
  })

  it('tokenizes numbers including floats and negatives', () => {
    expect(values('42 3.14 -5')).toEqual(['42', '3.14', '-5'])
  })

  it('tokenizes all comparison operators', () => {
    expect(values('= != <> < > <= >=')).toEqual(['=', '!=', '<>', '<', '>', '<=', '>='])
  })

  it('recognizes booleans and null', () => {
    expect(types('true false NULL')).toEqual(['boolean', 'boolean', 'null'])
  })

  it('recognizes type functions', () => {
    expect(types('ObjectId ISODate')).toEqual(['typefn', 'typefn'])
  })

  it('recognizes rejected keywords as their own type', () => {
    expect(types('JOIN DELETE OFFSET')).toEqual(['rejected', 'rejected', 'rejected'])
  })

  it('records start/end offsets', () => {
    const toks = tokenize('SELECT a')
    expect(toks[0].start).toBe(0)
    expect(toks[0].end).toBe(6)
    expect(toks[1].start).toBe(7)
  })

  it('handles multi-line input', () => {
    expect(values('SELECT *\nFROM users')).toEqual(['SELECT', '*', 'FROM', 'users'])
  })
})
