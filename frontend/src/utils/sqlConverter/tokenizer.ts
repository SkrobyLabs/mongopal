/**
 * SQL tokenizer for the F076 converter.
 *
 * Splits a SQL string into typed tokens with start/end offsets (needed for
 * Monaco markers and completion context). Keywords are case-insensitive;
 * identifiers are case-sensitive (MongoDB field names are).
 */

export type TokenType =
  | 'keyword'
  | 'rejected' // OFFSET/DELETE/UPDATE/SET/INSERT/JOIN — parser emits friendly hints
  | 'identifier' // unquoted or double-quoted (dotted paths)
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'operator' // = != <> < > <= >=
  | 'typefn' // ObjectId / ISODate (value-position pseudo-functions)
  | 'punct' // ( ) , *
  | 'eof'

export interface Token {
  type: TokenType
  /** Normalized value: keywords upper-cased; identifiers/strings as written (unquoted). */
  value: string
  /** Raw text as it appeared in the source. */
  raw: string
  start: number
  end: number // exclusive
}

export class TokenizeError extends Error {
  position: number
  constructor(message: string, position: number) {
    super(message)
    this.name = 'TokenizeError'
    this.position = position
  }
}

const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN',
  'IS', 'NULL', 'ORDER', 'BY', 'ASC', 'DESC', 'LIMIT', 'GROUP', 'HAVING',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'DISTINCT', 'AS',
])

// Recognized so the parser can emit friendly "not supported" hints instead of
// a generic "unexpected token".
const REJECTED = new Set([
  'OFFSET', 'DELETE', 'UPDATE', 'SET', 'INSERT', 'INTO', 'JOIN', 'VALUES',
])

const TYPE_FUNCTIONS = new Set(['ObjectId', 'ISODate'])

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_$]/.test(ch)
}

function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch)
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = input.length

  while (i < n) {
    const ch = input[i]

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++
      continue
    }

    const start = i

    // Punctuation
    if (ch === '(' || ch === ')' || ch === ',' || ch === '*') {
      tokens.push({ type: 'punct', value: ch, raw: ch, start, end: i + 1 })
      i++
      continue
    }

    // Operators
    if (ch === '=') {
      tokens.push({ type: 'operator', value: '=', raw: '=', start, end: i + 1 })
      i++
      continue
    }
    if (ch === '!') {
      if (input[i + 1] === '=') {
        tokens.push({ type: 'operator', value: '!=', raw: '!=', start, end: i + 2 })
        i += 2
        continue
      }
      throw new TokenizeError(`Unexpected character '!' at position ${i}`, i)
    }
    if (ch === '<') {
      if (input[i + 1] === '>') {
        tokens.push({ type: 'operator', value: '<>', raw: '<>', start, end: i + 2 })
        i += 2
        continue
      }
      if (input[i + 1] === '=') {
        tokens.push({ type: 'operator', value: '<=', raw: '<=', start, end: i + 2 })
        i += 2
        continue
      }
      tokens.push({ type: 'operator', value: '<', raw: '<', start, end: i + 1 })
      i++
      continue
    }
    if (ch === '>') {
      if (input[i + 1] === '=') {
        tokens.push({ type: 'operator', value: '>=', raw: '>=', start, end: i + 2 })
        i += 2
        continue
      }
      tokens.push({ type: 'operator', value: '>', raw: '>', start, end: i + 1 })
      i++
      continue
    }

    // Single-quoted string literals (with '' escape)
    if (ch === "'") {
      i++
      let value = ''
      let closed = false
      while (i < n) {
        const c = input[i]
        if (c === "'") {
          if (input[i + 1] === "'") {
            value += "'"
            i += 2
            continue
          }
          closed = true
          i++
          break
        }
        value += c
        i++
      }
      if (!closed) {
        throw new TokenizeError(`Unclosed string literal starting at position ${start}`, start)
      }
      tokens.push({ type: 'string', value, raw: input.slice(start, i), start, end: i })
      continue
    }

    // Double-quoted identifiers (dotted paths, spaces, hyphens)
    if (ch === '"') {
      i++
      let value = ''
      let closed = false
      while (i < n) {
        const c = input[i]
        if (c === '"') {
          if (input[i + 1] === '"') {
            value += '"'
            i += 2
            continue
          }
          closed = true
          i++
          break
        }
        value += c
        i++
      }
      if (!closed) {
        throw new TokenizeError(`Unclosed quoted identifier starting at position ${start}`, start)
      }
      tokens.push({ type: 'identifier', value, raw: input.slice(start, i), start, end: i })
      continue
    }

    // Numbers (integer, float, optional leading minus)
    if (isDigit(ch) || (ch === '-' && isDigit(input[i + 1] ?? ''))) {
      i++ // consume first char (digit or '-')
      while (i < n && (isDigit(input[i]) || input[i] === '.')) {
        i++
      }
      const raw = input.slice(start, i)
      tokens.push({ type: 'number', value: raw, raw, start, end: i })
      continue
    }

    // Identifiers / keywords / booleans / null / type functions
    if (isIdentStart(ch)) {
      i++
      while (i < n && isIdentPart(input[i])) {
        i++
      }
      const raw = input.slice(start, i)
      const upper = raw.toUpperCase()

      if (raw === 'true' || raw === 'false' || upper === 'TRUE' || upper === 'FALSE') {
        tokens.push({ type: 'boolean', value: upper.toLowerCase(), raw, start, end: i })
        continue
      }
      if (upper === 'NULL') {
        tokens.push({ type: 'null', value: 'NULL', raw, start, end: i })
        continue
      }
      if (TYPE_FUNCTIONS.has(raw)) {
        tokens.push({ type: 'typefn', value: raw, raw, start, end: i })
        continue
      }
      if (REJECTED.has(upper)) {
        tokens.push({ type: 'rejected', value: upper, raw, start, end: i })
        continue
      }
      if (KEYWORDS.has(upper)) {
        tokens.push({ type: 'keyword', value: upper, raw, start, end: i })
        continue
      }
      tokens.push({ type: 'identifier', value: raw, raw, start, end: i })
      continue
    }

    throw new TokenizeError(`Unexpected character '${ch}' at position ${i}`, i)
  }

  tokens.push({ type: 'eof', value: '', raw: '', start: n, end: n })
  return tokens
}
