/**
 * Query completion provider for the mongoquery Monaco editor.
 *
 * Provides context-aware autocomplete for MongoDB query filters:
 * - Field names (from schema)
 * - Query operators ($gt, $in, etc.)
 * - Logical operators ($and, $or, etc.)
 * - Type-aware value suggestions
 * - Extended JSON type wrappers ($oid, $date, etc.)
 */

import type { SchemaResult, SchemaField } from '../components/contexts/SchemaContext'
import { getFieldType } from './schemaFieldLookup'

// =============================================================================
// Types
// =============================================================================

export type CompletionContext =
  | { type: 'field'; prefix: string; depth: number }
  | { type: 'operator'; prefix: string }
  | { type: 'logical-operator'; prefix: string }
  | { type: 'value'; fieldName: string; fieldType?: string }
  | { type: 'none' }

export interface OperatorInfo {
  label: string
  detail: string
  documentation: string
  insertText: string
  isSnippet: boolean
}

export interface CompletionItemOption {
  label: string
  kind: number
  detail?: string
  documentation?: string
  insertText: string
  insertTextRules?: number
  sortText?: string
  range?: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
}

export interface CompletionProviderDeps {
  getSchema: () => SchemaResult | null
  getFieldNames: () => Set<string> | null
}

// Monaco CompletionItemKind values (subset we use)
const CompletionKind = {
  Field: 4,
  Function: 1,
  Operator: 11,
  Value: 12,
  Keyword: 17,
  Snippet: 27,
} as const

// Monaco CompletionItemInsertTextRule
const InsertTextRules = {
  InsertAsSnippet: 4,
} as const

// =============================================================================
// Operator Definitions
// =============================================================================

const COMPARISON_OPERATORS: OperatorInfo[] = [
  { label: '$eq', detail: 'Equal to', documentation: 'Matches values equal to the specified value.\n\n`{ field: { $eq: value } }`', insertText: '"$eq": ${1:value}', isSnippet: true },
  { label: '$ne', detail: 'Not equal to', documentation: 'Matches values not equal to the specified value.\n\n`{ field: { $ne: value } }`', insertText: '"$ne": ${1:value}', isSnippet: true },
  { label: '$gt', detail: 'Greater than', documentation: 'Matches values greater than the specified value.\n\n`{ age: { $gt: 25 } }`', insertText: '"$gt": ${1:value}', isSnippet: true },
  { label: '$gte', detail: 'Greater than or equal', documentation: 'Matches values greater than or equal to the specified value.\n\n`{ age: { $gte: 18 } }`', insertText: '"$gte": ${1:value}', isSnippet: true },
  { label: '$lt', detail: 'Less than', documentation: 'Matches values less than the specified value.\n\n`{ age: { $lt: 65 } }`', insertText: '"$lt": ${1:value}', isSnippet: true },
  { label: '$lte', detail: 'Less than or equal', documentation: 'Matches values less than or equal to the specified value.\n\n`{ age: { $lte: 30 } }`', insertText: '"$lte": ${1:value}', isSnippet: true },
  { label: '$in', detail: 'In array', documentation: 'Matches any of the values in the array.\n\n`{ status: { $in: ["active", "pending"] } }`', insertText: '"$in": [${1}]', isSnippet: true },
  { label: '$nin', detail: 'Not in array', documentation: 'Matches none of the values in the array.\n\n`{ status: { $nin: ["deleted"] } }`', insertText: '"$nin": [${1}]', isSnippet: true },
]

const ELEMENT_OPERATORS: OperatorInfo[] = [
  { label: '$exists', detail: 'Field exists', documentation: 'Matches documents that have the specified field.\n\n`{ email: { $exists: true } }`', insertText: '"$exists": ${1:true}', isSnippet: true },
  { label: '$type', detail: 'Field type', documentation: 'Matches documents where the field is the specified BSON type.\n\n`{ age: { $type: "number" } }`', insertText: '"$type": "${1:string}"', isSnippet: true },
]

