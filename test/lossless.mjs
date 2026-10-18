/**
 * 无损 JSON 回归测试。
 *
 * DSH 会把工具返回值做一次「无损 JSON」快照，对象里只要有一处 `undefined`
 * 就会整条报 `tool "..." returned invalid output: value is not lossless JSON`，
 * 工具调用直接失败。这里固定住三件事：
 *   1. jsonSafe() 的清洗规则；
 *   2. 状态工具（最容易带 undefined 的那个）输出必须是无损 JSON；
 *   3. 真实网关工具失败路径的返回值也必须无损。
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isLosslessJson, jsonSafe } from '../lib/json.js'

// ---- 1. jsonSafe 单元 -----------------------------------------------------
assert.deepEqual(
  jsonSafe({ a: 1, b: undefined, c: NaN, d: [undefined, 2], e: new Date('2026-10-18T00:00:00.000Z') }),
  { a: 1, c: null, d: [null, 2], e: '2026-10-18T00:00:00.000Z' },
)
assert.deepEqual(jsonSafe({ n: Infinity, z: -0, big: 1n, fn: () => 1 }), { n: null, z: null, big: '1' })
const circular = { name: 'loop' }
circular.self = circular
assert.deepEqual(jsonSafe(circular), { name: 'loop', self: '[Circular]' })
assert.ok(isLosslessJson(jsonSafe({ a: [1, { b: null }], c: 'x' })))
assert.equal(isLosslessJson({ a: undefined }), false)

// ---- 2. 状态工具输出 ------------------------------------------------------
const home = mkdtempSync(path.join(tmpdir(), 'api-tools-lossless-'))
process.env.DSH_HOME = home
mkdirSync(path.join(home, 'api-tools'), { recursive: true })
// 空网关：state 里会有 error/loadedAt/auth 等一堆 undefined，正好覆盖出问题的场景
writeFileSync(path.join(home, 'api-tools', 'apis.json'), JSON.stringify({ server: 'demo2', baseUrl: 'https://example.com', tools: [] }))

const registered = []
const ctx = {
  tools: {
    register(definition) {
      registered.push(definition)
      return () => {}
    },
  },
  on: () => () => {},
}
const plugin = await import('../lib/index.js')
plugin.apply(ctx, {})
await new Promise((resolve) => setTimeout(resolve, 400))

const statusTool = registered.find((definition) => definition.name === 'api_tools_status')
assert.ok(statusTool, '状态工具应该已注册')
const statusValue = await statusTool.execute({}, {})
assert.ok(isLosslessJson(statusValue), `状态工具输出必须是无损 JSON：${JSON.stringify(statusValue)}`)
assert.deepEqual(JSON.parse(JSON.stringify(statusValue)), statusValue)
assert.equal(statusValue.gateways.length, 1)
assert.equal(statusValue.gateways[0].server, 'demo2')
assert.equal(statusValue.gateways[0].empty, true)

// ---- 3. 接口工具失败路径 --------------------------------------------------
writeFileSync(
  path.join(home, 'api-tools', 'bad.json'),
  JSON.stringify({
    server: 'bad',
    baseUrl: 'http://127.0.0.1:9',
    defaults: { timeoutMs: 2000 },
    tools: [{ name: 'ping', description: '连接必然失败', method: 'GET', path: '/ping', enabled: true }],
  }),
)
await new Promise((resolve) => setTimeout(resolve, 1500))
const ping = registered.find((definition) => definition.name === 'bad_ping')
assert.ok(ping, '新网关的工具应该热重载注册进来')
const failed = await ping.execute({}, {})
assert.equal(failed.ok, false)
assert.ok(isLosslessJson(failed), `失败结果也必须是无损 JSON：${JSON.stringify(failed)}`)
assert.deepEqual(JSON.parse(JSON.stringify(failed)), failed)

console.log('lossless ok:', JSON.stringify(statusValue).slice(0, 180), '…')
process.exit(0)
