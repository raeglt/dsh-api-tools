/**
 * DSH 要求工具返回值是「无损 JSON」：一个能 JSON.stringify → JSON.parse 后
 * 与原值完全一致的结构。
 *
 * 常见破坏者：
 * - `undefined`（对象属性会被丢掉、数组元素会变成 null）
 * - 非有限数字（NaN / Infinity → null）
 * - 函数、Symbol、BigInt
 * - Date / Map / Set 等类实例（会变成字符串或 `{}`）
 *
 * 工具返回前过一遍这里，就不会再出现
 * `tool "..." returned invalid output: value is not lossless JSON`。
 */

/** 判断一个值是否已经是无损 JSON（够用即可，不追求极致性能）。 */
export function isLosslessJson(value, seen = new Set()) {
  if (value === null) return true
  const type = typeof value
  if (type === 'string' || type === 'boolean') return true
  if (type === 'number') return Number.isFinite(value) && !Object.is(value, -0)
  if (type !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  const ok = Array.isArray(value)
    ? value.every((item) => isLosslessJson(item, seen))
    : (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
      Object.values(value).every((item) => isLosslessJson(item, seen))
  seen.delete(value)
  return ok
}

/**
 * 把任意值整理成无损 JSON。
 * - 对象里的 `undefined` / 函数 / Symbol 属性直接删掉
 * - 数组里的这类元素变成 `null`
 * - `NaN` / `Infinity` / `-0` → `null`
 * - 循环引用 → `"[Circular]"`
 */
export function jsonSafe(value, stack = []) {
  if (value === null) return null
  const type = typeof value
  if (type === 'string' || type === 'boolean') return value
  if (type === 'number') return Number.isFinite(value) && !Object.is(value, -0) ? value : null
  if (type === 'bigint') return value.toString()
  if (type === 'undefined' || type === 'function' || type === 'symbol') return undefined
  if (type !== 'object') return String(value)
  if (stack.includes(value)) return '[Circular]'

  stack.push(value)
  let result
  if (Array.isArray(value)) {
    result = value.map((item) => {
      const safe = jsonSafe(item, stack)
      return safe === undefined ? null : safe
    })
  } else if (value instanceof Date) {
    result = Number.isNaN(value.getTime()) ? null : value.toISOString()
  } else {
    result = {}
    for (const [key, item] of Object.entries(value)) {
      const safe = jsonSafe(item, stack)
      if (safe !== undefined) result[key] = safe
    }
  }
  stack.pop()
  return result
}