const EVALUATION_OPERATORS: OperatorInfo[] = [
  { label: '$regex', detail: 'Regular expression', documentation: 'Matches strings by regular expression.\n\n`{ name: { $regex: "^test", $options: "i" } }`', insertText: '"$regex": "${1:pattern}", "$options": "${2:i}"', isSnippet: true },
  { label: '$expr', detail: 'Aggregation expression', documentation: 'Allows aggregation expressions within query language.\n\n`{ $expr: { $gt: ["$qty", "$limit"] } }`', insertText: '"$expr": { ${1} }', isSnippet: true },
  { label: '$mod', detail: 'Modulo', documentation: 'Matches where field value modulo divisor equals remainder.\n\n`{ qty: { $mod: [4, 0] } }`', insertText: '"$mod": [${1:divisor}, ${2:remainder}]', isSnippet: true },
  { label: '$text', detail: 'Text search', documentation: 'Performs text search on text-indexed fields.\n\n`{ $text: { $search: "coffee" } }`', insertText: '"$text": { "$search": "${1}" }', isSnippet: true },
]

const ARRAY_OPERATORS: OperatorInfo[] = [
  { label: '$all', detail: 'All elements match', documentation: 'Matches arrays that contain all specified elements.\n\n`{ tags: { $all: ["ssl", "security"] } }`', insertText: '"$all": [${1}]', isSnippet: true },
  { label: '$elemMatch', detail: 'Element match', documentation: 'Matches arrays where at least one element matches all conditions.\n\n`{ results: { $elemMatch: { score: { $gt: 80 } } } }`', insertText: '"$elemMatch": { ${1} }', isSnippet: true },
  { label: '$size', detail: 'Array size', documentation: 'Matches arrays with the specified length.\n\n`{ tags: { $size: 3 } }`', insertText: '"$size": ${1:0}', isSnippet: true },
]

const LOGICAL_OPERATORS: OperatorInfo[] = [
  { label: '$and', detail: 'Logical AND', documentation: 'Joins query clauses with logical AND.\n\n`{ $and: [{ price: { $ne: 1.99 } }, { price: { $exists: true } }] }`', insertText: '"$and": [{ ${1} }, { ${2} }]', isSnippet: true },
  { label: '$or', detail: 'Logical OR', documentation: 'Joins query clauses with logical OR.\n\n`{ $or: [{ status: "A" }, { qty: { $lt: 30 } }] }`', insertText: '"$or": [{ ${1} }, { ${2} }]', isSnippet: true },
  { label: '$not', detail: 'Logical NOT', documentation: 'Inverts the effect of a query expression.\n\n`{ price: { $not: { $gt: 1.99 } } }`', insertText: '"$not": { ${1} }', isSnippet: true },
  { label: '$nor', detail: 'Logical NOR', documentation: 'Joins query clauses with logical NOR.\n\n`{ $nor: [{ price: 1.99 }, { sale: true }] }`', insertText: '"$nor": [{ ${1} }, { ${2} }]', isSnippet: true },
]

const EXTENDED_JSON_OPERATORS: OperatorInfo[] = [
  { label: '$oid', detail: 'ObjectId', documentation: 'Extended JSON ObjectId wrapper.\n\n`{ _id: { "$oid": "507f1f77bcf86cd799439011" } }`', insertText: '"$oid": "${1:507f1f77bcf86cd799439011}"', isSnippet: true },
  { label: '$date', detail: 'Date', documentation: 'Extended JSON Date wrapper.\n\n`{ created: { "$date": "2024-01-01T00:00:00Z" } }`', insertText: '"$date": "${1:2024-01-01T00:00:00Z}"', isSnippet: true },
  { label: '$numberInt', detail: 'Int32', documentation: 'Extended JSON 32-bit integer.\n\n`{ count: { "$numberInt": "42" } }`', insertText: '"$numberInt": "${1:0}"', isSnippet: true },
  { label: '$numberLong', detail: 'Int64', documentation: 'Extended JSON 64-bit integer.\n\n`{ bigCount: { "$numberLong": "9223372036854775807" } }`', insertText: '"$numberLong": "${1:0}"', isSnippet: true },
  { label: '$numberDouble', detail: 'Double', documentation: 'Extended JSON double.\n\n`{ price: { "$numberDouble": "9.99" } }`', insertText: '"$numberDouble": "${1:0.0}"', isSnippet: true },
  { label: '$numberDecimal', detail: 'Decimal128', documentation: 'Extended JSON 128-bit decimal.\n\n`{ price: { "$numberDecimal": "9.99" } }`', insertText: '"$numberDecimal": "${1:0.0}"', isSnippet: true },
]

