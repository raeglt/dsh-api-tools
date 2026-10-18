/**
 * 冒烟测试：用假的 ctx 跑一遍插件 apply()，确认工具真的被注册、状态工具可用。
 * 不启动 DSH、不调模型。
 */
const registered = []
const disposers = []
const ctx = {
  tools: {
    register(definition) {
      registered.push(definition)
      const dispose = () => {
        const index = registered.indexOf(definition)
        if (index >= 0) registered.splice(index, 1)
      }
      disposers.push(dispose)
      return dispose
    },
  },
  logger: {
    info: (message) => console.log('[info]', message),
    warn: (message) => console.log('[warn]', message),
    error: (message) => console.error('[error]', message),
  },
}

const plugin = await import('../lib/index.js')
plugin.apply(ctx, {})
await new Promise((resolve) => setTimeout(resolve, 300))

console.log('\n注册的工具：')
for (const definition of registered) console.log(` - ${definition.name}`)

const status = registered.find((definition) => definition.name === 'api_gateway_status')
console.log('\nstatus 工具输出：')
console.log(JSON.stringify(await status.execute({}, {}), null, 1))

const weather = registered.find((definition) => definition.name === 'demo_weather_forecast')
console.log('\n直接调用 demo_weather_forecast：')
const result = await weather.execute({ latitude: 30.5928, longitude: 114.3055, forecast_days: 2 }, { signal: AbortSignal.timeout(20000) })
console.log(`ok=${result.ok} status=${result.status} 有 data=${result.data !== undefined}`)
console.log(JSON.stringify(result.data?.daily ?? result).slice(0, 300))

for (const dispose of disposers.reverse()) dispose()
console.log(`\n清理后剩余工具：${registered.length}`)
