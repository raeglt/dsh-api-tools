/**
 * HTTP 调用层：把归一化后的工具定义 + 模型给的参数，变成一个真实的 RESTful 请求。
 * 安全约束都在这里：路径参数强制 encode、不允许多余参数拼 URL、鉴权只从环境变量取。
 */

const SENSITIVE_QUERY = /^(api[_-]?key|apikey|token|access[_-]?token|secret|password|passwd|pwd|sig|signature)$/i

function resolveAuthValue(auth) {
  if (!auth || auth.type === 'none') return undefined
  if (typeof auth.value === 'string') return auth.value
  if (typeof auth.env === 'string') {
    const value = process.env[auth.env]
    if (typeof value !== 'string' || value === '') throw new Error(`环境变量 ${auth.env} 未设置，鉴权头无法注入`)
    return value
  }
  throw new Error('auth 配置缺少 value/env')
}

/** 打码：日志/返回值里不出现完整 URL 上的密钥。 */
export function redactUrl(url) {
  try {
    const parsed = new URL(url)
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY.test(key)) parsed.searchParams.set(key, '***')
    }
    if (parsed.username || parsed.password) {
      parsed.username = ''
      parsed.password = ''
    }
    return parsed.toString()
  } catch {
    return url
  }
}

function coerceValue(param, value) {
  if (value === undefined || value === null) return value
  switch (param.type) {
    case 'number':
    case 'integer': {
      if (typeof value === 'number') return value
      const num = Number(value)
      if (Number.isFinite(num)) return num
      throw new Error(`参数 ${param.name} 需要数字，收到 ${JSON.stringify(value)}`)
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value
      if (value === 'true') return true
      if (value === 'false') return false
      throw new Error(`参数 ${param.name} 需要布尔值，收到 ${JSON.stringify(value)}`)
    }
    case 'array':
      return Array.isArray(value) ? value : [value]
    default:
      return value
  }
}

/**
 * 组装请求：URL、headers、body。
 */
export function buildRequest(tool, args, extraHeaders = {}) {
  const input = args && typeof args === 'object' ? args : {}
  const byName = new Map(tool.params.map((p) => [p.name, p]))
  const unknown = Object.keys(input).filter((key) => !byName.has(key))
  if (unknown.length > 0) throw new Error(`未知参数：${unknown.join(', ')}；可用参数：${tool.params.map((p) => p.name).join(', ') || '（无）'}`)
  for (const param of tool.params) {
    if (param.required && (input[param.name] === undefined || input[param.name] === null || input[param.name] === '')) {
      throw new Error(`缺少必填参数：${param.name}${param.description ? `（${param.description}）` : ''}`)
    }
  }

  let template = tool.template
  const query = new URLSearchParams()
  const body = {}
  const headers = { Accept: 'application/json', ...toHeaderMap(tool.headers), ...toHeaderMap(extraHeaders) }

  for (const param of tool.params) {
    const rawValue = input[param.name] ?? param.default
    if (rawValue === undefined || rawValue === null) continue
    const value = coerceValue(param, rawValue)
    if (param.in === 'path') {
      template = template.split(`{${param.name}}`).join(encodeURIComponent(String(value)))
      continue
    }
    if (param.in === 'header') {
      headers[param.name] = String(value)
      continue
    }
    if (param.in === 'query') {
      if (Array.isArray(value)) for (const item of value) query.append(param.name, String(item))
      else query.append(param.name, String(value))
      continue
    }
    // body
    if (param.type === 'json' && param.name === 'body') {
      return finish(tool, template, value, headers, query)
    }
    body[param.name] = value
  }

  const hasBody = Object.keys(body).length > 0
  return finish(tool, template, hasBody ? body : undefined, headers, query)

  function finish(toolRef, pathText, payload, outHeaders, outQuery) {
    // 鉴权只在这里注入，绝不回显。
    const auth = toolRef.auth
    if (auth && auth.type === 'bearer') outHeaders.Authorization = `Bearer ${resolveAuthValue(auth)}`
    else if (auth && auth.type === 'header') outHeaders[auth.header] = resolveAuthValue(auth)
    else if (auth && auth.type === 'query') outQuery.append(auth.queryName, resolveAuthValue(auth))

    const url = new URL(toolRef.absolute ? pathText : `${toolRef.baseUrl}${pathText}`)
    for (const [key, value] of outQuery) url.searchParams.append(key, value)
    if (payload !== undefined) outHeaders['Content-Type'] = outHeaders['Content-Type'] ?? 'application/json'
    return { url: url.toString(), method: toolRef.method, headers: outHeaders, body: payload === undefined ? undefined : JSON.stringify(payload) }
  }
}

function toHeaderMap(value) {
  const out = {}
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined || item === null) continue
      out[key] = String(item)
    }
  }
  return out
}

function errorCode(err) {
  if (err?.name === 'TimeoutError') return 'timeout'
  if (err?.name === 'AbortError') return 'aborted'
  if (err?.code) return String(err.code)
  return 'network_error'
}

/**
 * 执行一次调用。HTTP 4xx/5xx 不抛异常，返回结构化结果让模型自己判断。
 */
export async function callApi(tool, args, options = {}) {
  const started = Date.now()
  let request
  try {
    request = buildRequest(tool, args)
  } catch (err) {
    return { ok: false, error: 'invalid_arguments', message: err.message }
  }

  const { signal } = options
  const timeoutSignal = AbortSignal.timeout(tool.timeoutMs)
  const composite = signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

  let response
  try {
    response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: tool.followRedirects ? 'follow' : 'manual',
      signal: composite,
    })
  } catch (err) {
    return { ok: false, error: errorCode(err), message: err?.message ?? String(err), method: request.method, url: redactUrl(request.url), durationMs: Date.now() - started }
  }

  const rawText = await response.text().catch(() => '')
  const limit = tool.maxResponseChars > 0 ? tool.maxResponseChars : 8000
  const truncated = rawText.length > limit
  const text = truncated ? `${rawText.slice(0, limit)}\n…[已截断，共 ${rawText.length} 字符]` : rawText

  const contentType = response.headers.get('content-type') ?? ''
  let data
  if (/json/i.test(contentType) || (/^\s*[[{]/.test(text) && !truncated)) {
    try {
      data = JSON.parse(text)
    } catch {
      data = undefined
    }
  }

  const result = {
    ok: response.ok,
    status: response.status,
    method: request.method,
    url: redactUrl(request.url),
    durationMs: Date.now() - started,
  }
  if (data !== undefined) result.data = data
  else result.text = text
  if (truncated) result.truncated = true
  if (!response.ok) result.message = `HTTP ${response.status} ${response.statusText}`.trim()
  return result
}