const MONGOSH_CONSTRUCTORS: OperatorInfo[] = [
  { label: 'ObjectId()', detail: 'mongosh ObjectId', documentation: 'ObjectId constructor (auto-converted to Extended JSON).\n\n`{ _id: ObjectId("507f1f77bcf86cd799439011") }`', insertText: 'ObjectId("${1}")', isSnippet: true },
  { label: 'ISODate()', detail: 'mongosh ISODate', documentation: 'ISODate constructor (auto-converted to Extended JSON).\n\n`{ created: ISODate("2024-01-01T00:00:00Z") }`', insertText: 'ISODate("${1:2024-01-01T00:00:00Z}")', isSnippet: true },
  { label: 'new Date()', detail: 'mongosh Date', documentation: 'Date constructor (auto-converted to Extended JSON).\n\n`{ created: new Date("2024-01-01") }`', insertText: 'new Date("${1:2024-01-01T00:00:00Z}")', isSnippet: true },
  { label: 'NumberInt()', detail: 'mongosh Int32', documentation: 'NumberInt constructor (auto-converted to Extended JSON).\n\n`{ count: NumberInt(42) }`', insertText: 'NumberInt(${1:0})', isSnippet: true },
  { label: 'NumberLong()', detail: 'mongosh Int64', documentation: 'NumberLong constructor (auto-converted to Extended JSON).\n\n`{ big: NumberLong(9999999999) }`', insertText: 'NumberLong(${1:0})', isSnippet: true },
  { label: 'NumberDecimal()', detail: 'mongosh Decimal128', documentation: 'NumberDecimal constructor (auto-converted to Extended JSON).\n\n`{ price: NumberDecimal("9.99") }`', insertText: 'NumberDecimal("${1:0.0}")', isSnippet: true },
  { label: 'UUID()', detail: 'mongosh UUID', documentation: 'UUID constructor (auto-converted to Extended JSON).\n\n`{ ref: UUID("abc-def-123") }`', insertText: 'UUID("${1}")', isSnippet: true },
  { label: 'Timestamp()', detail: 'mongosh Timestamp', documentation: 'Timestamp constructor (auto-converted to Extended JSON).\n\n`{ ts: Timestamp(1234, 1) }`', insertText: 'Timestamp(${1:0}, ${2:1})', isSnippet: true },
]

const QUERY_OPERATORS = [
  ...COMPARISON_OPERATORS,
  ...ELEMENT_OPERATORS,
  ...EVALUATION_OPERATORS,
  ...ARRAY_OPERATORS,
]

// =============================================================================
// Context Detection
// =============================================================================

/**
 * Detect what kind of completion the cursor position needs.
 *
 * Scans backwards from offset tracking brace depth and quote state.
 * The offset is 0-based into the full text string.
 */
export function detectCompletionContext(text: string, offset: number): CompletionContext {
  if (offset <= 0 || text.length === 0) return { type: 'none' }

  // Clamp offset
  const pos = Math.min(offset, text.length)

  // Check if we're inside a completed string value (not a key)
  if (isInsideStringValue(text, pos)) {
    return { type: 'none' }
  }

  // Find the prefix: scan back from cursor to find what the user is typing
  let prefix = ''
  let scanPos = pos - 1

  // Collect characters that are part of the current token
  while (scanPos >= 0) {
    const ch = text[scanPos]
    if (ch === '"' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '{' || ch === ',' || ch === ':' || ch === '[') {
      break
    }
    prefix = ch + prefix
    scanPos--
  }

  // What character did we stop at?
  const stopChar = scanPos >= 0 ? text[scanPos] : ''

  // If prefix starts with $, determine if it's a query operator or logical operator
  if (prefix.startsWith('$')) {
    const fullPrefix = prefix
    // Determine depth: count unmatched { minus } before this position
    const depth = computeBraceDepth(text, scanPos)
    if (depth <= 1) {
      return { type: 'logical-operator', prefix: fullPrefix }
    }
    // Check if we're in a value object (after a field: {  })
    if (isInValuePosition(text, scanPos)) {
      return { type: 'operator', prefix: fullPrefix }
    }
    return { type: 'operator', prefix: fullPrefix }
  }

  // After opening quote that's a key position
  if (stopChar === '"') {
    const depth = computeBraceDepth(text, scanPos)
    // Check if this quote starts a key (after { or ,) vs a value (after :)
    const beforeQuote = findNonWhitespaceBefore(text, scanPos)
    if (beforeQuote === ':') {
      // This is a string value, not a key — check for $ prefix
      if (prefix.startsWith('$')) {
        return { type: 'operator', prefix: prefix }
      }
      return { type: 'none' }
    }
    return { type: 'field', prefix, depth }
  }

  // After { or , — field position
  if (stopChar === '{' || stopChar === ',') {
    const depth = computeBraceDepth(text, scanPos + 1)
    return { type: 'field', prefix: '', depth }
  }

  // After : — value position
  if (stopChar === ':') {
    const fieldName = findFieldNameBefore(text, scanPos)
    return { type: 'value', fieldName }
  }

  // Whitespace after relevant characters
  const lastSignificant = findNonWhitespaceBefore(text, pos)
  if (lastSignificant === '{' || lastSignificant === ',') {
    const sigPos = findNonWhitespacePosBefore(text, pos)
    const depth = computeBraceDepth(text, sigPos + 1)
    return { type: 'field', prefix: '', depth }
  }
  if (lastSignificant === ':') {
    const sigPos = findNonWhitespacePosBefore(text, pos)
    const fieldName = findFieldNameBefore(text, sigPos)
    return { type: 'value', fieldName }
  }

  return { type: 'none' }
}

