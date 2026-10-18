/**
 * 把归一化后的接口集合编译成 DSH 工具定义（原生 ctx.tools.register 接受的普通对象）。
 *
 * 每个接口 = 一个工具。模型能看见的只有 name / description / parameters，
 * 所以描述里必须写清"什么时候用、返回什么、有没有副作用"。
 */
import { callApi } from './http.js'
import { jsonSafe } from './json.js'

function paramSchema(param) {
  if (param.type === 'json') return {}
  if (param.type === 'object') return { type: 'object', additionalProperties: true }
  const schema = { type: param.type }
  if (Array.isArray(param.enum) && param.enum.length > 0) schema.enum = param.enum
  if (param.default !== undefined) schema.default = param.default
  if (param.description) schema.description = param.description
  return schema
}

function parametersSchema(tool) {
  const properties = {}
  const required = []
  for (const param of tool.params) {
    if (param.in === 'header') continue
    properties[param.name] = paramSchema(param)
    if (param.required) required.push(param.name)
  }
  const schema = { type: 'object', additionalProperties: false, properties }
  if (required.length > 0) schema.required = required
  return schema
}

function descriptionFor(tool) {
  const lines = [tool.description, `接口：${tool.method} ${tool.absolute ? tool.template : `${tool.baseUrl}${tool.template}`}`]
  if (tool.params.length > 0) {
    const rendered = tool.params
      .filter((p) => p.in !== 'header')
      .map((p) => `${p.name}${p.required ? '' : '?'}:${p.type}${p.description ? `（${p.description}）` : ''}`)
    if (rendered.length > 0) lines.push(`参数：${rendered.join('，')}`)
  }
  if (tool.confirm) lines.push('⚠️ 写操作：会修改远端数据。调用时 DSH 会先弹审批，用户没批准就失败；调用前先把参数讲清楚。')
  else if (tool.dangerous) lines.push('⚠️ 写操作：会修改远端数据，只在用户明确要求时调用，调用前确认参数。')
  return lines.join('\n')
}

/** 编译成工具定义数组；deferLoading 用来控制工具很多时的上下文成本。 */
export function buildToolDefs(spec, options = {}) {
  const deferLoading = options.deferLoading ?? spec.tools.length > 20
  return spec.tools.map((tool) => {
    const definition = {
      name: tool.id,
      description: descriptionFor(tool),
      parameters: parametersSchema(tool),
      output: {
        schema: {},
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
      },
      isConcurrencySafe: () => !tool.dangerous,
      timeoutMs: tool.timeoutMs,
      async execute(rawArgs, exec) {
        const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {}
        // 结果统一过一遍无损 JSON 清洗，避免上游返回奇怪结构时被 DSH 判为 invalid output。
        return jsonSafe(await callApi(tool, args, { signal: exec?.signal }))
      },
    }
    if (deferLoading) definition.deferLoading = true
    return definition
  })
}
