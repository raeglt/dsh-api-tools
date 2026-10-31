/**
 * spec 读取与归一化。
 *
 * spec 是一份 JSON（或 YAML）文件，描述"一组 RESTful 接口"，结构见 apis.example.json。
 * 这里只做三件事：定位文件、解析、把宽松写法归一化成 tools.js 能直接消费的结构。
 */
import { readFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** DSH home：优先环境变量，退回 ~/.dsh。 */
export function dshHome() {
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim() !== '') return env.trim()
  return path.join(homedir(), '.dsh')
}

/**
 * 定位 spec 文件：绝对路径原样；相对路径先试 $DSH_HOME，再试插件目录。
 */
export function resolveSpecPath(specFile) {
  if (typeof specFile !== 'string' || specFile.trim() === '') {
    return path.join(dshHome(), 'api-tools', 'apis.json')
  }
  const file = specFile.trim()
  if (path.isAbsolute(file)) return file
  const fromHome = path.join(dshHome(), file)
  if (existsSync(fromHome)) return fromHome
  return path.join(PLUGIN_ROOT, file)
}

/**
 * 旧版插件用 <DSH_HOME>/api-gateway 目录；改名后自动搬一次。
 * 只在新目录不存在时动手，失败不抛（用户也可以手动搬）。
 */
export function migrateLegacyDir() {
  const next = path.join(dshHome(), 'api-tools')
  const legacy = path.join(dshHome(), 'api-gateway')
  if (existsSync(next) || !existsSync(legacy)) return null
  try {
    renameSync(legacy, next)
    return { from: legacy, to: next }
  } catch {
    return null
  }
}

const NAME_RE = /[^A-Za-z0-9_]+/g

export function sanitizeName(value, fallback = 'api') {
  const text = String(value ?? '').trim()
  if (text === '') return fallback
  return text.replace(NAME_RE, '_').replace(/^_+|_+$/g, '').slice(0, 40) || fallback
}

/** 从路径模板里提取 {placeholder}。 */
function pathPlaceholders(template) {
  return [...String(template).matchAll(/\{([^}]+)\}/g)].map((m) => m[1].trim()).filter(Boolean)
}

const JSON_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object', 'json'])

function normalizeParam(entry, name, method, template) {
  const raw = typeof entry === 'string' ? { description: entry } : (entry ?? {})
  const type = JSON_TYPES.has(raw.type) ? raw.type : 'string'
  const inPath = pathPlaceholders(template).includes(name)
  const inferred = raw.in ?? (inPath ? 'path' : method === 'GET' || method === 'HEAD' || method === 'DELETE' ? 'query' : 'body')
  const param = {
    name,
    in: ['path', 'query', 'header', 'body'].includes(inferred) ? inferred : 'query',
    type,
    required: raw.required === true || inPath,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    enum: Array.isArray(raw.enum) ? raw.enum : undefined,
    default: raw.default,
    example: raw.example,
    location: raw.location,
  }
  if (raw.location === 'path' || raw.location === 'query' || raw.location === 'body') param.in = raw.location
  if (param.in === 'path') param.required = true
  return param
}

function normalizeParams(rawParams, method, template) {
  const declared = []
  if (Array.isArray(rawParams)) {
    for (const item of rawParams) {
      const name = typeof item === 'string' ? item : item?.name
      if (typeof name !== 'string' || name.trim() === '') continue
      declared.push(normalizeParam(item, name.trim(), method, template))
    }
  } else if (rawParams && typeof rawParams === 'object') {
    for (const [name, item] of Object.entries(rawParams)) {
      declared.push(normalizeParam(item, name, method, template))
    }
  }
  // 路径占位符必须有参数声明，缺的自动补一个 string。
  for (const name of pathPlaceholders(template)) {
    if (!declared.some((p) => p.name === name)) {
      declared.push({ name, in: 'path', type: 'string', required: true, description: undefined })
    }
  }
  return declared
}

function normalizeAuth(raw) {
  if (!raw || typeof raw !== 'object' || raw.type === 'none' || raw.type === undefined) return { type: 'none' }
  const type = String(raw.type).toLowerCase()
  if (!['bearer', 'header', 'query'].includes(type)) {
    throw new Error(`auth.type 只支持 none|bearer|header|query，收到 ${JSON.stringify(raw.type)}`)
  }
  const auth = {
    type,
    header: typeof raw.header === 'string' ? raw.header : type === 'header' ? 'X-API-Key' : undefined,
    queryName: typeof raw.queryName === 'string' ? raw.queryName : typeof raw.name === 'string' ? raw.name : 'api_key',
    value: typeof raw.value === 'string' ? raw.value : undefined,
    env: typeof raw.env === 'string' ? raw.env : typeof raw.valueEnv === 'string' ? raw.valueEnv : typeof raw.tokenEnv === 'string' ? raw.tokenEnv : undefined,
  }
  if (auth.value === undefined && auth.env === undefined) {
    throw new Error('auth 需要 value（明文）或 env（环境变量名）之一')
  }
  return auth
}