// =============================================================================
// Context Detection Helpers
// =============================================================================

/**
 * Check if cursor is inside a string value (not a key).
 * A string value follows a colon; a key follows { or ,.
 */
function isInsideStringValue(text: string, offset: number): boolean {
  let inString = false
  let stringStart = -1
  let lastColonBeforeString = false

  for (let i = 0; i < offset; i++) {
    const ch = text[i]
    if (ch === '\\' && inString) {
      i++ // skip escaped char
      continue
    }
    if (ch === '"') {
      if (!inString) {
        inString = true
        stringStart = i
        // Check if this string follows a colon (value position)
        const before = findNonWhitespaceBefore(text, i)
        lastColonBeforeString = before === ':'
      } else {
        inString = false
        stringStart = -1
      }
    }
  }

  // If we're inside an open string and it's a value string, return true
  return inString && stringStart >= 0 && lastColonBeforeString
}

/**
 * Count unmatched opening braces up to pos (ignoring those inside strings).
 */
function computeBraceDepth(text: string, pos: number): number {
  let depth = 0
  let inString = false

  for (let i = 0; i < pos && i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\' && inString) {
      i++
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') depth++
    if (ch === '}') depth--
  }

  return Math.max(0, depth)
}

/**
 * Check if position is inside a value object (field: { HERE }).
 */
function isInValuePosition(text: string, pos: number): boolean {
  // Walk backward to find the nearest unmatched {
  let depth = 0
  let inString = false

  for (let i = pos; i >= 0; i--) {
    const ch = text[i]
    if (ch === '"' && (i === 0 || text[i - 1] !== '\\')) {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '}') depth++
    if (ch === '{') {
      if (depth === 0) {
        // Found the nearest unmatched { — check what's before it
        const before = findNonWhitespaceBefore(text, i)
        return before === ':'
      }
      depth--
    }
  }
  return false
}

/**
 * Find the last non-whitespace character before pos.
 */
function findNonWhitespaceBefore(text: string, pos: number): string {
  for (let i = pos - 1; i >= 0; i--) {
    const ch = text[i]
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') {
      return ch
    }
  }
  return ''
}

/**
 * Find the position of the last non-whitespace character before pos.
 */
function findNonWhitespacePosBefore(text: string, pos: number): number {
  for (let i = pos - 1; i >= 0; i--) {
    const ch = text[i]
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') {
      return i
    }
  }
  return -1
}

/**
 * Find the field name before a colon at the given position.
 * Expects: `"fieldName"  :` with pos at the `:`.
 */
function findFieldNameBefore(text: string, colonPos: number): string {
  // Walk back from colon, skip whitespace, find closing quote of key
  let i = colonPos - 1
  while (i >= 0 && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) {
    i--
  }

  if (i < 0 || text[i] !== '"') return ''

  // Walk backward to find the opening quote
  const end = i
  i--
  while (i >= 0 && text[i] !== '"') {
    if (text[i] === '\\') i-- // skip escaped chars backwards (approximate)
    i--
  }

  if (i < 0) return ''
  return text.substring(i + 1, end)
}

// =============================================================================
// Completion Item Builders
// =============================================================================

/**
 * Build field name completion items from schema field names.
 */
