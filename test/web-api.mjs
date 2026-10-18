/**
 * Web 配置界面用例：直接跑插件注册的 HTTP 处理器（不启动 DSH、不调模型）。
 * 覆盖网关列表/详情、新建网关、保存接口、坏配置拒绝写入、删除网关、在线测试。
 */
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const dir = mkdtempSync(path.join(tmpdir(), 'gateway-web-'))
const specFile = path.join(dir, 'apis.json')
const baseSpec = {
  server: 'demo',
  baseUrl: 'https://api.open-meteo.com',
  tools: [
    { name: 'demo_forecast', method: 'GET', path: '/v1/forecast', description: '天气', params: { latitude: { type: 'number', required: true }, longitude: { type: 'number', required: true } } },
    { name: 'demo_echo', method: 'POST', path: '/v1/echo', description: '回显' },
  ],
}
writeFileSync(specFile, JSON.stringify(baseSpec, null, 2))

const registered = new Map()
const events = new Map()
const ctx = {
  tools: {
    register(definition) {
      registered.set(definition.name, definition)
      return () => registered.delete(definition.name)
    },
    get(name) {
      return registered.get(name)
    },
  },
  on(event, listener) {
    events.set(event, listener)
    return () => events.delete(event)
  },
  inject(names, callback) {
    const scoped = { webServer: { register(route) { handler = route.handler; return () => {} } } }
    if (names.includes('webServer')) callback(scoped)
    return () => {}
  },
}
let handler

const plugin = await import('../lib/index.js')
plugin.apply(ctx, { specFile, watch: false })
await new Promise((resolve) => setTimeout(resolve, 400))

const fakeRes = () => {
  const out = { status: 0, headers: {}, body: '' }
  out.writeHead = (status, headers) => {
    out.status = status
    out.headers = headers ?? {}
  }
  out.end = (text) => {
    out.body = text ?? ''
  }
  return out
}

const callOn = async (target, method, route, body, headers = {}) => {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const req = {
    method,
    url: `/api-tools/v1${route}`,
    headers: { host: '127.0.0.1:3080', ...headers },
    async *[Symbol.asyncIterator]() {
      if (payload !== '') yield Buffer.from(payload)
    },
  }
  const res = fakeRes()
  await target(req, res)
  return { status: res.status, json: JSON.parse(res.body) }
}
const call = (method, route, body, headers) => callOn(handler, method, route, body, headers)

assert.ok(handler, '插件应注册 webServer 前缀路由')

// 0. 来源栅栏（connection 服务不在时的内置校验）：只放行本机同源
const noHost = await call('GET', '/gateways', undefined, { host: '' })
assert.equal(noHost.status, 403, '缺 Host 头要拒绝')
const crossSite = await call('GET', '/gateways', undefined, { 'sec-fetch-site': 'cross-site' })
assert.equal(crossSite.status, 403, '跨站请求要拒绝')
const badOrigin = await call('GET', '/gateways', undefined, { origin: 'http://evil.example.com' })
assert.equal(badOrigin.status, 403, 'Origin 不同源要拒绝')
const nullOrigin = await call('GET', '/gateways', undefined, { origin: 'null' })
assert.equal(nullOrigin.status, 403, 'Origin: null 要拒绝')
const sameOrigin = await call('GET', '/gateways', undefined, { origin: 'http://127.0.0.1:3080' })
assert.equal(sameOrigin.status, 200, '本机同源要放行')
console.log('来源栅栏 → 缺 Host/跨站/异源/null 均 403，同源 200')

// 1. 网关列表：目录里只有一个 apis.json
const list1 = await call('GET', '/gateways')
assert.equal(list1.status, 200)
assert.equal(list1.json.gateways.length, 1)
assert.equal(list1.json.gateways[0].server, 'demo')
assert.deepEqual(list1.json.gateways[0].tools.sort(), ['demo_demo_echo', 'demo_demo_forecast'])
assert.ok(registered.has('api_tools_status'))
assert.deepEqual(list1.json.needsConfirm.sort(), ['demo_demo_echo'], 'POST 接口默认需要确认')
console.log(`GET /gateways → ${list1.json.gateways.length} 个网关，${list1.json.tools.length} 个工具`)