function normalizeTool(raw, index, context) {
  if (!raw || typeof raw !== 'object') throw new Error(`tools[${index}] 必须是对象`)
  if (raw.enabled === false) return undefined
  const name = sanitizeName(raw.name, `tool_${index}`)
  const method = String(raw.method ?? 'GET').toUpperCase()
  const template = String(raw.path ?? raw.url ?? '')
  if (template === '') throw new Error(`tools[${index}] (${name}) 缺少 path`)
  const absolute = /^https?:\/\//i.test(template)
  const baseUrl = typeof raw.baseUrl === 'string' && raw.baseUrl.trim() !== '' ? raw.baseUrl.trim().replace(/\/+$/, '') : context.baseUrl
  if (!absolute && !baseUrl) throw new Error(`tools[${index}] (${name}) 缺少 baseUrl 且 path 不是完整 URL`)
  const params = normalizeParams(raw.params, method, template)
  const idempotent = raw.idempotent ?? (method === 'GET' || method === 'HEAD' || method === 'OPTIONS')
  const dangerous = raw.dangerous ?? !idempotent
  // 写操作默认走 DSH 的人工审批；显式 confirm:false 关掉（例如内部自动化）。
  const confirm = typeof raw.confirm === 'boolean' ? raw.confirm : dangerous
  return {
    id: `${context.prefix}${context.server}_${name}`,
    name,
    description: typeof raw.description === 'string' && raw.description.trim() !== '' ? raw.description.trim() : `${method} ${template}`,
    method,
    template,
    absolute,
    baseUrl,
    params,
    headers: { ...context.defaults.headers, ...(raw.headers && typeof raw.headers === 'object' ? raw.headers : {}) },
    auth: raw.auth ? normalizeAuth(raw.auth) : context.auth,
    timeoutMs: Number.isFinite(raw.timeoutMs) ? raw.timeoutMs : context.defaults.timeoutMs,
    maxResponseChars: Number.isFinite(raw.maxResponseChars) ? raw.maxResponseChars : context.defaults.maxResponseChars,
    dangerous,
    confirm,
    followRedirects: raw.followRedirects !== false,
  }
}

async function parseSpecFile(file) {
  const text = readFileSync(file, 'utf8')
  if (/\.(ya?ml)$/i.test(file)) {
    let yaml
    try {
      yaml = await import('yaml')
    } catch {
      throw new Error(`读取 ${file} 需要 yaml 包，但插件目录里没有装。改用 .json 后缀，或在 ${PLUGIN_ROOT} 执行 pnpm add yaml`)
    }
    return yaml.parse(text)
  }
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`spec JSON 解析失败（${file}）：${err.message}`)
  }
}

/**
 * 从 spec 根对象构造归一化上下文（server/baseUrl/auth/defaults）。
 * 鉴权写错不直接抛，先记在 authError 上，让界面能显示到具体字段。
 */
function buildContext(raw, defaults = {}) {
  const server = sanitizeName(raw.server ?? raw.name ?? 'api')
  // 统一前缀让一整族工具在外部工具管理器（如渐进式发现插件）里可以用一条
  // glob 规则覆盖。spec 里显式写 toolPrefix 优先，其次是插件行 config。
  const prefix = sanitizeName(raw.toolPrefix ?? defaults.toolPrefix ?? '', '')
  const baseUrl = typeof raw.baseUrl === 'string' && raw.baseUrl.trim() !== '' ? raw.baseUrl.trim().replace(/\/+$/, '') : undefined
  let auth = { type: 'none' }
  let authError
  if (raw.auth) {
    try {
      auth = normalizeAuth(raw.auth)
    } catch (err) {
      authError = err.message
    }
  }
  return {
    server,
    prefix: prefix === '' ? '' : `${prefix}_`,
    baseUrl,
    auth,
    authError,
    defaults: {
      timeoutMs: Number.isFinite(raw.defaults?.timeoutMs) ? raw.defaults.timeoutMs : Number.isFinite(defaults.timeoutMs) ? defaults.timeoutMs : 30000,
      maxResponseChars: Number.isFinite(raw.defaults?.maxResponseChars) ? raw.defaults.maxResponseChars : Number.isFinite(defaults.maxResponseChars) ? defaults.maxResponseChars : 8000,
      headers: raw.defaults?.headers && typeof raw.defaults.headers === 'object' ? raw.defaults.headers : {},
    },
  }
}

