/**
 * 离线验证脚本：不启动 DSH，直接跑 spec 解析 + 工具定义 + 真实 HTTP 调用。
 * 用法：node test/run.mjs [specFile]
 */
import { loadSpec } from '../lib/spec.js'
import { buildToolDefs } from '../lib/tools.js'

const specFile = process.argv[2] ?? 'apis.example.json'
const spec = await loadSpec(specFile, { timeoutMs: 20000, maxResponseChars: 6000 })
console.log('spec:', spec.file)
console.log('server:', spec.server, '| tools:', spec.tools.length)
for (const tool of spec.tools) {
  console.log(` - ${tool.id}  ${tool.method} ${tool.absolute ? tool.template : tool.baseUrl + tool.template}  params=${tool.params.map((p) => `${p.name}:${p.in}`).join(',')}`)
}
if (spec.problems.length > 0) console.log('problems:', spec.problems)

const defs = buildToolDefs(spec)
const byName = new Map(defs.map((d) => [d.name, d]))
const signal = AbortSignal.timeout(25000)

async function run(label, toolName, args) {
  const def = byName.get(toolName)
  try {
    const result = await def.execute(args, { signal })
    console.log(`\n[${label}] ${toolName} -> ok=${result.ok} status=${result.status}`)
    console.log(JSON.stringify(result).slice(0, 500))
  } catch (err) {
    console.log(`\n[${label}] ${toolName} -> thrown: ${err.message}`)
  }
}

await run('正常调用', 'demo_city_lookup', { name: 'Wuhan', count: 2 })
await run('正常调用', 'demo_weather_forecast', { latitude: 30.5928, longitude: 114.3055, forecast_days: 3 })
await run('缺必填', 'demo_weather_forecast', { latitude: 30.5928 })
await run('未知参数', 'demo_weather_forecast', { latitude: 30.5928, longitude: 114.3055, foo: 1 })
await run('HTTP 404', 'demo_city_lookup', { name: 'Wuhan', count: 'abc' })

console.log('\n参数 schema 示例：')
console.log(JSON.stringify(byName.get('demo_weather_forecast').parameters, null, 2))
