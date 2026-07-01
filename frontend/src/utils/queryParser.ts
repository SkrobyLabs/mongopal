/**
 * Result of splitting find() arguments into filter and projection
 */
export interface SplitFindResult {
  filter: string
  projection: string | null
}

interface FindInvocationResult {
  args: string
  endIndex: number
}

/**
 * Result of parsing a variable assignment statement
 */
interface VariableAssignmentResult {
  isAssignment: boolean
  varName: string | null
  hasWriteOp: boolean
}

/**
 * Result of splitting a script into prefix and last statement
 */
interface LastStatementResult {
  prefix: string
  lastStatement: string
}

/**
 * Read a regex literal starting at the opening /. Returns pattern, flags,
 * and the index of the last consumed character, or null if not a valid regex.
 */
function readRegexLiteral(input: string, startIndex: number): { pattern: string; flags: string; endIndex: number } | null {
  let i = startIndex + 1
  let pattern = ''

  while (i < input.length) {
    const char = input[i]
    if (char === '\\' && i + 1 < input.length) {
      pattern += char + input[i + 1]
      i += 2
      continue
    }
    if (char === '/') break
    if (char === '\n') return null
    pattern += char
    i++
  }

  if (i >= input.length || pattern === '') return null

  let flags = ''
  i++ // skip closing /
  while (i < input.length && /[gimsuy]/.test(input[i])) {
    flags += input[i]
    i++
  }

  return { pattern, flags, endIndex: i - 1 }
}

/**
 * Convert mongosh constructor calls to Extended JSON equivalents.
 * Handles: ObjectId(), ISODate(), new Date(), NumberInt(), NumberLong(),
 * NumberDouble(), NumberDecimal(), UUID(), Timestamp(), MinKey(), MaxKey().
 * Only converts outside of quoted strings.
 */
export function convertMongoshConstructors(input: string): string {
  let result = ''
  let inString = false
  let stringChar: string | null = null

  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    const prevChar = i > 0 ? input[i - 1] : ''

    // Track string state
    if ((char === '"' || char === "'") && prevChar !== '\\') {
      if (!inString) {
        inString = true
        stringChar = char
      } else if (char === stringChar) {
        inString = false
        stringChar = null
      }
      result += char
      continue
    }

    if (inString) {
      result += char
      continue
    }

    // Try to match "new Date(" at current position
    if (char === 'n' && input.slice(i, i + 4) === 'new ') {
      const afterNew = input.slice(i + 4).match(/^Date\s*\(/)
      if (afterNew) {
        const parenStart = i + 4 + afterNew[0].length
        const arg = extractParenArg(input, parenStart - 1)
        if (arg !== null) {
          const val = arg.value.replace(/^["']|["']$/g, '')
          result += '{"$date": "' + val + '"}'
          i = arg.endIndex
          continue
        }
      }
    }

    // Try to match constructor patterns: Name(...)
    const constructorMatch = input.slice(i).match(/^(ObjectId|ISODate|NumberInt|NumberLong|NumberDouble|NumberDecimal|UUID|Timestamp|MinKey|MaxKey)\s*\(/)
    if (constructorMatch) {
      const name = constructorMatch[1]
      const parenStart = i + constructorMatch[0].length - 1
      const arg = extractParenArg(input, parenStart)
      if (arg !== null) {
        const replacement = mongoshToExtendedJson(name, arg.value)
        if (replacement !== null) {
          result += replacement
          i = arg.endIndex
          continue
        }
      }
    }

    result += char
  }

  return result
}

/**
 * Extract the content inside parentheses starting at parenIndex (the '(' character).
 * Returns the raw content string and the index of the closing ')'.
 */
function extractParenArg(input: string, parenIndex: number): { value: string; endIndex: number } | null {
  if (input[parenIndex] !== '(') return null
  let depth = 1
  let i = parenIndex + 1
  let inString = false
  let stringChar: string | null = null

  while (i < input.length && depth > 0) {
    const char = input[i]
    const prevChar = i > 0 ? input[i - 1] : ''

    if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
      if (!inString) {
        inString = true
        stringChar = char
      } else if (char === stringChar) {
        inString = false
        stringChar = null
      }
      i++
      continue
    }

    if (inString) {
      i++
      continue
    }

    if (char === '(') depth++
    else if (char === ')') depth--
    i++
  }
  if (depth !== 0) return null
  const value = input.slice(parenIndex + 1, i - 1).trim()
  return { value, endIndex: i - 1 }
}

function extractFindInvocation(input: string): FindInvocationResult | null {
  const findMatch = input.match(/\.find\s*\(/)
  if (!findMatch || findMatch.index === undefined) return null

  const parenIndex = findMatch.index + findMatch[0].lastIndexOf('(')
  const arg = extractParenArg(input, parenIndex)
  if (!arg) return null

  return { args: arg.value, endIndex: arg.endIndex }
}

function extractChainedMethodArg(input: string, method: string, startIndex: number): string | null {
  let i = startIndex + 1

  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i])) i++

    if (input[i] !== '.') return null
    i++

    const nameStart = i
    while (i < input.length && /[a-zA-Z_$]/.test(input[i])) i++
    const name = input.slice(nameStart, i)

    while (i < input.length && /\s/.test(input[i])) i++
    if (input[i] !== '(') return null

    const arg = extractParenArg(input, i)
    if (!arg) return null

    if (name === method) return arg.value

    i = arg.endIndex + 1
  }

  return null
}

