/**
 * Monaco completion provider for SQL mode (F076).
 *
 * Mirrors queryCompletionProvider.ts: deps-injected, no Monaco imports, testable
 * in isolation. Clause detection scans committed tokens before the cursor for
 * the last significant keyword, then suggests fields / operators / keywords /
 * the current collection per the ticket's autocomplete table.
 */

import type { SchemaResult } from '../../components/contexts/SchemaContext'
import type { CompletionItemOption, TextModel } from '../queryCompletionProvider'
import { getFieldType } from '../schemaFieldLookup'
import { tokenize, Token } from './tokenizer'

export interface SqlCompletionProviderDeps {
  getSchema: () => SchemaResult | null
  getFieldNames: () => Set<string> | null
  getCurrentCollection: () => string
}

const CompletionKind = {
  Field: 4,
  Function: 1,
  Operator: 11,
  Value: 12,
  Keyword: 17,
  Snippet: 27,
} as const

const InsertTextRules = {
  InsertAsSnippet: 4,
} as const

export type SqlContext =
  | { type: 'select'; prefix: string }
  | { type: 'from'; prefix: string }
  | { type: 'field'; prefix: string }
  | { type: 'operator'; prefix: string }
  | { type: 'value'; field: string; prefix: string }
  | { type: 'keyword'; prefix: string }

const FIELD_KEYWORDS = new Set(['WHERE', 'AND', 'OR', 'HAVING', 'NOT', 'BY'])
const SELECT_KEYWORDS = new Set(['SELECT', 'DISTINCT'])
const COMPARISON_KEYWORDS = new Set(['IN', 'LIKE', 'BETWEEN', 'IS'])

function quoteIfNeeded(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : `"${name}"`
}

/** Read the partial identifier being typed immediately before the cursor. */
function readPrefix(text: string, offset: number): string {
  let start = offset
  while (start > 0 && /[A-Za-z0-9_$]/.test(text[start - 1])) start--
  return text.slice(start, offset)
}

/** Lenient tokenize — tolerates the unterminated tail of an in-progress query. */
function lenientTokens(text: string): Token[] {
  try {
    return tokenize(text).filter((t) => t.type !== 'eof')
  } catch {
    // Retry progressively shorter prefixes so a trailing unclosed quote/char
    // doesn't blank out completion for the rest of the query.
    for (let end = text.length - 1; end >= 0; end--) {
      try {
        return tokenize(text.slice(0, end)).filter((t) => t.type !== 'eof')
      } catch {
        // keep shrinking
      }
    }
    return []
  }
}

export function detectSqlContext(text: string, offset: number): SqlContext {
  const prefix = readPrefix(text, offset)
  const committed = lenientTokens(text.slice(0, offset - prefix.length))

  if (committed.length === 0) {
    return { type: 'keyword', prefix }
  }

  const last = committed[committed.length - 1]

  // Right after a comparison operator → value position.
  if (last.type === 'operator') {
    const field = committed.length >= 2 ? committed[committed.length - 2].value : ''
    return { type: 'value', field, prefix }
  }

  // Find the last significant keyword and whether an identifier followed it.
  let lastKeyword: string | null = null
  let identAfterKeyword = false
  let fromSeen = false
  for (const t of committed) {
    if (t.type === 'keyword') {
      if (t.value === 'FROM') fromSeen = true
      lastKeyword = t.value
      identAfterKeyword = false
    } else if (t.type === 'rejected') {
      lastKeyword = null
    } else if (t.type === 'identifier' || t.type === 'string' || t.type === 'number') {
      identAfterKeyword = true
    }
  }

  if (lastKeyword === 'FROM' && !identAfterKeyword) {
    return { type: 'from', prefix }
  }

  if (lastKeyword && SELECT_KEYWORDS.has(lastKeyword) && !fromSeen) {
    // Between SELECT and FROM. After a comma or right after SELECT → still select list.
    return { type: 'select', prefix }
  }

  if (lastKeyword && FIELD_KEYWORDS.has(lastKeyword)) {
    // After WHERE/AND/OR/HAVING: if a field was already typed → expect an operator.
    if (identAfterKeyword && last.type === 'identifier') {
      return { type: 'operator', prefix }
    }
    return { type: 'field', prefix }
  }

  if (lastKeyword && COMPARISON_KEYWORDS.has(lastKeyword)) {
    // After IN/LIKE/BETWEEN/IS we expect values; offer nothing structural.
    return { type: 'value', field: '', prefix }
  }

  return { type: 'keyword', prefix }
}

