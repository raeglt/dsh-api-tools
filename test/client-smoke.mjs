/**
 * 客户端插件用例：按 DSH 的模块装载约定（window.__ModuleLoader__）加载 lib/client.js，
 * 跑一遍 apply()，再把注册的分区组件渲染成静态 HTML。
 * React 复用 checkout 里的 18.3.1，不往插件目录加运行时依赖。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const requireFrom = createRequire('D:/AI/dsh/deepseek-harness/packages/client/ui-settings-general/package.json')
const React = requireFrom('react')
const { renderToStaticMarkup } = requireFrom('react-dom/server')

let definition
const sandbox = { window: { __ModuleLoader__: { load: (next) => { definition = next } } }, console }
vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), sandbox, { filename: 'client.js' })

assert.equal(definition.id, 'dsh-api-tools')
const plugin = definition.factory((specifier) => requireFrom(specifier))
assert.equal(JSON.stringify(plugin.inject), '["slots"]')
assert.equal(typeof plugin.apply, 'function')

let slot
const ctx = {
  slots: {
    inject(name, callback) {
      assert.equal(name, 'settings.section')
      callback()
      return () => {}
    },
    register(options, component) {
      slot = { options, component }
      return () => {}
    },
  },
}
plugin.apply(ctx)
assert.ok(slot, '应注册 settings.section')
assert.equal(slot.options.id, 'api-tools')
assert.equal(slot.options.label(), '接口网关')
console.log(`注册分区：${slot.options.id} / ${slot.options.label()} / order=${slot.options.order}`)

const Section = slot.component
const render = (props) => renderToStaticMarkup(React.createElement(Section, props))

// 1. 首屏（无数据）→ 加载中
const loading = render({})
assert.match(loading, /加载中/)
console.log(`首屏渲染成功（${loading.length} 字节 HTML）`)

// 2. 网关列表页：两个网关，一个正常一个空
const gatewayList = {
  ok: true,
  status: 'ok',
  dir: 'C:/Users/Administrator/.dsh/api-tools',
  tools: ['demo_demo_forecast', 'erp_order_detail'],
  problems: ['demo：tools[1] 缺少 path'],
  gateways: [
    { file: 'C:/Users/Administrator/.dsh/api-tools/apis.json', name: 'apis.json', server: 'demo', baseUrl: 'https://api.open-meteo.com', tools: ['demo_demo_forecast'], empty: false, problems: [] },
    { file: 'C:/Users/Administrator/.dsh/api-tools/erp.json', name: 'erp.json', server: 'erp', baseUrl: 'https://erp.example.com', tools: [], empty: true, problems: [] },
  ],
}
const list = render({ initialGateways: gatewayList })
for (const expected of ['API 网关', '网关列表', '新增网关', 'demo', 'apis.json', 'erp', 'https://erp.example.com', '正常', '空', '编辑', '删除', '加载告警']) {
  assert.ok(list.includes(expected), `网关列表应包含「${expected}」`)
}
console.log(`网关列表渲染成功（${list.length} 字节 HTML）`)

// 3. 新增网关表单：服务名 / baseUrl / 鉴权
const creating = render({ initialGateways: gatewayList, initialCreating: { server: 'crm', baseUrl: 'https://crm.example.com', authType: 'header', header: 'X-API-Key', queryName: '', env: 'CRM_KEY' } })
for (const expected of ['新增网关', '服务名', 'baseUrl', '鉴权方式', '密钥环境变量', '鉴权头名', '创建网关', 'CRM_KEY']) {
  assert.ok(creating.includes(expected), `新增网关表单应包含「${expected}」`)
}
console.log(`新增网关表单渲染成功（${creating.length} 字节 HTML）`)

// 4. 单个网关的编辑页
const state = {
  ok: true,
  status: 'ok',
  file: 'C:/Users/Administrator/.dsh/api-tools/apis.json',
  registered: ['demo_demo_forecast'],
  problems: ['tools[1] (broken) 缺少 path'],
  entries: [
    { index: 0, name: 'demo_forecast', method: 'GET', path: '/v1/forecast', enabled: true, params: 3, error: undefined },
    { index: 1, name: 'broken', method: 'GET', path: undefined, enabled: true, params: 0, error: 'tools[1] (broken) 缺少 path' },
  ],
  spec: {
    server: 'demo',
    baseUrl: 'https://api.open-meteo.com',
    auth: { type: 'bearer', env: 'DEMO_TOKEN' },
    defaults: { timeoutMs: 30000, maxResponseChars: 8000 },
    tools: [
      { name: 'demo_forecast', method: 'GET', path: '/v1/forecast', params: [{ name: 'latitude', type: 'number', required: true }] },
      { name: 'broken' },
    ],
  },
}
const editorProps = { initialFile: state.file, initialData: state, initialDraft: structuredClone(state.spec) }
const full = render({ ...editorProps, initialView: 'edit' })
for (const expected of ['接口列表', 'demo_forecast', '编辑', '新增接口', '缺少 path', '密钥环境变量', 'DEMO_TOKEN', '返回列表']) {
  assert.ok(full.includes(expected), `编辑页应包含「${expected}」`)
}
assert.ok(full.includes('▾'), '折叠标题行应带箭头')
console.log(`编辑页渲染成功（${full.length} 字节 HTML）`)

// 5. 编辑表单：方法/路径各占一行、参数行带「示例值」、保存旁边有「在线测试」
const editing = {
  index: 0,
  name: 'demo_forecast',
  method: 'GET',
  path: '/v1/forecast',
  description: '天气',
  baseUrl: '',
  enabled: true,
  dangerous: false,
  params: [{ name: 'latitude', in: 'query', type: 'number', required: true, description: '纬度', example: '30.58' }],
}
const form = render({ ...editorProps, initialView: 'edit', initialEditing: editing })
for (const expected of ['编辑接口 #1', '在线测试', '示例值', '保存接口', '30.58', '请求方法', '请求路径']) {
  assert.ok(form.includes(expected), `编辑表单应包含「${expected}」`)
}
assert.ok(!form.includes('44px 108px 44px'), '方法/路径不应再是四列网格（改成各占一行）')
console.log(`编辑表单渲染成功（${form.length} 字节 HTML）`)

console.log('\n全部通过')