// 2. 网关详情
const read1 = await call('GET', `/gateway?file=${encodeURIComponent(specFile)}`)
assert.equal(read1.status, 200)
assert.equal(read1.json.ok, true)
assert.equal(read1.json.entries.length, 2)
assert.equal(read1.json.server, 'demo')
assert.deepEqual(read1.json.registered.sort(), ['demo_demo_echo', 'demo_demo_forecast'])
console.log(`GET /gateway → ${read1.json.entries.length} 条接口`)

// 3. 保存：新增一条接口 → 落盘 + 重新注册
const nextSpec = structuredClone(baseSpec)
nextSpec.tools.push({ name: 'demo_new', method: 'GET', path: '/v1/new/{id}' })
const saved = await call('PUT', '/gateway', { file: specFile, spec: nextSpec })
assert.equal(saved.status, 200, JSON.stringify(saved.json))
assert.equal(saved.json.entries.length, 3)
const onDisk = JSON.parse(readFileSync(specFile, 'utf8'))
assert.equal(onDisk.tools.length, 3)
assert.ok(registered.has('demo_demo_new'), '新增接口应注册成工具')
const newTool = registered.get('demo_demo_new')
assert.equal(newTool.parameters.properties.id.type, 'string', '路径占位符应自动生成参数')
console.log(`PUT /gateway → 文件 3 条，工具 ${[...registered.keys()].length} 个（含 demo_demo_new）`)
if (process.platform !== 'win32') {
  const mode = statSync(specFile).mode & 0o777
  assert.equal(mode, 0o600, '网关文件可能含密钥，权限应为 0600')
  console.log(`文件权限 → ${mode.toString(8)}`)
}

// 4. 坏配置：拒绝并保持文件不变
const broken = structuredClone(nextSpec)
broken.tools.push({ name: 'broken_tool' })
const rejected = await call('PUT', '/gateway', { file: specFile, spec: broken })
assert.equal(rejected.status, 400)
assert.match(rejected.json.error, /缺少 path/)
assert.equal(JSON.parse(readFileSync(specFile, 'utf8')).tools.length, 3, '坏配置不能覆盖好文件')
console.log(`PUT 坏配置 → 400「${rejected.json.error}」，文件未变`)

// 5. 新建网关：参数校验
const badName = await call('POST', '/gateways', { server: 'bad name!', baseUrl: 'https://x.example.com' })
assert.equal(badName.status, 400)
assert.match(badName.json.error, /服务名/)
const badUrl = await call('POST', '/gateways', { server: 'erp', baseUrl: 'ftp://x' })
assert.equal(badUrl.status, 400)
assert.match(badUrl.json.error, /baseUrl/)
console.log('POST /gateways（坏服务名/坏 baseUrl）→ 400')

// 6. 新建网关：成功 → 目录多一个空网关文件，列表里出现
const created = await call('POST', '/gateways', { server: 'erp', baseUrl: 'https://erp.example.com', auth: { type: 'header', header: 'X-API-Key', env: 'ERP_KEY' } })
assert.equal(created.status, 200, JSON.stringify(created.json))
const erpFile = path.join(dir, 'erp.json')
assert.equal(created.json.file, erpFile)
assert.ok(existsSync(erpFile), '应生成 erp.json')
assert.equal(created.json.spec.server, 'erp')
assert.equal(created.json.spec.auth.env, 'ERP_KEY')
assert.equal(created.json.status, 'empty')
const list2 = await call('GET', '/gateways')
assert.equal(list2.json.gateways.length, 2)
assert.ok(list2.json.gateways.some((item) => item.server === 'erp' && item.empty === true))
console.log(`POST /gateways → ${path.basename(erpFile)}，列表 ${list2.json.gateways.length} 个网关`)