// =============================================================================
// Item builders
// =============================================================================

function fieldItems(deps: SqlCompletionProviderDeps, prefix: string): CompletionItemOption[] {
  const names = deps.getFieldNames()
  const schema = deps.getSchema()
  if (!names || names.size === 0) return []
  const lower = prefix.toLowerCase()
  const sorted = Array.from(names)
    .filter((n) => lower === '' || n.toLowerCase().startsWith(lower))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 50)
  return sorted.map((name, i) => {
    const type = getFieldType(schema, name)
    return {
      label: name,
      kind: CompletionKind.Field,
      detail: type || undefined,
      insertText: quoteIfNeeded(name),
      sortText: String(i).padStart(4, '0'),
    }
  })
}

const AGGREGATE_ITEMS: CompletionItemOption[] = [
  { label: 'COUNT(*)', kind: CompletionKind.Function, insertText: 'COUNT(*)', sortText: '1000' },
  { label: 'SUM()', kind: CompletionKind.Function, insertText: 'SUM(${1:field})', insertTextRules: InsertTextRules.InsertAsSnippet, sortText: '1001' },
  { label: 'AVG()', kind: CompletionKind.Function, insertText: 'AVG(${1:field})', insertTextRules: InsertTextRules.InsertAsSnippet, sortText: '1002' },
  { label: 'MIN()', kind: CompletionKind.Function, insertText: 'MIN(${1:field})', insertTextRules: InsertTextRules.InsertAsSnippet, sortText: '1003' },
  { label: 'MAX()', kind: CompletionKind.Function, insertText: 'MAX(${1:field})', insertTextRules: InsertTextRules.InsertAsSnippet, sortText: '1004' },
  { label: 'DISTINCT', kind: CompletionKind.Keyword, insertText: 'DISTINCT ', sortText: '1005' },
  { label: '*', kind: CompletionKind.Keyword, insertText: '*', sortText: '1006' },
]

const OPERATOR_ITEMS: CompletionItemOption[] = [
  { label: '=', kind: CompletionKind.Operator, insertText: '= ', sortText: '0000' },
  { label: '!=', kind: CompletionKind.Operator, insertText: '!= ', sortText: '0001' },
  { label: '>', kind: CompletionKind.Operator, insertText: '> ', sortText: '0002' },
  { label: '<', kind: CompletionKind.Operator, insertText: '< ', sortText: '0003' },
  { label: '>=', kind: CompletionKind.Operator, insertText: '>= ', sortText: '0004' },
  { label: '<=', kind: CompletionKind.Operator, insertText: '<= ', sortText: '0005' },
  { label: 'IN', kind: CompletionKind.Keyword, insertText: 'IN (${1})', insertTextRules: InsertTextRules.InsertAsSnippet, sortText: '0006' },
  { label: 'LIKE', kind: CompletionKind.Keyword, insertText: "LIKE '${1}'", insertTextRules: InsertTextRules.InsertAsSnippet, sortText: '0007' },
  { label: 'BETWEEN', kind: CompletionKind.Keyword, insertText: 'BETWEEN ${1} AND ${2}', insertTextRules: InsertTextRules.InsertAsSnippet, sortText: '0008' },
  { label: 'IS NULL', kind: CompletionKind.Keyword, insertText: 'IS NULL', sortText: '0009' },
  { label: 'IS NOT NULL', kind: CompletionKind.Keyword, insertText: 'IS NOT NULL', sortText: '0010' },
]