function hasOnlySupportedFindChains(input: string, startIndex: number): boolean {
  let i = startIndex + 1

  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i])) i++
    if (i >= input.length) return true

    if (input[i] !== '.') return false
    i++

    const nameStart = i
    while (i < input.length && /[a-zA-Z_$]/.test(input[i])) i++
    const name = input.slice(nameStart, i)
    if (name !== 'sort' && name !== 'limit') return false

    while (i < input.length && /\s/.test(input[i])) i++
    if (input[i] !== '(') return false

    const arg = extractParenArg(input, i)
    if (!arg) return false
    i = arg.endIndex + 1
  }

  return true
}

/**
 * Convert a mongosh constructor name and its argument to Extended JSON.
 */
function mongoshToExtendedJson(name: string, rawArg: string): string | null {
  // Strip quotes from string arguments
  const arg = rawArg.replace(/^["']|["']$/g, '')

  switch (name) {
    case 'ObjectId':
      return '{"$oid": "' + arg + '"}'
    case 'ISODate':
      return '{"$date": "' + arg + '"}'
    case 'NumberInt':
      return '{"$numberInt": "' + arg + '"}'
    case 'NumberLong':
      return '{"$numberLong": "' + arg + '"}'
    case 'NumberDouble':
      return '{"$numberDouble": "' + arg + '"}'
    case 'NumberDecimal':
      return '{"$numberDecimal": "' + arg + '"}'
    case 'UUID':
      return '{"$uuid": "' + arg + '"}'
    case 'Timestamp': {
      // Timestamp(t, i) — two numeric arguments
      const parts = rawArg.split(',').map(s => s.trim())
      if (parts.length === 2) {
        return '{"$timestamp": {"t": ' + parts[0] + ', "i": ' + parts[1] + '}}'
      }
      return null
    }
    case 'MinKey':
      return '{"$minKey": 1}'
    case 'MaxKey':
      return '{"$maxKey": 1}'
    default:
      return null
  }
}

/**
 * Convert JS regex literals to $regex objects in a shell query string.
 * /pattern/ → {"$regex": "pattern"}
 * /pattern/i → {"$regex": "pattern", "$options": "i"}
 * Only converts in value positions (after : , [ () to avoid false positives.
 */
export function convertRegexLiterals(input: string): string {
  let result = ''
  let inString = false
  let stringChar: string | null = null

  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    const prevChar = i > 0 ? input[i - 1] : ''

    if ((char === '"' || char === "'") && prevChar !== '\\') {
      if (!inString) {
        inString = true
        stringChar = char
      } else if (char === stringChar) {
        inString = false
        stringChar = null
      }
      result += char
      continue
    }

    if (inString) {
      result += char
      continue
    }

    if (char === '/') {
      const trimmed = result.replace(/\s+$/, '')
      const lastChar = trimmed[trimmed.length - 1]
      if (lastChar === ':' || lastChar === ',' || lastChar === '[' || lastChar === '(') {
        const regex = readRegexLiteral(input, i)
        if (regex) {
          const escaped = regex.pattern.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
          let replacement = '{"$regex": "' + escaped + '"'
          if (regex.flags) {
            replacement += ', "$options": "' + regex.flags + '"'
          }
          replacement += '}'
          result += replacement
          i = regex.endIndex
          continue
        }
      }
    }

    result += char
  }

  return result
}

/**
 * Convert MongoDB shell syntax to valid JSON.
 * Handles unquoted keys like {_id: "value"} -> {"_id": "value"},
 * single-quoted strings like {'key': 'value'} -> {"key": "value"},
 * and regex literals like /pattern/i -> {"$regex": "pattern", "$options": "i"}
 */
export function shellToJson(shellSyntax: string | null | undefined): string {
  if (!shellSyntax || shellSyntax === '{}') return shellSyntax || ''

  // First try to parse as JSON - if it works, it's already valid
  try {
    JSON.parse(shellSyntax)
    return shellSyntax // Already valid JSON
  } catch {
    // Not valid JSON, needs conversion
  }

  // Convert mongosh constructors and regex literals before other shell syntax conversions
  const result = convertRegexLiterals(convertMongoshConstructors(shellSyntax))
  let inString = false
  let stringChar: string | null = null
  let output = ''

  for (let i = 0; i < result.length; i++) {
    const char = result[i]
    const prevChar = i > 0 ? result[i - 1] : ''

    // Handle string boundaries
    if ((char === '"' || char === "'") && prevChar !== '\\') {
      if (!inString) {
        inString = true
        stringChar = char
        // Convert single quotes to double quotes for JSON
        output += '"'
        continue
      } else if (char === stringChar) {
        inString = false
        stringChar = null
        output += '"'
        continue
      }
    }

    if (inString) {
      // Escape double quotes inside strings if we converted from single quotes
      if (char === '"' && stringChar === "'") {
        output += '\\"'
      } else {
        output += char
      }
      continue
    }

    // Outside of strings: look for unquoted keys
    // Pattern: start of object or after comma, optional whitespace, then identifier followed by colon
    if (char === '{' || char === ',') {
      output += char
      // Skip whitespace after { or ,
      let j = i + 1
      while (j < result.length && /\s/.test(result[j])) {
        output += result[j]
        j++
      }
      // Check if next token is an unquoted key (identifier followed by colon)
      if (j < result.length) {
        const remaining = result.slice(j)
        const keyMatch = remaining.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/)
        if (keyMatch) {
          // Found unquoted key - quote it
          output += '"' + keyMatch[1] + '"'
          i = j + keyMatch[1].length - 1 // -1 because loop will increment
          continue
        }
      }
      i = j - 1 // -1 because loop will increment
      continue
    }

    output += char
  }

  return output
}