/**
 * 归一化一个 spec 根对象（不碰磁盘）。
 * @param {unknown} raw - spec 根对象
 * @param {{timeoutMs?: number, maxResponseChars?: number}} defaults - 来自插件行 config
 */
export function normalizeSpecObject(raw, defaults = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('spec 根节点必须是对象')
  const context = buildContext(raw, defaults)
  if (context.authError) throw new Error(context.authError)

  const list = Array.isArray(raw.tools) ? raw.tools : []
  if (list.length === 0) throw new Error('spec 里没有 tools 数组')

  const tools = []
  const problems = []
  for (const [index, entry] of list.entries()) {
    try {
      const tool = normalizeTool(entry, index, context)
      if (tool) tools.push(tool)
    } catch (err) {
      problems.push(err.message)
    }
  }
  if (tools.length === 0) throw new Error(`spec 里没有任何可用工具：${problems.join('；')}`)

  const dupes = tools.map((t) => t.id).filter((id, i, all) => all.indexOf(id) !== i)
  if (dupes.length > 0) throw new Error(`工具名重复：${[...new Set(dupes)].join(', ')}`)

  return { server: context.server, baseUrl: context.baseUrl, auth: context.auth, defaults: context.defaults, tools, problems }
}

/**
 * 读取并归一化 spec。
 * @param {string} specFile - config.specFile
 * @param {{timeoutMs?: number, maxResponseChars?: number, watch?: boolean}} defaults - 来自插件行 config
 */
export async function loadSpec(specFile, defaults = {}) {
  const file = resolveSpecPath(specFile)
  if (!existsSync(file)) throw new Error(`spec 文件不存在：${file}`)
  let raw
  try {
    raw = await parseSpecFile(file)
  } catch (err) {
    throw new Error(err.message)
  }
  try {
    return { file, ...normalizeSpecObject(raw, defaults) }
  } catch (err) {
    throw new Error(`${err.message}（${file}）`)
  }
}

/** 读取原始 spec（不归一化），供 Web 界面展示与编辑。 */
export async function readRawSpec(specFile) {
  const file = resolveSpecPath(specFile)
  if (!existsSync(file)) return { file, raw: undefined }
  return { file, raw: await parseSpecFile(file) }
}

/**
 * 逐条检查原始 spec，供 Web 界面显示每行状态：哪条坏了、坏在哪。
 * @param {unknown} raw - spec 根对象
 * @param {{timeoutMs?: number, maxResponseChars?: number}} defaults
 */
export function inspectSpecObject(raw, defaults = {}) {
  const entries = []
  const problems = []
  const empty = { server: undefined, baseUrl: undefined, auth: { type: 'none' }, authError: undefined, defaults: {}, entries, problems }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push('spec 根节点必须是对象')
    return empty
  }
  const context = buildContext(raw, defaults)
  if (context.authError) problems.push(`auth：${context.authError}`)

  const list = Array.isArray(raw.tools) ? raw.tools : []
  if (list.length === 0) problems.push('spec 里没有 tools 数组')
  const seen = new Map()
  for (const [index, entry] of list.entries()) {
    const row = {
      index,
      name: typeof entry?.name === 'string' ? entry.name : undefined,
      method: String(entry?.method ?? 'GET').toUpperCase(),
      path: typeof entry?.path === 'string' ? entry.path : typeof entry?.url === 'string' ? entry.url : undefined,
      enabled: entry?.enabled !== false,
      id: undefined,
      dangerous: undefined,
      confirm: undefined,
      params: 0,
      error: undefined,
    }
    if (row.enabled) {
      try {
        const tool = normalizeTool(entry, index, context)
        row.id = tool.id
        row.method = tool.method
        row.path = tool.template
        row.dangerous = tool.dangerous
        row.confirm = tool.confirm
        row.params = tool.params.length
        const count = seen.get(tool.id) ?? 0
        seen.set(tool.id, count + 1)
        if (count > 0) row.error = `工具名重复：${tool.id}`
      } catch (err) {
        row.error = err.message
      }
    }
    if (row.error) problems.push(row.error)
    entries.push(row)
  }
  return { server: context.server, baseUrl: context.baseUrl, auth: context.auth, authError: context.authError, defaults: context.defaults, entries, problems }
}

/** 原子写入 spec 文件（先写临时文件再改名）。 */
export function saveSpecFile(file, raw) {
  const text = `${JSON.stringify(raw, null, 2)}\n`
  // 网关文件允许写明文密钥（auth.value），所以目录按 0700 建、文件按 0600 写：
  // 同机其他用户读不到。mkdir 的 mode 只对新建目录生效，已有目录尊重主人原有权限。
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  // 先写 tmp 再 rename，rename 会保留 tmp 的模式，所以 0600 必须在写 tmp 时就设好。
  writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, file)
  return file
}
