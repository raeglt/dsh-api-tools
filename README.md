# dsh-api-tools

把一组 RESTful 接口转成 DSH 工具集：**一个网关文件（JSON/YAML）描述一组接口，每个接口自动注册成一个工具**，模型直接调用，不需要写 MCP server、也不经过协议层。

已安装进 `web` profile（`link:D:/AI/dsh/dsh-api-tools`），网关目录默认是 `C:\Users\Administrator\.dsh\api-tools`——**目录里一个 `.json` 就是一个网关**，可以同时装很多个（各自的 baseUrl / 鉴权 / 接口列表），工具名靠各自的 `server` 前缀区分。

> 旧版叫 `dsh-api-gateway`、目录是 `~/.dsh/api-gateway`。改名后首次加载会自动把旧目录搬到 `~/.dsh/api-tools`（新目录已存在则不动），配置不用手改。

## 快速上手

1. 打开 Web 界面：**设置（Settings）→ 接口网关**，列表页能新建 / 删除网关，点「编辑」进去增删改接口，点「保存接口」即写入磁盘并热重载。
2. 插件监听网关目录和每个网关文件的 mtime，改动后**自动热重载**，下一轮对话即可看到新工具。
3. 不确定加载状态时，让模型调 `api_tools_status`，或看 web 进程日志里的 `[api-tools]` 行。

## Web 配置界面

设置面板里新增「接口网关」分区，分两层：

**网关列表页**

- 一行一个网关：服务名 + 文件名、`baseUrl`、工具数、状态（正常 / 空 / 错误）。
- 「+ 新增网关」：填服务名、`baseUrl`、鉴权方式（none / bearer / header / query + 密钥环境变量），创建后目录里多一个 `<服务名>.json`（空接口列表），并直接进入编辑页。
- 每行可「编辑」或「删除」（删除是二次确认，删的是磁盘上的网关文件）。
- 顶部显示网关目录、网关数与工具总数、加载告警。

**单个网关的编辑页**

- **基础配置**和**接口列表**两张卡片都能点标题折叠/展开（折叠时标题旁给出摘要，比如 `共 4 个接口`）。
- 接口列表：工具名 / 方法 / 路径 / 参数数，每行带**启停、编辑、删除**；坏条目会就地把错误显示在行内。
- 新增 / 编辑接口：工具名、说明、**请求方法**、**请求路径**（各占一行；`{id}` 自动成为必填路径参数）、独立 baseUrl、写操作标记，以及逐行的**参数编辑器**（名称 / 位置 query·path·body·header / 类型 / 必填 / 说明 / **示例值**）。
- **在线测试**：编辑表单里「保存接口」旁边，用参数行的「示例值」当入参直接把这一条打出去（不落盘、不注册工具）；返回状态码、耗时、最终 URL 和响应体，缺必填参数/未知参数会当场报错。填了示例值的参数才会被带上。
- 基础配置：`server` 前缀、默认 `baseUrl`、鉴权方式、超时、响应截断长度。
- 「← 返回列表」回到网关列表。