export function buildFieldItems(
  fieldNames: Set<string> | null,
  schema: SchemaResult | null,
  prefix: string,
): CompletionItemOption[] {
  if (!fieldNames || fieldNames.size === 0) return []

  const lowerPrefix = prefix.toLowerCase()
  const items: CompletionItemOption[] = []

  // Sort by occurrence if schema available, otherwise alphabetically
  const sorted = Array.from(fieldNames)
    .filter((name) => lowerPrefix === '' || name.toLowerCase().startsWith(lowerPrefix))
    .sort((a, b) => {
      if (schema) {
        const occA = getFieldOccurrence(schema, a)
        const occB = getFieldOccurrence(schema, b)
        if (occA !== occB) return occB - occA
      }
      return a.localeCompare(b)
    })
    .slice(0, 50) // Cap at 50

  for (let i = 0; i < sorted.length; i++) {
    const name = sorted[i]
    const fieldType = getFieldType(schema, name)
    const occurrence = schema ? getFieldOccurrence(schema, name) : null

    let detail = ''
    if (fieldType && occurrence !== null) {
      const pct = schema && schema.sampleSize > 0 ? Math.round((occurrence / schema.sampleSize) * 100) : 100
      detail = `${fieldType}, ${pct}%`
    } else if (fieldType) {
      detail = fieldType
    }

    items.push({
      label: name,
      kind: CompletionKind.Field,
      detail: detail || undefined,
      insertText: `"${name}"`,
      sortText: String(i).padStart(4, '0'),
    })
  }

  return items
}

/**
 * Build operator completion items for a given category.
 */
export function buildOperatorItems(
  category: 'query' | 'logical' | 'extended-json' | 'mongosh',
  prefix: string,
): CompletionItemOption[] {
  let operators: OperatorInfo[]

  switch (category) {
    case 'query':
      operators = QUERY_OPERATORS
      break
    case 'logical':
      operators = LOGICAL_OPERATORS
      break
    case 'extended-json':
      operators = EXTENDED_JSON_OPERATORS
      break
    case 'mongosh':
      operators = MONGOSH_CONSTRUCTORS
      break
  }

  const lowerPrefix = prefix.toLowerCase().replace(/^\$/, '')
  const items: CompletionItemOption[] = []

  for (let i = 0; i < operators.length; i++) {
    const op = operators[i]
    const opName = op.label.replace(/^\$/, '')
    if (lowerPrefix && !opName.toLowerCase().startsWith(lowerPrefix)) continue

    items.push({
      label: op.label,
      kind: CompletionKind.Operator,
      detail: op.detail,
      documentation: op.documentation,
      insertText: op.insertText,
      insertTextRules: op.isSnippet ? InsertTextRules.InsertAsSnippet : undefined,
      sortText: String(i).padStart(4, '0'),
    })
  }

  return items
}

/**
 * Build value completion items based on field type.
 */
export function buildValueItems(
  fieldType: string | undefined,
): CompletionItemOption[] {
  if (!fieldType) return []

  const type = fieldType.toLowerCase()
  const items: CompletionItemOption[] = []

  if (type === 'bool' || type === 'boolean') {
    items.push(
      { label: 'true', kind: CompletionKind.Value, insertText: 'true', sortText: '0000' },
      { label: 'false', kind: CompletionKind.Value, insertText: 'false', sortText: '0001' },
    )
  }

  if (type === 'objectid' || type === 'objectId') {
    items.push(
      {
        label: 'ObjectId()',
        kind: CompletionKind.Snippet,
        detail: 'mongosh ObjectId',
        insertText: 'ObjectId("${1}")',
        insertTextRules: InsertTextRules.InsertAsSnippet,
        sortText: '0000',
      },
      {
        label: 'ObjectId (Extended JSON)',
        kind: CompletionKind.Snippet,
        detail: 'Extended JSON ObjectId',
        insertText: '{ "$$oid": "${1}" }',
        insertTextRules: InsertTextRules.InsertAsSnippet,
        sortText: '0001',
      },
    )
  }

  if (type === 'date') {
    items.push(
      {
        label: 'ISODate()',
        kind: CompletionKind.Snippet,
        detail: 'mongosh ISODate',
        insertText: 'ISODate("${1:2024-01-01T00:00:00Z}")',
        insertTextRules: InsertTextRules.InsertAsSnippet,
        sortText: '0000',
      },
      {
        label: 'Date (Extended JSON)',
        kind: CompletionKind.Snippet,
        detail: 'Extended JSON Date',
        insertText: '{ "$$date": "${1:2024-01-01T00:00:00Z}" }',
        insertTextRules: InsertTextRules.InsertAsSnippet,
        sortText: '0001',
      },
    )
  }

  if (type === 'null') {
    items.push(
      { label: 'null', kind: CompletionKind.Value, insertText: 'null', sortText: '0000' },
    )
  }

  if (type === 'number' || type === 'int' || type === 'long' || type === 'double' || type === 'decimal') {
    items.push(
      { label: '0', kind: CompletionKind.Value, detail: 'Number', insertText: '${1:0}', insertTextRules: InsertTextRules.InsertAsSnippet, sortText: '0000' },
    )
  }

  return items
}