/**
 * Check if a query is a simple find that can be handled by the Go driver
 * Returns true for: empty, filter objects, or proper db.x.find({...}) syntax
 */
export function isSimpleFindQuery(query: string | null | undefined): boolean {
  const trimmed = (query || '').trim()
  // Empty or just a filter object - Go driver can handle
  if (!trimmed || trimmed.startsWith('{')) return true
  // Multi-statement scripts are not simple queries
  if (trimmed.includes(';')) return false
  const find = extractFindInvocation(trimmed)
  if (!find) return false
  return hasOnlySupportedFindChains(trimmed, find.endIndex)
}

/**
 * Split find() arguments into filter and projection, respecting nested braces
 * Returns { filter, projection } where projection may be null
 */
function splitFindArguments(argsStr: string): SplitFindResult {
  const trimmed = argsStr.trim()
  if (!trimmed) return { filter: '{}', projection: null }

  // Track brace depth to find the comma that separates filter from projection
  let depth = 0
  let inString = false
  let stringChar: string | null = null
  let splitIndex = -1

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
      continue
    }

    if (inString) continue

    // Track brace/bracket depth
    if (char === '{' || char === '[') depth++
    if (char === '}' || char === ']') depth--

    // Found top-level comma - this separates filter from projection
    if (char === ',' && depth === 0) {
      splitIndex = i
      break
    }
  }

  if (splitIndex === -1) {
    // No projection, just filter
    return { filter: trimmed || '{}', projection: null }
  }

  const filter = trimmed.slice(0, splitIndex).trim() || '{}'
  const projection = trimmed.slice(splitIndex + 1).trim() || null

  return { filter, projection }
}

