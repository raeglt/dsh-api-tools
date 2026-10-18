/**
 * DSH 插件入口：扫描网关目录里的每个 spec → 注册工具 → 监听变更热重载 → 提供 Web 配置界面。
 *
 * 目录里一个 .json 就是「一个网关」（自己的 server 前缀 / baseUrl / 鉴权 / 接口列表），
 * 工具名前缀是各网关的 server，所以多个网关可以同时装进来互不冲突。
 *
 * 这里刻意不 import 任何 @deepseek-ai/dsh-* 包：工具定义用注册表接受的普通对象，
 * 所以插件装在任何 profile 里都不依赖宿主的 peer 解析。
 */
import { appendFileSync, existsSync, readdirSync, rmSync, unwatchFile, watch, watchFile } from 'node:fs'
import path from 'node:path'
import { jsonSafe } from './json.js'
import { inspectSpecObject, loadSpec, migrateLegacyDir, normalizeSpecObject, readRawSpec, resolveSpecPath, saveSpecFile } from './spec.js'
import { buildToolDefs } from './tools.js'

export const name = 'api-tools'
export const inject = ['tools']

const STATUS_TOOL = 'api_tools_status'
const API_PREFIX = '/api-tools/v1'
const MAX_BODY_BYTES = 1024 * 1024
const SERVER_RE = /^[A-Za-z0-9_]{1,40}$/
/** 界面回显时顶替真实密钥的占位符；保存时按「未修改」合并回磁盘上的原值。 */
const SECRET_PLACEHOLDER = '***'
const SECRET_KEY_RE = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)$/i
const SECRET_WORD_RE = /(secret|token|password|passwd|api[-_]?key|credential)/i
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

/** 递归脱敏一份 spec：auth.value 和疑似密钥的 header 值换成占位符，界面不再吐明文。 */
function redactSpec(raw) {
  const clone = JSON.parse(JSON.stringify(raw ?? {}))
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.auth && typeof node.auth === 'object' && node.auth.value != null) node.auth.value = SECRET_PLACEHOLDER
    if (node.headers && typeof node.headers === 'object') {
      for (const [key, value] of Object.entries(node.headers)) {
        if (SECRET_KEY_RE.test(key) || SECRET_WORD_RE.test(key)) node.headers[key] = SECRET_PLACEHOLDER
      }
    }
    for (const value of Object.values(node)) if (value && typeof value === 'object') walk(value)
  }
  walk(clone)
  return clone
}

/** 保存前把占位符换回磁盘上已有的真实密钥，避免 UI 回传 *** 就把配置覆盖成星号。 */
function mergeRedactedSecrets(raw, previous) {
  const clone = JSON.parse(JSON.stringify(raw ?? {}))
  const tools = new Map((Array.isArray(previous?.tools) ? previous.tools : []).map((tool) => [tool?.name, tool]))
  const restoreAuth = (node, prev) => {
    if (!node?.auth || node.auth.value !== SECRET_PLACEHOLDER) return
    if (typeof prev?.value === 'string') node.auth.value = prev.value
    else delete node.auth.value
  }
  const restoreHeaders = (node, prev) => {
    if (!node?.headers || typeof node.headers !== 'object') return
    for (const [key, value] of Object.entries(node.headers)) {
      if (value !== SECRET_PLACEHOLDER) continue
      if (typeof prev?.[key] === 'string') node.headers[key] = prev[key]
      else delete node.headers[key]
    }
  }
  restoreAuth(clone, previous?.auth)
  restoreHeaders(clone, previous?.headers)
  for (const tool of Array.isArray(clone?.tools) ? clone.tools : []) {
    const prev = tools.get(tool?.name)
    restoreAuth(tool, prev?.auth)
    restoreHeaders(tool, prev?.headers)
  }
  return clone
}

/** 日志里不打明文参数。 */
const redactArgsForLog = (args) => JSON.stringify(args, (key, value) => (SECRET_WORD_RE.test(key) ? SECRET_PLACEHOLDER : value))

function parseAuthority(value) {
  try {
    return new URL(`http://${value}`)
  } catch {
    return undefined
  }
}

function isLoopbackHostname(hostname) {
  return LOOPBACK_HOSTS.has(String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, ''))
}

/**
 * 兜底栅栏：宿主 connection 服务不可用时按同样的规则自查。
 * Host 必须回环（防 DNS rebinding）+ 拒绝跨站 + Origin 必须同 authority（null 也拒）。
 * 只做来源校验、不做认证，所以只可能返回 403。
 */
