/**
 * Query validator utility for real-time MongoDB query validation.
 * Provides syntax validation with warnings for the Monaco editor.
 *
 * Returns validation diagnostics in the format expected by Monaco:
 * { message, startLine, startCol, endLine, endCol, severity }
 *
 * Severity levels:
 * - 8: Error (red squiggles) - JSON syntax errors, critical issues
 * - 4: Warning (yellow squiggles) - Unknown operators, likely mistakes
 * - 2: Info (blue) - Suggestions
 */

import { shellToJson } from './queryParser'

/**
 * Severity levels for diagnostics
 */
export type DiagnosticSeverity = 8 | 4 | 2

/**
 * Diagnostic object returned by validateQuery
 */
export interface QueryDiagnostic {
  /** Description of the issue */
  message: string
  /** Severity level: 8 (error), 4 (warning), or 2 (info) */
  severity: DiagnosticSeverity
  /** Start line number (1-indexed) */
  startLine: number
  /** Start column number (1-indexed) */
  startCol: number
  /** End line number (1-indexed) */
  endLine: number
  /** End column number (1-indexed) */
  endCol: number
}

/**
 * Monaco marker object for editor integration
 */
export interface MonacoMarker {
  severity: number
  message: string
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

/**
 * Monaco editor instance interface (minimal required properties)
 */
export interface MonacoInstance {
  MarkerSeverity: {
    Error: number
    Warning: number
    Info: number
  }
}

/**
 * Position in text (1-indexed)
 */
interface TextPosition {
  line: number
  column: number
}

/**
 * Result of JSON parsing with detailed error information
 */
interface ParseJsonResult {
  success: boolean
  error?: {
    message: string
    index: number
  }
}

/**
 * Result of extracting JSON from a query string
 */
interface ExtractedJson {
  json: string | null
  offset: number
}

/**
 * Operator information found in query
 */
interface OperatorInfo {
  operator: string
  index: number
  line: number
  column: number
  length: number
}

// Valid MongoDB query operators (exported for testing)
export const VALID_QUERY_OPERATORS: Set<string> = new Set([
  // Comparison
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin',
  // Logical
  '$and', '$or', '$not', '$nor',
  // Element
  '$exists', '$type',
  // Evaluation
  '$expr', '$jsonSchema', '$mod', '$regex', '$text', '$where',
  // Array
  '$all', '$elemMatch', '$size',
  // Geospatial
  '$geoIntersects', '$geoWithin', '$near', '$nearSphere',
  '$box', '$center', '$centerSphere', '$geometry', '$maxDistance', '$minDistance', '$polygon',
  // Bitwise
  '$bitsAllClear', '$bitsAllSet', '$bitsAnyClear', '$bitsAnySet',
  // Misc
  '$comment', '$meta', '$natural', '$rand', '$sampleRate', '$slice',
  // Update operators (for queries using them)
  '$set', '$unset', '$inc', '$push', '$pull', '$addToSet', '$pop', '$rename',
  '$bit', '$min', '$max', '$mul', '$currentDate', '$setOnInsert',
  '$each', '$position', '$sort',
  // Aggregation operators commonly seen in queries
  '$match', '$project', '$group', '$sort', '$limit', '$skip', '$unwind',
  '$lookup', '$graphLookup', '$facet', '$bucket', '$bucketAuto', '$count',
  '$addFields', '$replaceRoot', '$replaceWith', '$merge', '$out', '$sample',
  '$redact', '$sortByCount', '$unionWith', '$setWindowFields',
  // Expression operators
  '$abs', '$add', '$ceil', '$divide', '$exp', '$floor', '$ln', '$log', '$log10',
  '$mod', '$multiply', '$pow', '$round', '$sqrt', '$subtract', '$trunc',
  '$concat', '$indexOfBytes', '$indexOfCP', '$ltrim', '$rtrim', '$regexFind',
  '$regexFindAll', '$regexMatch', '$split', '$strLenBytes', '$strLenCP',
  '$strcasecmp', '$substrBytes', '$substrCP', '$toLower', '$toString', '$toUpper', '$trim',
  '$arrayElemAt', '$arrayToObject', '$concatArrays', '$filter', '$first', '$in',
  '$indexOfArray', '$isArray', '$last', '$map', '$objectToArray', '$range',
  '$reduce', '$reverseArray', '$zip',
  '$cond', '$ifNull', '$switch',
  '$convert', '$toBool', '$toDate', '$toDecimal', '$toDouble', '$toInt', '$toLong', '$toObjectId',
  '$year', '$month', '$dayOfMonth', '$dayOfWeek', '$dayOfYear', '$hour', '$minute', '$second', '$millisecond',
  '$dateFromParts', '$dateFromString', '$dateToParts', '$dateToString',
  // Projection operators
  '$elemMatch', '$meta', '$slice',
  // Extended JSON type wrappers
  '$oid', '$binary', '$date', '$numberInt', '$numberLong', '$numberDouble', '$numberDecimal',
  '$regex', '$timestamp', '$undefined', '$minKey', '$maxKey', '$uuid',
])

// Common typos for operators
const OPERATOR_TYPOS: Record<string, string> = {
  '$eqq': '$eq',
  '$neq': '$ne',
  '$gte': '$gte', // correct
  '$gtt': '$gt',
  '$ltt': '$lt',
  '$lte': '$lte', // correct
  '$inn': '$in',
  '$ninn': '$nin',
  '$andd': '$and',
  '$orr': '$or',
  '$nott': '$not',
  '$norr': '$nor',
  '$exsits': '$exists',
  '$exisits': '$exists',
  '$exist': '$exists',
  '$tpye': '$type',
  '$typee': '$type',
  '$rege': '$regex',
  '$regx': '$regex',
  '$regEx': '$regex',
  '$regexp': '$regex',
  '$elemmatch': '$elemMatch',
  '$eleMatch': '$elemMatch',
  '$eachh': '$each',
  '$pussh': '$push',
  '$pulll': '$pull',
  '$sett': '$set',
  '$unsett': '$unset',
  '$incc': '$inc',
  '$minn': '$min',
  '$maxx': '$max',
}

/**
 * Find the position of a substring in a multiline string.
 * Returns { line, column } (1-indexed for Monaco).
 */
function findPosition(text: string, index: number): TextPosition {
  const lines = text.substring(0, index).split('\n')
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  }
}