对应 HTTP 接口（插件在宿主进程内注册，同源即可用）：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api-tools/v1/gateways` | 网关列表 + 每个网关注册了哪些工具 |
| GET | `/api-tools/v1/gateway?file=…` | 单个网关的 spec + 每条接口的校验结果 |
| POST | `/api-tools/v1/gateways` | 新建网关：body `{ server, baseUrl, auth? }`，生成 `<server>.json`；重名返回 409 |
| PUT | `/api-tools/v1/gateway` | 保存网关：body `{ file, spec }`（先校验，有问题的配置拒绝写入并返回 400） |
| DELETE | `/api-tools/v1/gateway?file=…` | 删除网关文件（只允许网关目录内的路径） |
| POST | `/api-tools/v1/reload` | 重新加载并注册全部工具 |
| POST | `/api-tools/v1/test` | 在线测试：body `{ file?, tool, args }`，用该网关的 baseUrl/鉴权直连，返回 `{ ok, tool, args, result }` |

保存是**原子写**（临时文件 + rename），坏配置不会覆盖掉正在用的好配置；任何改动都写回对应网关文件，所以界面和手改 JSON 可以混用。旧路径 `GET/PUT /api-tools/v1/spec` 仍可用（等价于操作默认的 `apis.json`）。

## spec 结构

```jsonc
{
  "server": "erp",                       // 工具名前缀：最终名字是 <server>_<tool.name>
  "baseUrl": "https://erp.internal/api", // 默认基址；每个工具可用 baseUrl 覆盖
  "auth": { "type": "none" },            // 默认鉴权；工具可覆盖
  "defaults": {
    "timeoutMs": 30000,
    "maxResponseChars": 8000,            // 响应截断长度，防止灌爆上下文
    "headers": { "User-Agent": "dsh-api-tools/0.1" }
  },
  "tools": [ /* 见下 */ ]
}
```

### 一个工具

```jsonc
{
  "name": "order_detail",                // 小写下划线；最终工具名 erp_order_detail
  "description": "按订单号查订单详情，返回状态、金额、收货人。已知订单号时用它。",
  "method": "GET",
  "path": "/orders/{orderId}",           // {x} 自动变成必填路径参数
  "params": {
    "orderId": { "in": "path", "type": "string", "required": true, "description": "订单号" },
    "withLogistics": { "in": "query", "type": "boolean", "description": "是否返回物流轨迹" },
    "amount": { "in": "body", "type": "number", "description": "POST/PUT 的 JSON body 字段" }
  }
}
```

| 字段 | 说明 |
|---|---|
| `name` | 工具名主体，只保留 `[A-Za-z0-9_]`，最终名 `<server>_<name>` |
| `description` | **最重要**：写清"什么时候用、返回什么、有无副作用"，模型靠它选工具 |
| `method` | 默认 `GET`；非 GET 默认视为写操作 |
| `path` | 相对 `baseUrl`，或以 `http(s)://` 开头的完整 URL |
| `baseUrl` | 覆盖顶层基址（同一网关接多个服务时用） |
| `params` | 对象或数组；见下 |
| `enabled` | `false` 时不注册（模板占位用） |
| `dangerous` | 默认非 GET 为 `true`；描述里会加"写操作"警告 |
| `confirm` | 默认等于 `dangerous`；为 `true` 时**每次调用都走 DSH 审批**：用户没批准就不发请求（见下节） |
| `timeoutMs` / `maxResponseChars` | 覆盖默认值 |
| `headers` | 该工具额外的请求头 |

### 写操作确认

`confirm: true` 的工具在真正发请求前会触发 DSH 原生审批（插件在 `tools/pre-execute` 里返回 `{ kind: 'ask', ... }`）：

- 宿主有审批通道（桌面/Web 的审批弹窗）→ 模型每次调用都会问用户，用户点"允许"才执行，拒绝则本次调用失败。
- 审批策略是 `never`、或没有可用审批者 → **直接拒绝**，模型会收到"the user rejected tool ..."这类结果。这是 DSH 的既定行为，不是插件 bug。
- 想让自动化流水线不被打断：给那个工具写 `"confirm": false`（保持 `dangerous: true` 仍然会串行执行、描述里也有警告）。

界面上对应「写操作（会修改远端数据）」和「调用前要人工确认」两个勾选框；取消前者会自动把后者也取消。

### 参数

`in` 可省：路径占位符 → `path`；GET/HEAD/DELETE → `query`；其他方法 → `body`（body 字段会合成一个 JSON 对象）。
`type`：`string` `number` `integer` `boolean` `array` `object` `json`（`json` 只对名为 `body` 的参数有意义，直接把整个 body 传给它）。
另有 `enum`、`default`、`required`、`description`、`example`（示例值，界面的「在线测试」拿它当入参）。

### 鉴权