function fallbackRejection(req) {
  const headers = req?.headers ?? {}
  const host = headers.host
  if (!host) return 403
  const hostUrl = parseAuthority(host)
  if (!hostUrl || !isLoopbackHostname(hostUrl.hostname)) return 403
  if (headers['sec-fetch-site'] === 'cross-site') return 403
  const origin = headers.origin
  if (origin === undefined) return undefined
  if (origin === 'null') return 403
  let originUrl
  try {
    originUrl = new URL(origin)
  } catch {
    return 403
  }
  if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') return 403
  return originUrl.host === hostUrl.host ? undefined : 403
}

/** 诊断开关：设置 DSH_GATEWAY_DEBUG=<文件路径> 时把加载过程写进该文件。 */
const debugFile = process.env.DSH_GATEWAY_DEBUG
const debug = (message) => {
  if (!debugFile) return
  try {
    appendFileSync(debugFile, `${new Date().toISOString()} ${message}\n`)
  } catch {}
}

export function apply(ctx, config = {}) {
  debug('apply() entered')
  const options = {
    specFile: typeof config.specFile === 'string' ? config.specFile : undefined,
    timeoutMs: Number.isFinite(config.timeoutMs) ? config.timeoutMs : 30000,
    maxResponseChars: Number.isFinite(config.maxResponseChars) ? config.maxResponseChars : 8000,
    watch: config.watch !== false,
  }
  const defaults = { timeoutMs: options.timeoutMs, maxResponseChars: options.maxResponseChars }

  // 只走 console：cordis 的 ctx 代理对未声明的属性直接抛
  // `cannot get property "logger" without inject`，日志不能碰 ctx。
  const log = (level, message) => {
    const text = `[api-tools] ${message}`
    if (level === 'error') console.error(text)
    else console.log(text)
  }

  let disposers = []
  // 旧版叫 api-gateway 目录，改名后自动搬一次（只在新目录不存在时）。
  const migrated = migrateLegacyDir()
  if (migrated) log('info', `网关目录已迁移：${migrated.from} → ${migrated.to}`)
  // apis.json 是默认网关文件，同时它的所在目录就是「网关目录」。
  const target = resolveSpecPath(options.specFile)
  const dir = path.dirname(target)
  let watched = []
  let dirWatcher
  let state = { status: 'loading', dir, specFile: target, gateways: [], tools: [], problems: [], error: undefined, loadedAt: undefined }
  // 需要人工确认的工具：name → { method, path, description }。由每次 mount 重建。
  let confirmTargets = new Map()
  let mountChain = Promise.resolve()

  const disposeTools = () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch (err) {
        log('error', `注销工具失败：${err?.message ?? err}`)
      }
    }
    disposers = []
  }

  const authSummary = (auth) => ({
    type: auth?.type ?? 'none',
    header: auth?.header,
    queryName: auth?.queryName,
    env: auth?.env,
    valueSet: typeof auth?.value === 'string',
  })

  /** 只允许操作网关目录里的文件（外加显式配置的 specFile）。 */
  const resolveFile = (file) => {
    const abs = path.resolve(path.isAbsolute(file) ? file : resolveSpecPath(file))
    if (path.dirname(abs) !== path.resolve(dir) && abs !== path.resolve(target)) {
      throw Object.assign(new Error('只能操作网关目录里的文件'), { status: 400 })
    }
    return abs
  }

  /** 目录里的 .json 全是网关；显式配置的 specFile 即使不在目录里也算一个。 */
  const gatewayFiles = () => {
    let names = []
    try {
      names = readdirSync(dir)
    } catch {}
    const files = names
      .filter((name) => name.toLowerCase().endsWith('.json') && !name.startsWith('.'))
      .map((name) => path.join(dir, name))
      .sort()
    if (existsSync(target) && !files.includes(target)) files.unshift(target)
    return files
  }

  const loadGateways = async () => {
    const gateways = []
    const defs = []
    const confirms = new Map()
    for (const file of gatewayFiles()) {
      try {
        const raw = (await readRawSpec(file)).raw
        // 还没有接口的网关也算合法（界面里刚新建的），不要当成错误。
        if (!Array.isArray(raw?.tools) || raw.tools.length === 0) {
          gateways.push({ file, server: raw?.server, baseUrl: raw?.baseUrl, auth: authSummary(raw?.auth), tools: [], empty: true, problems: [] })
          continue
        }
        const spec = await loadSpec(file, defaults)
        const list = buildToolDefs(spec)
        gateways.push({
          file: spec.file,
          server: spec.server,
          baseUrl: spec.baseUrl,
          auth: authSummary(spec.auth),
          tools: list.map((definition) => definition.name),
          empty: false,
          problems: spec.problems,
        })
        defs.push(...list)
        for (const tool of spec.tools) {
          if (!tool.confirm) continue
          confirms.set(tool.id, { method: tool.method, path: tool.template, description: tool.description })
        }
      } catch (err) {
        gateways.push({ file, error: err?.message ?? String(err), tools: [], empty: false, problems: [] })
        log('error', `加载网关失败：${err?.message ?? err}`)
      }
    }
    return { gateways, defs, confirms }
  }

  const mount = async (reason) => {
    try {
      const { gateways, defs, confirms } = await loadGateways()
      // 先解析成功再替换，解析失败时保留上一版可用工具。
      disposeTools()
      const problems = []
      const registered = []
      const seen = new Set()
      for (const definition of defs) {
        if (seen.has(definition.name)) {
          problems.push(`工具名重复，已跳过：${definition.name}`)
          continue
        }
        seen.add(definition.name)
        try {
          const dispose = ctx.tools.register(definition)
          disposers.push(dispose)
          registered.push(definition.name)
          debug(`registered ${definition.name} (dispose=${typeof dispose})`)
        } catch (err) {
          problems.push(`${definition.name}: ${err?.message ?? err}`)
          log('error', `注册工具 ${definition.name} 失败：${err?.message ?? err}`)
        }
      }
      const registeredSet = new Set(registered)
      confirmTargets = new Map([...confirms].filter(([toolName]) => registeredSet.has(toolName)))
      for (const gateway of gateways) {
        for (const problem of gateway.problems ?? []) problems.push(`${gateway.server ?? path.basename(gateway.file)}：${problem}`)
      }
      state = {
        status: 'ok',
        dir,
        specFile: target,
        gateways,
        tools: registered,
        needsConfirm: [...confirmTargets.keys()],
        problems,
        error: undefined,
        loadedAt: new Date().toISOString(),
      }
      log('info', `${reason}：${gateways.length} 个网关，已注册 ${registered.length} 个工具（${dir}）`)
      if (debugFile) debug(`mount ok, gateways=${gateways.map((g) => `${g.server ?? '?'}:${(g.tools ?? []).length}`).join(',')}`)
      watchFiles(gateways.map((gateway) => gateway.file))
    } catch (err) {
      state = { ...state, status: 'error', error: err?.message ?? String(err) }
      log('error', `${reason}失败：${state.error}`)
    }
  }

  /** 串行化挂载：watch 与界面保存可能同时触发，避免 dispose/register 交错。 */
  const enqueueMount = (reason) => {
    mountChain = mountChain.then(() => mount(reason)).catch(() => {})
    return mountChain
  }

  const watchFiles = (files) => {
    if (!options.watch) return
    for (const file of watched) {
      try {
        unwatchFile(file)
      } catch {}
    }
    watched = []
    for (const file of new Set(files)) {
      if (!existsSync(file)) continue
      let lastMtime = 0
      try {
        watchFile(file, { interval: 1000, persistent: false }, (curr) => {
          if (curr.mtimeMs === lastMtime) return
          lastMtime = curr.mtimeMs
          log('info', `${path.basename(file)} 变化，重新加载`)
          void enqueueMount('热重载')
        })
        watched.push(file)
      } catch (err) {
        log('error', `监听 ${file} 失败：${err?.message ?? err}`)
      }
    }
  }

  /** 目录本身也监听：外面丢进来一个新网关文件时自动加载。 */
  const watchDir = () => {
    if (!options.watch || dirWatcher) return
    try {
      dirWatcher = watch(dir, { persistent: false }, () => {
        log('info', '网关目录变化，重新加载')
        void enqueueMount('目录变化')
      })
      dirWatcher.on('error', () => {})
    } catch (err) {
      log('error', `监听网关目录失败：${err?.message ?? err}`)
    }
  }

  // ---- Web 配置界面用的 HTTP 接口 ---------------------------------------

  const listState = () => ({
    ok: state.status === 'ok',
    status: state.status,
    dir,
    file: target,
    error: state.error,
    loadedAt: state.loadedAt,
    tools: state.tools ?? [],
    needsConfirm: state.needsConfirm ?? [],
    problems: state.problems ?? [],
    gateways: (state.gateways ?? []).map((gateway) => ({
      file: gateway.file,
      name: path.basename(gateway.file),
      server: gateway.server,
      baseUrl: gateway.baseUrl,
      auth: gateway.auth,
      tools: gateway.tools ?? [],
      empty: Boolean(gateway.empty),
      error: gateway.error,
      problems: gateway.problems ?? [],
    })),
  })

  /** 单个网关的详情：原始 spec + 每行的校验结果。 */
  const detailOf = async (file) => {
    const resolved = file ? resolveFile(file) : gatewayFiles()[0] ?? target
    const gateway = (state.gateways ?? []).find((item) => path.resolve(item.file) === path.resolve(resolved)) ?? {}
    let raw
    let readError
    try {
      raw = (await readRawSpec(resolved)).raw
    } catch (err) {
      readError = err?.message ?? String(err)
    }
    const inspection = inspectSpecObject(raw, defaults)
    const toolCount = Array.isArray(raw?.tools) ? raw.tools.length : 0
    const problems = [
      ...new Set([
        ...(inspection.problems ?? []).filter((problem) => !(toolCount === 0 && problem === 'spec 里没有 tools 数组')),
        ...(gateway.problems ?? []),
        ...(gateway.error ? [gateway.error] : []),
      ]),
    ]
    return {
      ok: !gateway.error,
      status: gateway.error ? 'error' : gateway.empty ? 'empty' : 'ok',
      file: resolved,
      error: state.error ?? gateway.error ?? readError,
      loadedAt: state.loadedAt,
      registered: gateway.tools ?? [],
      server: inspection.server ?? gateway.server,
      baseUrl: inspection.baseUrl ?? gateway.baseUrl,
      auth: authSummary(inspection.auth),
      authError: inspection.authError,
      defaults: inspection.defaults,
      entries: inspection.entries,
      problems,
      // 明文密钥（auth.value / 敏感 header）不进浏览器：done 用 *** 占位，保存时再合并回原值。
      spec: redactSpec(raw ?? { server: 'api', baseUrl: '', tools: [] }),
    }
  }

  const sendJson = (res, status, body) => {
    const text = JSON.stringify(body)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(text)
  }

  const readBody = async (req) => {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_BODY_BYTES) throw Object.assign(new Error('请求体过大'), { status: 413 })
      chunks.push(chunk)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    if (text.trim() === '') return {}
    try {
      return JSON.parse(text)
    } catch {
      throw Object.assign(new Error('请求体不是合法 JSON'), { status: 400 })
    }
  }

  /** 保存前校验：非法配置不落盘，避免把好的 spec 覆盖坏。 */
  const validateForSave = (raw, force) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw Object.assign(new Error('spec 根节点必须是对象'), { status: 400 })
    }
    const list = Array.isArray(raw.tools) ? raw.tools : []
    if (list.length === 0) return
    const normalized = normalizeSpecObject(raw, defaults)
    if (normalized.problems.length > 0 && !force) {
      throw Object.assign(new Error(`配置有 ${normalized.problems.length} 处问题，未保存：${normalized.problems.join('；')}`), { status: 400 })
    }
  }

  const handleApi = async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://api-tools.local')
      const route = url.pathname.slice(API_PREFIX.length).replace(/^\/+|\/+$/g, '')
      const method = (req.method ?? 'GET').toUpperCase()

      if (method === 'GET' && (route === '' || route === 'gateways')) {
        return sendJson(res, 200, listState())
      }
      if (method === 'GET' && (route === 'gateway' || route === 'spec')) {
        const file = url.searchParams.get('file') ?? undefined
        return sendJson(res, 200, await detailOf(file))
      }
      if (method === 'GET' && route === 'gateway-files') {
        return sendJson(res, 200, { ok: true, files: gatewayFiles() })
      }
      if (method === 'POST' && route === 'reload') {
        await enqueueMount('界面重载')
        return sendJson(res, 200, listState())
      }
      if (method === 'POST' && (route === 'gateways' || route === 'gateway')) {
        const body = await readBody(req)
        const server = String(body?.server ?? '').trim()
        if (!SERVER_RE.test(server)) {
          throw Object.assign(new Error('服务名只能用字母、数字、下划线（1-40 个字符）'), { status: 400 })
        }
        const baseUrl = String(body?.baseUrl ?? '').trim()
        if (!/^https?:\/\//i.test(baseUrl)) {
          throw Object.assign(new Error('baseUrl 需要以 http:// 或 https:// 开头'), { status: 400 })
        }
        const file = path.join(dir, `${server}.json`)
        if (existsSync(file)) throw Object.assign(new Error(`已存在同名网关：${server}（${file}）`), { status: 409 })
        const spec = { server, baseUrl, tools: [] }
        const auth = body?.auth
        if (auth && typeof auth === 'object' && auth.type && auth.type !== 'none') {
          spec.auth = { ...auth }
          if (spec.auth.value === SECRET_PLACEHOLDER) delete spec.auth.value
        }
        saveSpecFile(file, spec)
        log('info', `新增网关：${file}`)
        await enqueueMount('新增网关')
        return sendJson(res, 200, { ok: true, ...(await detailOf(file)) })
      }
      if ((method === 'PUT' || method === 'POST') && (route === 'gateway-save' || route === 'spec-save')) {
        const body = await readBody(req)
        const raw = body?.spec ?? body
        validateForSave(raw, url.searchParams.get('force') === '1')
        const file = resolveFile(String(body?.file ?? target))
        // 界面回传的 *** 是「没改」，用磁盘上的原值补回去再落盘。
        let previous
        try {
          previous = (await readRawSpec(file)).raw
        } catch {}
        saveSpecFile(file, mergeRedactedSecrets(raw, previous))
        log('info', `界面保存：已写入 ${file}`)
        await enqueueMount('界面保存')
        return sendJson(res, 200, { ok: true, ...(await detailOf(file)) })
      }
      if ((method === 'PUT' || method === 'POST') && (route === 'gateway' || route === 'spec')) {
        const body = await readBody(req)
        const raw = body?.spec ?? body
        validateForSave(raw, url.searchParams.get('force') === '1')
        const file = resolveFile(String(body?.file ?? target))
        // 界面回传的 *** 是「没改」，用磁盘上的原值补回去再落盘。
        let previous
        try {
          previous = (await readRawSpec(file)).raw
        } catch {}
        saveSpecFile(file, mergeRedactedSecrets(raw, previous))
        log('info', `界面保存：已写入 ${file}`)
        await enqueueMount('界面保存')
        return sendJson(res, 200, { ok: true, ...(await detailOf(file)) })
      }
      if (method === 'DELETE' && route === 'gateway') {
        const file = resolveFile(String(url.searchParams.get('file') ?? ''))
        if (!existsSync(file)) throw Object.assign(new Error(`网关文件不存在：${file}`), { status: 404 })
        rmSync(file)
        log('info', `删除网关：${file}`)
        await enqueueMount('删除网关')
        return sendJson(res, 200, listState())
      }
      if (method === 'POST' && route === 'test') {
        const body = await readBody(req)
        const submitted = body?.tool
        if (!submitted || typeof submitted !== 'object') throw Object.assign(new Error('缺少 tool（要测试的接口定义）'), { status: 400 })
        // 在线测试只允许打网关自己的 baseUrl、用网关自己的鉴权。
        // 客户端传入的 baseUrl/auth/headers 一律丢弃，否则这个接口就是「带着密钥打任意地址」的 SSRF 出口。
        const tool = { ...submitted }
        for (const key of ['baseUrl', 'auth', 'headers', 'followRedirects', 'maxResponseChars', 'timeoutMs']) delete tool[key]
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(String(tool.path ?? tool.url ?? ''))) {
          throw Object.assign(new Error('测试接口只能用相对 path，不能填绝对 URL（目标地址由网关 baseUrl 决定）'), { status: 400 })
        }
        const file = body?.file ? resolveFile(String(body.file)) : gatewayFiles()[0] ?? target
        const raw = (await readRawSpec(file)).raw ?? {}
        // 复用该网关正在用的 server/baseUrl/auth/defaults，只把这一条拿去构造工具，不落盘、不注册。
        const composed = {
          server: raw.server,
          baseUrl: raw.baseUrl,
          auth: raw.auth,
          defaults: raw.defaults,
          tools: [tool],
        }
        const normalized = normalizeSpecObject(composed, defaults)
        if (normalized.problems.length > 0) {
          throw Object.assign(new Error(normalized.problems.join('；')), { status: 400 })
        }
        const [definition] = buildToolDefs(normalized, { deferLoading: false })
        const args = body?.args && typeof body.args === 'object' ? body.args : {}
        log('info', `界面测试：${definition.name} ${redactArgsForLog(args)}`)
        const result = await definition.execute(args, {})
        return sendJson(res, 200, { ok: true, tool: definition.name, args, result })
      }
      return sendJson(res, 404, { ok: false, error: `未知接口：${method} ${route}` })
    } catch (err) {
      const status = Number.isInteger(err?.status) ? err.status : 400
      log('error', `接口请求失败：${err?.message ?? err}`)
      return sendJson(res, status, { ok: false, error: err?.message ?? String(err) })
    }
  }

  const registerWebApi = () => {
    if (typeof ctx.inject !== 'function') return
    ctx.inject(['webServer'], (scoped) => {
      const webServer = scoped.webServer
      if (!webServer || typeof webServer.register !== 'function') {
        log('error', 'webServer 不可用，跳过 Web 配置界面')
        return
      }
      // 宿主 connection 服务的 requestRejection 自带「Host 回环 + 跨站拒绝 + Origin 同源 + 认证」，
      // 优先用它；拿不到（旧版本 / 桌面 profile）就退回内置 Host/Origin 自查（只挡跨站，不做认证）。
      let admission = null
      try {
        admission = typeof scoped.get === 'function' ? scoped.get('connection') : scoped.connection ?? null
      } catch {}
      const handler = (req, res) => {
        let rejection
        try {
          rejection = admission && typeof admission.requestRejection === 'function' ? admission.requestRejection(req) : fallbackRejection(req)
        } catch (err) {
          log('error', `请求来源校验异常：${err?.message ?? err}`)
          return sendJson(res, 500, { ok: false, error: '请求校验失败' })
        }
        if (rejection) {
          log('error', `拒绝 ${req?.method ?? '?'} ${req?.url ?? '?'}：${rejection === 401 ? '未认证' : '来源不可信'}`)
          return sendJson(res, rejection, { ok: false, error: rejection === 401 ? 'unauthorized（缺少浏览器会话或令牌）' : 'forbidden（只接受本机同源请求）' })
        }
        return handleApi(req, res)
      }
      webServer.register({ kind: 'prefix', path: API_PREFIX, handler })
      log('info', `Web 配置界面已挂载：${API_PREFIX}（${admission ? '宿主 connection 栅栏' : '内置 Host/Origin 校验'}）`)
      if (!admission && typeof scoped.inject === 'function') {
        // connection 可能比 webServer 晚就绪：到位后自动升级，避免降级模式一直生效。
        scoped.inject(['connection'], (connCtx) => {
          admission = connCtx.connection
          log('info', 'connection 服务就绪，配置界面已切换为宿主栅栏 + 认证')
        })
      }
    })
  }

  const statusDispose = ctx.tools.register({
    name: STATUS_TOOL,
    description: '查看 API 网关（api-tools 插件）的加载状态：网关目录里有哪些网关、各自注册了哪些接口工具、最近一次错误。工具调用失败或怀疑接口没加载时先看这里。',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: {
      schema: {},
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
    },
    async execute() {
      // DSH 只接受「无损 JSON」，state 里可能有 undefined（error/loadedAt），必须清一遍。
      return jsonSafe({ ...state, specFile: state.specFile ?? target })
    },
  })
  debug(`registered ${STATUS_TOOL} (dispose=${typeof statusDispose})`)

  // 写操作接 DSH 原生审批：pre-execute 返回 ask，registry 去问 ctx.approval。
  // 审批策略为 never、或没有可用审批通道时，宿主会直接拒绝这次调用——这是预期行为。
  if (typeof ctx.on === 'function') {
    ctx.on('tools/pre-execute', async (exec, next) => {
      const item = confirmTargets.get(exec?.name)
      if (!item) return next()
      const extra = item.description ? ` —— ${item.description}` : ''
      return {
        kind: 'ask',
        reason: `写操作需要确认：${item.method} ${item.path}${extra}`,
        displayReason: {
          en: `Run this write request? ${item.method} ${item.path}${item.description ? ` — ${item.description}` : ''}`,
          zh: `要执行这个写操作吗？${item.method} ${item.path}${extra}`,
        },
      }
    })
    debug('registered tools/pre-execute gate')
  } else {
    log('error', 'ctx.on 不可用，写操作确认未启用')
  }

  registerWebApi()
  watchDir()
  void enqueueMount('首次加载')
}