// 7. 同名网关 → 409
const duplicated = await call('POST', '/gateways', { server: 'erp', baseUrl: 'https://erp2.example.com' })
assert.equal(duplicated.status, 409)
assert.match(duplicated.json.error, /已存在同名网关/)
console.log('POST /gateways（重名）→ 409')

// 8. 给新网关加接口 → 工具按它的 server 前缀注册
const erpSpec = { server: 'erp', baseUrl: 'https://erp.example.com', auth: { type: 'header', header: 'X-API-Key', env: 'ERP_KEY' }, tools: [{ name: 'order_detail', method: 'GET', path: '/orders/{orderId}' }] }
const erpSaved = await call('PUT', '/gateway', { file: erpFile, spec: erpSpec })
assert.equal(erpSaved.status, 200, JSON.stringify(erpSaved.json))
assert.ok(registered.has('erp_order_detail'), '新网关的工具应按 erp_ 前缀注册')
assert.equal(erpSaved.json.registered.length, 1)
console.log(`PUT /gateway（erp）→ 注册 erp_order_detail，共 ${[...registered.keys()].length} 个工具`)

// 9. 在线测试可以指定网关
const badArgs = await call('POST', '/test', {
  file: specFile,
  tool: { name: 'probe', method: 'GET', path: '/v1/forecast', params: { latitude: { type: 'number', required: true }, longitude: { type: 'number', required: true } } },
  args: { latitude: 30 },
})
assert.equal(badArgs.status, 200, JSON.stringify(badArgs.json))
assert.equal(badArgs.json.result.ok, false)
assert.equal(badArgs.json.result.error, 'invalid_arguments')
assert.match(badArgs.json.result.message, /longitude/)
console.log(`POST /test（缺参）→ ${badArgs.json.result.error}「${badArgs.json.result.message}」`)

// 9b. 明文密钥不进界面回显；回传占位符不覆盖真实值
const erpWithSecret = { ...erpSpec, auth: { type: 'header', header: 'X-API-Key', value: 'sk-real-secret' } }
const savedSecret = await call('PUT', '/gateway', { file: erpFile, spec: erpWithSecret })
assert.equal(savedSecret.status, 200, JSON.stringify(savedSecret.json))
assert.equal(savedSecret.json.spec.auth.value, '***', '回显不能带明文密钥')
assert.equal(savedSecret.json.auth.valueSet, true, '但要告诉界面密钥已配置')
const roundTrip = await call('PUT', '/gateway', { file: erpFile, spec: savedSecret.json.spec })
assert.equal(roundTrip.status, 200, JSON.stringify(roundTrip.json))
assert.equal(JSON.parse(readFileSync(erpFile, 'utf8')).auth.value, 'sk-real-secret', '回传 *** 应合并回磁盘原值')
console.log('回显脱敏 → auth.value 显示 ***，回传后磁盘仍是原值')

// 9c. /test 不许客户端指定 baseUrl/auth，也不许绝对 URL
const ssrf = await call('POST', '/test', {
  file: specFile,
  tool: {
    name: 'probe',
    method: 'GET',
    path: '/v1/forecast',
    baseUrl: 'https://evil.example.com',
    auth: { type: 'header', header: 'X-API-Key', value: 'sk-leak' },
    params: { latitude: { type: 'number', required: true }, longitude: { type: 'number', required: true } },
  },
  args: { latitude: 30 },
})
assert.equal(ssrf.status, 200, JSON.stringify(ssrf.json))
assert.equal(ssrf.json.result.error, 'invalid_arguments', '客户端 baseUrl/auth 必须被丢弃，否则就是带着网关密钥的 SSRF')
const absolute = await call('POST', '/test', { file: specFile, tool: { name: 'probe', method: 'GET', path: 'https://evil.example.com/steal' }, args: {} })
assert.equal(absolute.status, 400)
assert.match(absolute.json.error, /绝对 URL/)
console.log('POST /test（客户端 baseUrl / 绝对 path）→ 覆盖参数被丢弃、绝对 URL 400')