/**
 * Parse JSON with detailed error information.
 * Uses shellToJson to handle mongosh syntax (ObjectId(), ISODate(), regex, etc.)
 * before attempting JSON.parse.
 * Returns { success: boolean, error?: { message, index } }
 */
function parseJsonWithDetails(text: string): ParseJsonResult {
  // First, try to parse as strict JSON
  try {
    JSON.parse(text)
    return { success: true }
  } catch {
    // Try converting MongoDB shell style to strict JSON
  }

  // Convert mongosh syntax (constructors, regex, unquoted keys, single quotes) then parse
  try {
    const converted = shellToJson(text)
    JSON.parse(converted)
    return { success: true }
  } catch (e) {
    // Extract position from error message if available
    const error = e as Error
    const match = error.message.match(/position\s+(\d+)/i)
    const index = match ? parseInt(match[1], 10) : 0
    return {
      success: false,
      error: {
        message: error.message,
        index,
      },
    }
  }
}

/**
 * Extract the matched content from within parentheses, handling nesting.
 * Returns the content up to the matching closing paren.
 */
function extractBalancedContent(text: string, startChar: string, endChar: string): string {
  let processedText = text
  if (!processedText.startsWith(startChar) && !processedText.trim().startsWith(startChar)) {
    // Find the first occurrence
    const idx = processedText.indexOf(startChar)
    if (idx === -1) return processedText.trim()
    processedText = processedText.substring(idx)
  }

  let depth = 0
  let inString = false
  let stringChar: string | null = null
  let endIndex = processedText.length

  for (let i = 0; i < processedText.length; i++) {
    const char = processedText[i]
    const prevChar = i > 0 ? processedText[i - 1] : ''

    // Handle string boundaries
    if ((char === '"' || char === "'") && prevChar !== '\\') {
      if (!inString) {
        inString = true
        stringChar = char
      } else if (char === stringChar) {
        inString = false
        stringChar = null
      }
    }

    if (!inString) {
      if (char === startChar) depth++
      if (char === endChar) {
        depth--
        if (depth === 0) {
          endIndex = i + 1
          break
        }
      }
    }
  }

  return processedText.substring(0, endIndex)
}