```jsonc
"auth": { "type": "header", "header": "X-API-Key", "env": "ERP_API_KEY" }  // 推荐：密钥放环境变量
"auth": { "type": "bearer", "env": "ERP_TOKEN" }                          // Authorization: Bearer <env>
"auth": { "type": "query", "queryName": "apikey", "env": "ERP_KEY" }
"auth": { "type": "header", "header": "X-API-Key", "value": "明文密钥" }   // 不推荐
```

`env` 指向的环境变量必须是 **web 进程**的环境变量：在启动 `dsh web` 的那个终端里设置，例如 PowerShell 里 `$env:ERP_API_KEY='...'`，或写进 profile 的启动脚本。

## 行为约定

- **工具数量**：超过 20 个自动加 `deferLoading`，定义按需加载，不占常驻上下文。
- **响应**：`{ ok, status, method, url, durationMs, data | text, truncated? }`；4xx/5xx 不抛异常，返回 `ok:false` 让模型自己判断；URL 里的 `apikey/token/secret/...` 会被打码。
- **参数校验**：DSH 按 JSON Schema 校验；缺必填/多传字段直接判定失败，不会发出请求。
- **安全**：只允许访问 spec 里出现的 host；路径参数强制 `encodeURIComponent`；不提供"任意 URL"工具。配置界面本身的安全边界见下一节。
- **写操作**：非幂等方法默认 `dangerous`（同工具串行执行），并默认 `confirm`（调用前走 DSH 审批）。详见「写操作确认」。
- **返回值必须是无损 JSON**：DSH 会对工具结果做 `JSON.stringify → JSON.parse` 的快照，任何 `undefined`、`NaN`、`Infinity`、`-0`、`Date`、循环引用都会让整次调用报 `invalid output: value is not lossless JSON`。所有返回值都统一过 `lib/json.js` 的 `jsonSafe()` 清洗。

## 配置界面的安全边界

`/api-tools/v1` 是**写配置**的接口（能改 baseUrl 和鉴权，等价于改这台机器发出去的请求），所以默认只对本机同源开放：

- **来源栅栏**：优先复用宿主 `connection` 服务的 `requestRejection()`——Host 必须回环（防 DNS rebinding）、拒绝 `sec-fetch-site: cross-site`、Origin 必须与 Host 同 authority（`null` 拒绝），并校验浏览器会话；拿不到该服务（旧版本 / 桌面 profile）时退回内置的 Host/Origin 自查，此时只挡跨站、不做认证。
- **实际效果**：DSH Web 界面里正常使用；`curl` 直接打会得到 `401 unauthorized`（connection 服务可用时）。用 `--host 0.0.0.0` 暴露到局域网时，只有 `trustedHosts` 白名单里的 authority 能进。
- **在线测试**：`POST /test` 只允许用网关文件里的 `baseUrl` 和鉴权，请求体里的 `baseUrl/auth/headers/followRedirects` 一律丢弃，`path` 不允许绝对 URL——否则这里就成了「带着网关密钥打任意地址」的 SSRF 出口。
- **密钥不回显**：`auth.value` 和敏感 header 在界面上以 `***` 显示；保存时 `***` 视为「未修改」，会合并回磁盘上的原值，不会把配置覆盖成星号。
- **文件权限**：网关文件按 `0600` 写入、目录按 `0700` 创建（POSIX；Windows 上由 ACL 决定）。

## 排错

| 现象 | 排查 |
|---|---|
| 工具没出现 | 调 `api_tools_status` 看 `status`/`error`；确认 spec 路径 |
| 改了 spec 但不生效 | 看 mtime 是否被改（某些编辑器保存到临时文件再替换会触发）；直接重开一轮对话 |
| `环境变量 XXX 未设置` | 在启动 web 的终端里设置后重启 web |
| `returned invalid output: value is not lossless JSON` | 工具返回值里混进了 `undefined`/`NaN`/`Date`/循环引用；改为返回前过 `jsonSafe()`（内置工具已处理，只影响自写工具） |
| 大量工具挤占上下文 | 拆成多个 spec 文件/多个 `server` 前缀，或用 `enabled:false` 关掉不用的 |

