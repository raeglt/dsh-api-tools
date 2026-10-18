/**
 * 用 DSH 真实注册表所用的 schema 校验器检查每个工具定义，
 * 避免"插件装上了但 register 抛 TypeError"的情况。
 * 运行：cd D:\AI\dsh\deepseek-harness; node --import tsx/esm D:\AI\dsh\dsh-api-tools\test\validate-schemas.mjs
 */
import { assertSupportedJsonSchema } from 'file:///D:/AI/dsh/deepseek-harness/packages/core/tools/src/json-schema.ts'
import { loadSpec } from '../lib/spec.js'
import { buildToolDefs } from '../lib/tools.js'

const spec = await loadSpec(process.argv[2] ?? 'apis.example.json', {})
const defs = buildToolDefs(spec)
let failures = 0

for (const def of defs) {
  const problems = []
  if (typeof def.name !== 'string' || def.name.trim() === '') problems.push('缺少 name')
  if (typeof def.description !== 'string' || def.description.trim() === '') problems.push('缺少 description')
  if (typeof def.execute !== 'function') problems.push('缺少 execute')
  if (!def.output || typeof def.output.render !== 'function') problems.push('缺少 output.render')
  try {
    assertSupportedJsonSchema(def.parameters)
  } catch (err) {
    problems.push(`parameters 不被 DSH 接受：${err.message}`)
  }
  try {
    assertSupportedJsonSchema(def.output?.schema)
  } catch (err) {
    problems.push(`output.schema 不被 DSH 接受：${err.message}`)
  }
  if (problems.length > 0) {
    failures += 1
    console.log(`✗ ${def.name}`)
    for (const problem of problems) console.log(`   - ${problem}`)
  } else {
    console.log(`✓ ${def.name}  (deferLoading=${def.deferLoading === true})`)
  }
}

console.log(failures === 0 ? `\n全部 ${defs.length} 个工具定义通过校验` : `\n${failures} 个定义有问题`)
process.exitCode = failures === 0 ? 0 : 1