// 10. 坏定义 / 缺 tool
const badTool = await call('POST', '/test', { tool: { name: 'nopath' }, args: {} })
assert.equal(badTool.status, 400)
assert.match(badTool.json.error, /缺少 path/)
const noTool = await call('POST', '/test', {})
assert.equal(noTool.status, 400)
assert.match(noTool.json.error, /缺少 tool/)
console.log('POST /test（坏定义/缺 tool）→ 400')

// 11. 删除网关 → 文件消失，工具注销，列表回到 1 个
const removed = await call('DELETE', `/gateway?file=${encodeURIComponent(erpFile)}`)
assert.equal(removed.status, 200, JSON.stringify(removed.json))
assert.equal(existsSync(erpFile), false)
assert.equal(removed.json.gateways.length, 1)
assert.equal(registered.has('erp_order_detail'), false, '删掉网关后工具应注销')
console.log(`DELETE /gateway → 剩 ${removed.json.gateways.length} 个网关，工具 ${[...registered.keys()].length} 个`)

// 12. 目录外文件不许操作
const outside = await call('DELETE', `/gateway?file=${encodeURIComponent(path.join(tmpdir(), 'evil.json'))}`)
assert.equal(outside.status, 400)
assert.match(outside.json.error, /网关目录/)
console.log('DELETE 目录外路径 → 400')

// 13. reload + 未知路由
const reloaded = await call('POST', '/reload')
assert.equal(reloaded.status, 200)
assert.equal(reloaded.json.ok, true)
const missing = await call('GET', '/nope')
assert.equal(missing.status, 404)
console.log('POST /reload → ok；GET /nope → 404')

// 14. 写操作确认：POST 接口返回 ask，GET 直接放行
const gate = events.get('tools/pre-execute')
assert.ok(gate, '应注册 tools/pre-execute 闸门')
const asked = await gate({ name: 'demo_demo_echo' }, async () => ({ kind: 'allow' }))
assert.equal(asked.kind, 'ask')
assert.match(asked.displayReason.zh, /写操作/)
assert.match(asked.displayReason.en, /write request/i)
const passed = await gate({ name: 'demo_demo_forecast' }, async () => ({ kind: 'allow' }))
assert.equal(passed.kind, 'allow')
const unknown = await gate({ name: 'not_ours' }, async () => ({ kind: 'allow' }))
assert.equal(unknown.kind, 'allow', '别的工具不受影响')
console.log(`pre-execute → demo_demo_echo 要确认，demo_demo_forecast 直接放行`)

// 15. 宿主 connection 可用时原样透传它的 401（不绕过认证）
const dir2 = mkdtempSync(path.join(tmpdir(), 'gateway-conn-'))
const specFile2 = path.join(dir2, 'apis.json')
writeFileSync(specFile2, JSON.stringify({ server: 'conn', baseUrl: 'https://conn.example.com', tools: [] }))
let handler2
const ctx2 = {
  tools: { register: () => () => {}, get: () => undefined },
  on: () => () => {},
  inject(names, callback) {
    if (!names.includes('webServer')) return () => {}
    callback({
      webServer: { register(route) { handler2 = route.handler; return () => {} } },
      get: (serviceName) => (serviceName === 'connection' ? { requestRejection: () => 401 } : undefined),
    })
    return () => {}
  },
}
plugin.apply(ctx2, { specFile: specFile2, watch: false })
await new Promise((resolve) => setTimeout(resolve, 300))
assert.ok(handler2, '第二实例应注册路由')
const unauthenticated = await callOn(handler2, 'GET', '/gateways')
assert.equal(unauthenticated.status, 401, 'connection 判定未认证时要原样返回 401')
assert.equal(unauthenticated.json.ok, false)
console.log('connection 可用 → 未认证请求 401 透传')

console.log('\n全部通过')