/**
 * Parse filter from full MongoDB query string like db.getCollection("col").find({...})
 * Extracts the filter, converts shell syntax to JSON, and sends to backend
 */
export function parseFilterFromQuery(queryStr: string): string {
  const trimmed = queryStr.trim()

  // Handle empty input
  if (!trimmed) {
    return '{}'
  }

  // If it's just a filter object, convert and return
  if (trimmed.startsWith('{')) {
    return shellToJson(trimmed)
  }

  // Try to extract content from .find(...) using balanced parentheses.
  // This handles both db.getCollection("x").find({}) and db.collection.find({})
  const find = extractFindInvocation(trimmed)
  if (find) {
    if (!find.args) return '{}'
    // Split into filter and projection, return only filter (converted to JSON)
    const { filter } = splitFindArguments(find.args)
    return shellToJson(filter)
  }

  // If contains .find but no parentheses, send empty string to let backend error
  if (trimmed.includes('.find')) {
    return ''
  }

  // Fallback - convert and let backend handle it
  return shellToJson(trimmed) || '{}'
}

/**
 * Parse projection from full MongoDB query string
 * Returns null if no projection specified
 */
export function parseProjectionFromQuery(queryStr: string): string | null {
  const trimmed = queryStr.trim()

  // Handle empty input or plain filter objects (no projection possible)
  if (!trimmed || trimmed.startsWith('{')) {
    return null
  }

  const find = extractFindInvocation(trimmed)
  if (find) {
    if (!find.args) return null
    const { projection } = splitFindArguments(find.args)
    // Convert projection to JSON if present
    return projection ? shellToJson(projection) : null
  }

  return null
}

export function parseSortFromQuery(queryStr: string): string {
  const trimmed = queryStr.trim()
  const find = extractFindInvocation(trimmed)
  if (!find) return ''

  const sortArg = extractChainedMethodArg(trimmed, 'sort', find.endIndex)
  return sortArg ? shellToJson(sortArg) : ''
}