状态工具返回的 `problems` 字段会列出被跳过的坏条目（单条 spec 写错不会拖垮整份配置；但整份解析失败时会保留上一版可用工具）。

## 开发

```powershell
cd D:\AI\dsh\dsh-api-tools
node test/run.mjs                 # 直接打真实接口，验证 spec 与调用链
node test/apply-smoke.mjs         # 用假 ctx 跑 apply()，验证注册与清理
node test/lossless.mjs            # 工具返回值必须是无损 JSON（undefined/NaN/Date/循环引用）
node test/web-api.mjs             # 用假 webServer 跑一遍配置界面的 HTTP 接口
node test/client-smoke.mjs        # SSR 渲染客户端 bundle，验证设置页能挂载
cd D:\AI\dsh\deepseek-harness
node --import tsx/esm D:\AI\dsh\dsh-api-tools\test\validate-schemas.mjs   # 用 DSH 真实校验器检查 schema
```

## 依赖的 DSH 契约

插件**不依赖任何 `@deepseek-ai/*` npm 包**（`dependencies` 只有 `yaml`），但运行时依赖下面这些 DSH 内部约定。它们不是公开稳定 API，DSH 大版本升级后可能变化——升级完把「开发」里的 6 个测试跑一遍即可确认。

| 契约 | 用在哪 | 验证于 |
|---|---|---|
| `ctx.tools.register({ name, description, parameters, output: { schema, render }, timeoutMs, execute })`，同名重复注册报错 | `lib/tools.js` | DSH 0.2.1-rc.2 |
| `output.schema` 必须是 JSON Schema 子集（`assertSupportedJsonSchema`），不接受 `{type:'json'}`；`output.render` 必须是函数 | `lib/tools.js` | 同上 |
| `inject=['tools']`；访问未 inject 的服务（如 `ctx.logger`）会直接抛异常，并把整个插件条目回滚 | `lib/index.js` | 同上 |
| `ctx.inject(['webServer'], scoped => ...)` + `webServer.register({ kind:'prefix', path, handler })`（node 风格 `req/res`；handler 要返回 promise） | `lib/index.js` | 同上 |
| 客户端 bundle：`window.__ModuleLoader__.load({ id, factory })`，CJS 包装，外部模块只能 `require('react')` 等白名单（`packages/client/web/src/platform.ts` 的 `PLATFORM_MODULES`） | `lib/client.js` | 同上 |
| `package.json` 的 `dsh.bundle.patch`、`exports["./client"]`、`dsh.client = { platform:'web', inject:[...] }` | `package.json` | 同上 |
| slot `settings.section`，`register({ name:'settings.section', id, order, label }, Component)`；组件要直接传，不能包一层 | `lib/client.js` | 同上 |
| `ctx.on('tools/pre-execute', (exec, next) => ...)` 返回 `{ kind:'ask', reason, displayReason:{ en, zh } }` 触发原生审批；`exec.name` 是被调工具名 | `lib/index.js` | 同上 |
| profile 插件装载：`dsh plugin --profile web add <dir>` 写 `dsh.profile.bundles` + `dependencies`（`link:`），重启生效 | 安装 | 同上 |

失效时的典型表现：

- `[api-tools]` 日志出现 `did not activate` / `cannot get property ... without inject` → 宿主 API 变了，工具全部不注册。
- 设置页没有「接口网关」入口、浏览器控制台报 `__ModuleLoader__` 相关错误 → 客户端 bundle 或 slot 变了（工具通常仍在）。
- `pnpm dsh plugin list` 里看不到插件 → profile 被改，重装即可。

## 卸载

```powershell
cd D:\AI\dsh\deepseek-harness
pnpm dsh plugin --profile web remove dsh-api-tools
```
