/**
 * Utilities for rendering canonical MongoDB Extended JSON in mongosh-style form.
 * The parser path remains canonical Extended JSON via shellToJson before data
 * reaches the Go backend.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKey(obj: Record<string, unknown>, key: string): boolean {
  return Object.keys(obj).length === 1 && Object.prototype.hasOwnProperty.call(obj, key)
}

function quote(value: string): string {
  return JSON.stringify(value)
}

function shellConstructorForExtendedJson(obj: Record<string, unknown>): string | null {
  if (hasOnlyKey(obj, '$oid') && typeof obj.$oid === 'string') {
    return `ObjectId(${quote(obj.$oid)})`
  }

  if (hasOnlyKey(obj, '$numberInt') && typeof obj.$numberInt === 'string') {
    return `NumberInt(${obj.$numberInt})`
  }

  if (hasOnlyKey(obj, '$numberLong') && typeof obj.$numberLong === 'string') {
    return `NumberLong(${quote(obj.$numberLong)})`
  }

  if (hasOnlyKey(obj, '$numberDouble') && typeof obj.$numberDouble === 'string') {
    return `NumberDouble(${quote(obj.$numberDouble)})`
  }

  if (hasOnlyKey(obj, '$numberDecimal') && typeof obj.$numberDecimal === 'string') {
    return `NumberDecimal(${quote(obj.$numberDecimal)})`
  }

  if (hasOnlyKey(obj, '$uuid') && typeof obj.$uuid === 'string') {
    return `UUID(${quote(obj.$uuid)})`
  }

  if (hasOnlyKey(obj, '$date')) {
    if (typeof obj.$date === 'string') {
      return `ISODate(${quote(obj.$date)})`
    }

    if (isPlainObject(obj.$date) && typeof obj.$date.$numberLong === 'string') {
      const millis = Number.parseInt(obj.$date.$numberLong, 10)
      if (!Number.isNaN(millis)) {
        return `ISODate(${quote(new Date(millis).toISOString())})`
      }
    }
  }

  if (hasOnlyKey(obj, '$timestamp') && isPlainObject(obj.$timestamp)) {
    const { t, i } = obj.$timestamp
    if (typeof t === 'number' && typeof i === 'number') {
      return `Timestamp(${t}, ${i})`
    }
  }

  if (hasOnlyKey(obj, '$minKey') && obj.$minKey === 1) {
    return 'MinKey()'
  }

  if (hasOnlyKey(obj, '$maxKey') && obj.$maxKey === 1) {
    return 'MaxKey()'
  }

  return null
}

function stringifyShell(value: unknown, depth: number, indent: number): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }

  if (typeof value === 'string') {
    return quote(value)
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'

    const currentIndent = ' '.repeat(depth * indent)
    const childIndent = ' '.repeat((depth + 1) * indent)
    const items = value.map(item => `${childIndent}${stringifyShell(item, depth + 1, indent)}`)
    return `[\n${items.join(',\n')}\n${currentIndent}]`
  }

  if (isPlainObject(value)) {
    const shellConstructor = shellConstructorForExtendedJson(value)
    if (shellConstructor) return shellConstructor

    const entries = Object.entries(value)
    if (entries.length === 0) return '{}'

    const currentIndent = ' '.repeat(depth * indent)
    const childIndent = ' '.repeat((depth + 1) * indent)
    const fields = entries.map(([key, fieldValue]) =>
      `${childIndent}${quote(key)}: ${stringifyShell(fieldValue, depth + 1, indent)}`
    )
    return `{\n${fields.join(',\n')}\n${currentIndent}}`
  }

  return JSON.stringify(value)
}

export function stringifyExtendedJsonShell(value: unknown, indent: number = 2): string {
  return stringifyShell(value, 0, indent)
}

export function formatExtendedJsonValue(value: unknown): string | null {
  return isPlainObject(value) ? shellConstructorForExtendedJson(value) : null
}