export function parseLimitFromQuery(queryStr: string): number | null {
  const trimmed = queryStr.trim()
  const find = extractFindInvocation(trimmed)
  if (!find) return null

  const limitArg = extractChainedMethodArg(trimmed, 'limit', find.endIndex)
  if (!limitArg || !/^\d+$/.test(limitArg.trim())) return null

  const parsed = Number.parseInt(limitArg.trim(), 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * Build full MongoDB query string for display
 */
export function buildFullQuery(collection: string, filter: string, projection?: string): string {
  if (projection) {
    return `db.getCollection("${collection}").find(${filter}, ${projection})`
  }
  return `db.getCollection("${collection}").find(${filter})`
}

// Write operations that don't automatically print output in mongosh --eval
const WRITE_OPERATIONS: readonly string[] = [
  'insertOne', 'insertMany',
  'updateOne', 'updateMany',
  'deleteOne', 'deleteMany',
  'replaceOne', 'bulkWrite',
  'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'drop', 'createIndex', 'dropIndex', 'dropIndexes',
  'createCollection', 'renameCollection'
]

/**
 * Check if script already has output mechanisms
 */
function hasOutputMechanism(script: string): boolean {
  return /printjson\s*\(|print\s*\(|console\.log\s*\(|\.toArray\s*\(\s*\)/.test(script)
}

/**
 * Find the last statement in a script (splits by semicolon, respecting strings)
 */
function getLastStatement(script: string): LastStatementResult {
  const trimmed = script.trim()

  // Remove trailing semicolons and whitespace to find actual last statement
  const withoutTrailingSemicolons = trimmed.replace(/;\s*$/, '')

  let lastSemicolon = -1
  let inString = false
  let stringChar: string | null = null

  for (let i = 0; i < withoutTrailingSemicolons.length; i++) {
    const char = withoutTrailingSemicolons[i]
    const prevChar = i > 0 ? withoutTrailingSemicolons[i - 1] : ''

    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true
      stringChar = char
    } else if (inString && char === stringChar && prevChar !== '\\') {
      inString = false
      stringChar = null
    } else if (!inString && char === ';') {
      lastSemicolon = i
    }
  }

  if (lastSemicolon === -1) {
    return { prefix: '', lastStatement: withoutTrailingSemicolons }
  }

  return {
    prefix: withoutTrailingSemicolons.substring(0, lastSemicolon + 1),
    lastStatement: withoutTrailingSemicolons.substring(lastSemicolon + 1).trim()
  }
}

/**
 * Check if a statement ends with a write operation
 */
function endsWithWriteOperation(statement: string): boolean {
  const pattern = new RegExp(
    `\\.(${WRITE_OPERATIONS.join('|')})\\s*\\([^]*\\)\\s*;?\\s*$`
  )
  return pattern.test(statement)
}

/**
 * Check if statement is a variable assignment containing a write operation
 * Returns { isAssignment: boolean, varName: string | null, hasWriteOp: boolean }
 */
function parseVariableAssignment(statement: string): VariableAssignmentResult {
  // Match: var/let/const varName = ... writeOperation(...)
  const assignmentMatch = statement.match(/^(var|let|const)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/)
  if (!assignmentMatch) {
    return { isAssignment: false, varName: null, hasWriteOp: false }
  }

  const varName = assignmentMatch[2]
  const writeOpPattern = new RegExp(`\\.(${WRITE_OPERATIONS.join('|')})\\s*\\(`)
  const hasWriteOp = writeOpPattern.test(statement)

  return { isAssignment: true, varName, hasWriteOp }
}

/**
 * Find all variable assignments with write operations in the script
 */
function findAllWriteOpVariables(script: string): string[] {
  const variables: string[] = []

  // Split by semicolons, respecting strings
  let currentStatement = ''
  let inString = false
  let stringChar: string | null = null

  for (let i = 0; i < script.length; i++) {
    const char = script[i]
    const prevChar = i > 0 ? script[i - 1] : ''

    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true
      stringChar = char
    } else if (inString && char === stringChar && prevChar !== '\\') {
      inString = false
      stringChar = null
    }

    if (!inString && char === ';') {
      const trimmedStatement = currentStatement.trim()
      if (trimmedStatement) {
        const { isAssignment, varName, hasWriteOp } = parseVariableAssignment(trimmedStatement)
        if (isAssignment && hasWriteOp && varName) {
          variables.push(varName)
        }
      }
      currentStatement = ''
    } else {
      currentStatement += char
    }
  }

  // Handle last statement (no trailing semicolon)
  const trimmedStatement = currentStatement.trim()
  if (trimmedStatement) {
    const { isAssignment, varName, hasWriteOp } = parseVariableAssignment(trimmedStatement)
    if (isAssignment && hasWriteOp && varName) {
      variables.push(varName)
    }
  }

  return variables
}

/**
 * Wrap script with printjson if it contains write operations that don't produce output
 * @param script - The mongosh script
 * @returns Script with printjson wrapper if needed
 */
export function wrapScriptForOutput(script: string | null | undefined): string {
  const trimmed = (script || '').trim()

  // Empty script
  if (!trimmed) return trimmed

  // Already has output mechanism
  if (hasOutputMechanism(trimmed)) return trimmed

  // Get the last statement
  const { prefix, lastStatement } = getLastStatement(trimmed)

  // Find all variable assignments with write operations
  const writeOpVars = findAllWriteOpVariables(trimmed)

  if (writeOpVars.length > 1) {
    // Multiple write operation variables - print them all as an object
    const varsObj = writeOpVars.join(', ')
    return trimmed + '; printjson({ ' + varsObj + ' })'
  }

  if (writeOpVars.length === 1) {
    // Single write operation variable - print just that
    return trimmed + '; printjson(' + writeOpVars[0] + ')'
  }

  // Check if last statement is a direct write operation (not an assignment)
  if (lastStatement && endsWithWriteOperation(lastStatement)) {
    const { isAssignment } = parseVariableAssignment(lastStatement)
    if (!isAssignment) {
      // Remove trailing semicolon from last statement for wrapping
      const cleanLast = lastStatement.replace(/;\s*$/, '')
      return prefix + (prefix ? ' ' : '') + `printjson(${cleanLast})`
    }
  }

  return trimmed
}