// =============================================================================
// Schema Helpers
// =============================================================================

// Re-exported for back-compat — moved to schemaFieldLookup.ts so non-editor
// consumers (the SQL transformer) don't need to depend on this Monaco-adjacent module.
export { getFieldType }

/**
 * Get the occurrence count for a field path.
 */
function getFieldOccurrence(schema: SchemaResult, fieldPath: string): number {
  const parts = fieldPath.split('.')
  let current: Record<string, SchemaField> | undefined = schema.fields

  for (let i = 0; i < parts.length; i++) {
    if (!current) return 0
    const field: SchemaField | undefined = current[parts[i]]
    if (!field) return 0

    if (i === parts.length - 1) {
      return field.occurrence
    }

    current = field.fields || field.arrayType?.fields
  }

  return 0
}

// =============================================================================
// Provider Factory
// =============================================================================

/**
 * Minimal model interface for testing without Monaco dependency.
 */
export interface TextModel {
  getValue(): string
  getOffsetAt(position: { lineNumber: number; column: number }): number
}

/**
 * Create a completion provider for the mongoquery language.
 *
 * Returns a plain object compatible with Monaco's CompletionItemProvider.
 * The deps callbacks are invoked at suggestion time to get current data.
 */
export function createQueryCompletionProvider(deps: CompletionProviderDeps) {
  return {
    triggerCharacters: ['"', '$', '{', ',', ':', ' '],

    provideCompletionItems(
      model: TextModel,
      position: { lineNumber: number; column: number },
    ): { suggestions: CompletionItemOption[] } {
      const text = model.getValue()
      const offset = model.getOffsetAt(position)
      const context = detectCompletionContext(text, offset)

      switch (context.type) {
        case 'field': {
          const fieldNames = deps.getFieldNames()
          const schema = deps.getSchema()
          const fieldItems = buildFieldItems(fieldNames, schema, context.prefix)

          // If cursor is right after an opening quote, set range to include it
          // so inserting `"name"` replaces the existing `"` instead of doubling it
          const charBefore = offset > 0 ? text[offset - 1] : ''
          const prefixLen = context.prefix.length
          if (charBefore === '"' || (prefixLen > 0 && offset - prefixLen - 1 >= 0 && text[offset - prefixLen - 1] === '"')) {
            const quoteCol = charBefore === '"'
              ? position.column - 1
              : position.column - prefixLen - 1
            const range = {
              startLineNumber: position.lineNumber,
              startColumn: quoteCol,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            }
            for (const item of fieldItems) {
              item.range = range
            }
          }

          // Also offer logical operators at root level
          if (context.depth <= 1 && context.prefix === '') {
            const logicalItems = buildOperatorItems('logical', '')
            return { suggestions: [...fieldItems, ...logicalItems] }
          }
          return { suggestions: fieldItems }
        }

        case 'operator': {
          const queryItems = buildOperatorItems('query', context.prefix)
          const extJsonItems = buildOperatorItems('extended-json', context.prefix)
          return { suggestions: [...queryItems, ...extJsonItems] }
        }

        case 'logical-operator': {
          const logicalItems = buildOperatorItems('logical', context.prefix)
          return { suggestions: logicalItems }
        }

        case 'value': {
          const schema = deps.getSchema()
          const fieldType = getFieldType(schema, context.fieldName)
          const valueItems = buildValueItems(fieldType)
          // Also offer mongosh constructors in value context
          const mongoshItems = buildOperatorItems('mongosh', '')
          return { suggestions: [...valueItems, ...mongoshItems] }
        }

        case 'none':
        default:
          return { suggestions: [] }
      }
    },
  }
}