/**
 * Extract the JSON/object portion from a MongoDB query string.
 * Returns { json: string, offset: number } where offset is the character position
 * where the JSON starts in the original string.
 */
function extractJsonFromQuery(query: string): ExtractedJson {
  const trimmed = query.trim()

  // If it starts with { or [, it's a raw filter/array
  if (trimmed.startsWith('{')) {
    const balanced = extractBalancedContent(trimmed, '{', '}')
    return { json: balanced, offset: query.indexOf('{') }
  }
  if (trimmed.startsWith('[')) {
    const balanced = extractBalancedContent(trimmed, '[', ']')
    return { json: balanced, offset: query.indexOf('[') }
  }

  // Try to extract from .find(...), .aggregate([...]), etc.
  const patterns: RegExp[] = [
    /\.find\s*\(\s*/,
    /\.aggregate\s*\(\s*/,
    /\.findOne\s*\(\s*/,
    /\.updateOne\s*\(\s*/,
    /\.updateMany\s*\(\s*/,
    /\.deleteOne\s*\(\s*/,
    /\.deleteMany\s*\(\s*/,
    /\.insertOne\s*\(\s*/,
    /\.insertMany\s*\(\s*/,
    /\.replaceOne\s*\(\s*/,
  ]

  for (const pattern of patterns) {
    const match = trimmed.match(pattern)
    if (match && match.index !== undefined) {
      const start = match.index + match[0].length
      // Find the matching closing bracket/brace
      const remaining = trimmed.substring(start)
      const firstChar = remaining.trim()[0]
      if (firstChar === '{') {
        const actualStart = start + remaining.indexOf('{')
        const json = extractBalancedContent(remaining.trim(), '{', '}')
        return {
          json,
          offset: query.indexOf(trimmed) + actualStart,
        }
      }
      if (firstChar === '[') {
        const actualStart = start + remaining.indexOf('[')
        const json = extractBalancedContent(remaining.trim(), '[', ']')
        return {
          json,
          offset: query.indexOf(trimmed) + actualStart,
        }
      }
    }
  }

  // No recognizable pattern
  return { json: null, offset: 0 }
}

/**
 * Find all MongoDB operators (strings starting with $) in the query.
 * Returns array of { operator, index, line, column }.
 */
function findOperators(text: string): OperatorInfo[] {
  const operators: OperatorInfo[] = []
  // Match $word that's not inside a string (simplified - may have edge cases)
  const regex = /"\$([a-zA-Z_][a-zA-Z0-9_]*)"|'\$([a-zA-Z_][a-zA-Z0-9_]*)'|\$([a-zA-Z_][a-zA-Z0-9_]*)/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    // If captured in group 1 or 2, it's inside a quoted string (key name)
    // If captured in group 3, it's unquoted
    const operator = '$' + (match[1] || match[2] || match[3])
    const pos = findPosition(text, match.index)

    // Adjust column for quoted operators
    const actualIndex = match[1] || match[2] ? match.index + 1 : match.index

    operators.push({
      operator,
      index: actualIndex,
      line: pos.line,
      column: match[1] || match[2] ? pos.column + 1 : pos.column,
      length: operator.length,
    })
  }

  return operators
}

/**
 * Check for common mistakes in the query text.
 * Returns array of diagnostic objects.
 */
function checkCommonMistakes(text: string): QueryDiagnostic[] {
  const diagnostics: QueryDiagnostic[] = []

  // Check for trailing commas before closing brackets
  // Match: , followed by optional whitespace and } or ]
  const trailingCommaRegex = /,(\s*)([\}\]])/g
  let match: RegExpExecArray | null
  while ((match = trailingCommaRegex.exec(text)) !== null) {
    const pos = findPosition(text, match.index)
    diagnostics.push({
      message: 'Trailing comma before closing bracket (not valid in strict JSON)',
      severity: 4, // Warning
      startLine: pos.line,
      startCol: pos.column,
      endLine: pos.line,
      endCol: pos.column + 1,
    })
  }

  // Check for string "true" or "false" which might be intended as boolean
  const stringBoolRegex = /:\s*"(true|false)"/gi
  while ((match = stringBoolRegex.exec(text)) !== null) {
    const value = match[1]
    const pos = findPosition(text, match.index + match[0].indexOf('"'))
    const endPos = findPosition(text, match.index + match[0].length - 1)
    diagnostics.push({
      message: `String "${value}" found - did you mean the boolean ${value} (without quotes)?`,
      severity: 4, // Warning
      startLine: pos.line,
      startCol: pos.column,
      endLine: endPos.line,
      endCol: endPos.column + 1,
    })
  }

  // Check for string "null" which might be intended as null
  const stringNullRegex = /:\s*"null"/gi
  while ((match = stringNullRegex.exec(text)) !== null) {
    const pos = findPosition(text, match.index + match[0].indexOf('"'))
    const endPos = findPosition(text, match.index + match[0].length - 1)
    diagnostics.push({
      message: 'String "null" found - did you mean null (without quotes)?',
      severity: 4, // Warning
      startLine: pos.line,
      startCol: pos.column,
      endLine: endPos.line,
      endCol: endPos.column + 1,
    })
  }

  // Check for single-quoted strings (not valid JSON)
  const singleQuoteRegex = /'([^'\\]|\\.)*'/g
  while ((match = singleQuoteRegex.exec(text)) !== null) {
    // Skip if it looks like it's inside a regex pattern
    const before = text.substring(Math.max(0, match.index - 10), match.index)
    if (before.includes('$regex')) continue

    const pos = findPosition(text, match.index)
    diagnostics.push({
      message: 'Single quotes are not valid JSON - use double quotes instead',
      severity: 4, // Warning
      startLine: pos.line,
      startCol: pos.column,
      endLine: pos.line,
      endCol: pos.column + match[0].length,
    })
  }

  return diagnostics
}

/**
 * Validate a MongoDB query string.
 *
 * @param query - The query string to validate
 * @returns Array of diagnostic objects with:
 *   - message: Description of the issue
 *   - severity: 8 (error), 4 (warning), or 2 (info)
 *   - startLine, startCol, endLine, endCol: Position (1-indexed)
 */
export function validateQuery(query: unknown): QueryDiagnostic[] {
  if (!query || typeof query !== 'string') {
    return []
  }

  const trimmed = query.trim()
  if (!trimmed) {
    return []
  }

  const diagnostics: QueryDiagnostic[] = []

  // Extract the JSON portion from the query
  const { json, offset } = extractJsonFromQuery(trimmed)

  if (json) {
    // Check if it looks like a JSON object or array
    const isJsonLike = json.startsWith('{') || json.startsWith('[')

    if (isJsonLike) {
      // Try to parse as JSON
      const parseResult = parseJsonWithDetails(json)

      if (!parseResult.success && parseResult.error) {
        // JSON parse error
        const errorPos = findPosition(query, offset + (parseResult.error.index || 0))

        // Clean up error message
        let message = parseResult.error.message
        message = message.replace(/^JSON\.parse:\s*/i, '')
        message = message.replace(/at position \d+/i, '').trim()

        diagnostics.push({
          message: `JSON syntax error: ${message}`,
          severity: 8, // Error
          startLine: errorPos.line,
          startCol: errorPos.column,
          endLine: errorPos.line,
          endCol: errorPos.column + 1,
        })
      }
    }

    // Check for common mistakes (regardless of JSON validity)
    const mistakeDiagnostics = checkCommonMistakes(json)
    for (const diag of mistakeDiagnostics) {
      // Adjust positions based on offset
      const lines = query.substring(0, offset).split('\n')
      const offsetLine = lines.length - 1
      const offsetCol = lines[lines.length - 1].length

      if (diag.startLine === 1) {
        diag.startCol += offsetCol
        diag.endCol += offsetCol
      }
      diag.startLine += offsetLine
      diag.endLine += offsetLine

      diagnostics.push(diag)
    }

    // Find and validate operators
    const operators = findOperators(json)
    for (const op of operators) {
      if (!VALID_QUERY_OPERATORS.has(op.operator)) {
        // Check if it's a known typo
        const suggestion = OPERATOR_TYPOS[op.operator.toLowerCase()]

        // Adjust position based on offset
        const lines = query.substring(0, offset).split('\n')
        const offsetLine = lines.length - 1
        const offsetCol = lines[lines.length - 1].length

        let startLine = op.line + offsetLine
        let startCol = op.column
        if (op.line === 1) {
          startCol += offsetCol
        }

        const message = suggestion
          ? `Unknown operator "${op.operator}" - did you mean "${suggestion}"?`
          : `Unknown operator "${op.operator}" - this may not be a valid MongoDB operator`

        diagnostics.push({
          message,
          severity: 4, // Warning
          startLine,
          startCol,
          endLine: startLine,
          endCol: startCol + op.length,
        })
      }
    }
  }

  // Check for unclosed brackets in the full query
  const openBrackets: Record<string, number> = { '{': 0, '[': 0, '(': 0 }
  const closeBrackets: Record<string, string> = { '}': '{', ']': '[', ')': '(' }
  let inString = false
  let stringChar: string | null = null

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i]
    const prevChar = i > 0 ? trimmed[i - 1] : ''

    // Handle string boundaries
    if ((char === '"' || char === "'") && prevChar !== '\\') {
      if (!inString) {
        inString = true
        stringChar = char
      } else if (char === stringChar) {
        inString = false
        stringChar = null
      }
    }

    if (!inString) {
      if (char in openBrackets) {
        openBrackets[char]++
      } else if (char in closeBrackets) {
        openBrackets[closeBrackets[char]]--
      }
    }
  }

  // Report unmatched brackets
  for (const [bracket, count] of Object.entries(openBrackets)) {
    if (count > 0) {
      const bracketName = bracket === '{' ? 'brace' : bracket === '[' ? 'bracket' : 'parenthesis'
      diagnostics.push({
        message: `Unclosed ${bracketName} - missing ${count} closing '${bracket === '{' ? '}' : bracket === '[' ? ']' : ')'}'`,
        severity: 8, // Error
        startLine: 1,
        startCol: 1,
        endLine: 1,
        endCol: 2,
      })
    } else if (count < 0) {
      const bracketName = bracket === '{' ? 'brace' : bracket === '[' ? 'bracket' : 'parenthesis'
      diagnostics.push({
        message: `Extra closing ${bracketName} - ${Math.abs(count)} unmatched '${bracket === '{' ? '}' : bracket === '[' ? ']' : ')'}'`,
        severity: 8, // Error
        startLine: 1,
        startCol: 1,
        endLine: 1,
        endCol: 2,
      })
    }
  }

  return diagnostics
}

/**
 * Convert validation diagnostics to Monaco editor markers.
 *
 * @param monaco - The Monaco editor instance
 * @param diagnostics - Array of diagnostic objects from validateQuery
 * @returns Array of Monaco marker objects
 */
export function toMonacoMarkers(monaco: MonacoInstance | null | undefined, diagnostics: QueryDiagnostic[] | null | undefined): MonacoMarker[] {
  if (!monaco || !diagnostics) {
    return []
  }

  return diagnostics.map(diag => ({
    severity: diag.severity === 8
      ? monaco.MarkerSeverity.Error
      : diag.severity === 4
        ? monaco.MarkerSeverity.Warning
        : monaco.MarkerSeverity.Info,
    message: diag.message,
    startLineNumber: diag.startLine,
    startColumn: diag.startCol,
    endLineNumber: diag.endLine,
    endColumn: diag.endCol,
  }))
}

export default {
  validateQuery,
  toMonacoMarkers,
  VALID_QUERY_OPERATORS,
}