const CLAUSE_KEYWORD_ITEMS: CompletionItemOption[] = [
  { label: 'SELECT', kind: CompletionKind.Keyword, insertText: 'SELECT ', sortText: '0000' },
  { label: 'FROM', kind: CompletionKind.Keyword, insertText: 'FROM ', sortText: '0001' },
  { label: 'WHERE', kind: CompletionKind.Keyword, insertText: 'WHERE ', sortText: '0002' },
  { label: 'GROUP BY', kind: CompletionKind.Keyword, insertText: 'GROUP BY ', sortText: '0003' },
  { label: 'HAVING', kind: CompletionKind.Keyword, insertText: 'HAVING ', sortText: '0004' },
  { label: 'ORDER BY', kind: CompletionKind.Keyword, insertText: 'ORDER BY ', sortText: '0005' },
  { label: 'LIMIT', kind: CompletionKind.Keyword, insertText: 'LIMIT ', sortText: '0006' },
  { label: 'AND', kind: CompletionKind.Keyword, insertText: 'AND ', sortText: '0007' },
  { label: 'OR', kind: CompletionKind.Keyword, insertText: 'OR ', sortText: '0008' },
]

function filterByPrefix(items: CompletionItemOption[], prefix: string): CompletionItemOption[] {
  if (!prefix) return items
  const lower = prefix.toLowerCase()
  return items.filter((it) => it.label.toLowerCase().startsWith(lower))
}

function valueItems(deps: SqlCompletionProviderDeps, field: string): CompletionItemOption[] {
  const type = getFieldType(deps.getSchema(), field)
  const items: CompletionItemOption[] = []
  if (type === 'ObjectId') {
    items.push({ label: "ObjectId('')", kind: CompletionKind.Snippet, insertText: "ObjectId('${1}')", insertTextRules: InsertTextRules.InsertAsSnippet, sortText: '0000' })
  } else if (type === 'Date') {
    items.push({ label: "ISODate('')", kind: CompletionKind.Snippet, insertText: "ISODate('${1:2024-01-01T00:00:00Z}')", insertTextRules: InsertTextRules.InsertAsSnippet, sortText: '0000' })
  } else if (type === 'Boolean') {
    items.push(
      { label: 'true', kind: CompletionKind.Value, insertText: 'true', sortText: '0000' },
      { label: 'false', kind: CompletionKind.Value, insertText: 'false', sortText: '0001' },
    )
  }
  items.push({ label: 'NULL', kind: CompletionKind.Keyword, insertText: 'NULL', sortText: '0100' })
  return items
}

// =============================================================================
// Provider factory
// =============================================================================

export function createSqlCompletionProvider(deps: SqlCompletionProviderDeps) {
  return {
    triggerCharacters: [' ', '(', ',', '.'],

    provideCompletionItems(
      model: TextModel,
      position: { lineNumber: number; column: number },
    ): { suggestions: CompletionItemOption[] } {
      const text = model.getValue()
      const offset = model.getOffsetAt(position)
      const context = detectSqlContext(text, offset)

      switch (context.type) {
        case 'keyword':
          return { suggestions: filterByPrefix(CLAUSE_KEYWORD_ITEMS, context.prefix) }
        case 'select':
          return { suggestions: [...fieldItems(deps, context.prefix), ...filterByPrefix(AGGREGATE_ITEMS, context.prefix)] }
        case 'from': {
          const collection = deps.getCurrentCollection()
          if (!collection) return { suggestions: [] }
          return {
            suggestions: [{
              label: collection,
              kind: CompletionKind.Field,
              detail: 'current collection',
              insertText: quoteIfNeeded(collection),
              sortText: '0000',
            }],
          }
        }
        case 'field':
          return { suggestions: fieldItems(deps, context.prefix) }
        case 'operator':
          return { suggestions: filterByPrefix(OPERATOR_ITEMS, context.prefix) }
        case 'value':
          return { suggestions: valueItems(deps, context.field) }
        default:
          return { suggestions: [] }
      }
    },
  }
}
