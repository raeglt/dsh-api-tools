/**
 * 浏览器端：在「设置 → 接口网关」里给 api-tools 插件一个配置界面。
 *
 * 打包约定（DSH 客户端插件）：文件由 window.__ModuleLoader__ 加载，模块里导出
 * inject / apply；apply 里往 slots 注册分区。这里只用 react 一个外部依赖，
 * 样式全走内联，避免额外构建步骤。
 */
window.__ModuleLoader__.load({
  id: 'dsh-api-tools',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const h = React.createElement

    const API = '/api-tools/v1'
    const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']
    const PARAM_IN = ['query', 'path', 'body', 'header']
    const PARAM_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object', 'json']
    const AUTH_TYPES = ['none', 'bearer', 'header', 'query']

    const MUTED = 'rgba(127,127,127,0.95)'
    const FAINT = 'rgba(127,127,127,0.55)'
    const LINE = '1px solid rgba(127,127,127,0.3)'

    // 工具名列窄、操作列宽：三个按钮（编辑/启停/删除）必须挤在一行里。
    const LIST_COLUMNS = 'minmax(56px,0.85fr) 50px minmax(64px,1.4fr) 34px 146px'
    // 参数行：名称 / 位置 / 类型 / 必填 / 说明 / 示例 / 删除
    const PARAM_COLUMNS = 'minmax(58px,1fr) 62px 72px 38px minmax(60px,1fr) minmax(60px,1fr) 24px'
    // 网关列表：服务名 / baseUrl / 工具数 / 状态 / 操作
    const GATEWAY_COLUMNS = 'minmax(88px,0.9fr) minmax(120px,2fr) 54px 64px 118px'

    const S = {
      root: { display: 'flex', flexDirection: 'column', gap: 12, padding: '2px 2px 28px', fontSize: 13, color: 'inherit', minWidth: 0 },
      head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
      title: { fontSize: 14, fontWeight: 600 },
      hint: { fontSize: 11, color: MUTED, wordBreak: 'break-all' },
      card: { border: LINE, borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 },
      row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      grid2: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
      label: { fontSize: 12, color: MUTED },
      labelWide: { fontSize: 12, color: MUTED, flex: '0 0 108px', minWidth: 108 },
      input: { width: '100%', boxSizing: 'border-box', padding: '5px 8px', borderRadius: 6, border: LINE, background: 'transparent', color: 'inherit', fontSize: 12, fontFamily: 'inherit' },
      select: { width: '100%', boxSizing: 'border-box', padding: '5px 6px', borderRadius: 6, border: LINE, background: 'transparent', color: 'inherit', fontSize: 12, fontFamily: 'inherit' },
      btn: { padding: '4px 10px', borderRadius: 6, border: LINE, background: 'rgba(127,127,127,0.12)', color: 'inherit', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' },
      btnPrimary: { padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(80,140,255,0.6)', background: 'rgba(80,140,255,0.18)', color: 'inherit', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' },
      btnDanger: { padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(200,60,60,0.45)', background: 'transparent', color: 'inherit', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' },
      btnTiny: { padding: '2px 8px', borderRadius: 6, border: LINE, background: 'transparent', color: 'inherit', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' },
      listHead: { display: 'grid', gridTemplateColumns: LIST_COLUMNS, gap: 6, fontSize: 11, color: FAINT, padding: '0 2px 4px' },
      listRow: { display: 'grid', gridTemplateColumns: LIST_COLUMNS, gap: 6, alignItems: 'center', padding: '6px 2px', borderTop: '1px solid rgba(127,127,127,0.16)' },
      gwHead: { display: 'grid', gridTemplateColumns: GATEWAY_COLUMNS, gap: 8, fontSize: 11, color: FAINT, padding: '0 2px 4px' },
      gwRow: { display: 'grid', gridTemplateColumns: GATEWAY_COLUMNS, gap: 8, alignItems: 'center', padding: '8px 2px', borderTop: '1px solid rgba(127,127,127,0.16)' },
      ops: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap' },
      cardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
      collapseBtn: { display: 'flex', alignItems: 'center', gap: 5, padding: 0, border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' },
      caret: { fontSize: 10, color: MUTED, width: 9 },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, wordBreak: 'break-all' },
      badge: { fontSize: 10, padding: '1px 6px', borderRadius: 999, border: LINE, color: MUTED, whiteSpace: 'nowrap' },
      badgeOk: { fontSize: 10, padding: '1px 6px', borderRadius: 999, border: '1px solid rgba(47,158,68,0.45)', color: '#2f9e44', whiteSpace: 'nowrap' },
      badgeErr: { fontSize: 10, padding: '1px 6px', borderRadius: 999, border: '1px solid rgba(224,49,49,0.45)', color: '#e03131', whiteSpace: 'nowrap' },
      err: { fontSize: 12, color: '#e03131', wordBreak: 'break-word' },
      ok: { fontSize: 12, color: '#2f9e44' },
      notice: { fontSize: 12, color: '#1c7ed6' },
      paramsBox: { display: 'flex', flexDirection: 'column', gap: 6 },
      paramRow: { display: 'grid', gridTemplateColumns: PARAM_COLUMNS, gap: 5, alignItems: 'center' },
      divider: { height: 1, background: 'rgba(127,127,127,0.2)', margin: '2px 0' },
      gatewayName: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, fontWeight: 600, wordBreak: 'break-all' },
      createBox: { display: 'flex', flexDirection: 'column', gap: 8, border: '1px dashed rgba(127,127,127,0.4)', borderRadius: 10, padding: 12, minWidth: 0 },
    }

    const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

    async function request(method, route, body) {
      const init = { method }
      if (body !== undefined) {
        init.headers = { 'content-type': 'application/json' }
        init.body = JSON.stringify(body)
      }
      const response = await fetch(`${API}${route}`, init)
      let data
      try {
        data = await response.json()
      } catch {
        data = { ok: false, error: `HTTP ${response.status}` }
      }
      if (!response.ok || data.ok === false) throw new Error(data.error ?? `HTTP ${response.status}`)
      return data
    }

    function Button(props) {
      const { variant, children, ...rest } = props
      return h('button', { type: 'button', style: variant === 'primary' ? S.btnPrimary : variant === 'danger' ? S.btnDanger : variant === 'tiny' ? S.btnTiny : S.btn, ...rest }, children)
    }

    function Field(props) {
      const { label, children } = props
      return h('label', { style: S.grid2 },
        h('span', { style: S.labelWide }, label),
        h('div', { style: { flex: '1 1 0', minWidth: 0 } }, children),
      )
    }

    function TextInput(props) {
      return h('input', { ...props, style: { ...S.input, ...(props.style ?? {}) } })
    }

    function Select(props) {
      const { options, ...rest } = props
      return h('select', { ...rest, style: { ...S.select, ...(props.style ?? {}) } }, options.map((item) => h('option', { key: item, value: item }, item)))
    }

    /** 可折叠卡片：标题行始终可见，内容区按 collapsed 收起。 */
    function SectionCard(props) {
      const { title, collapsed, onToggle, actions, hint, children } = props
      return h('div', { style: S.card },
        h('div', { style: S.cardHead },
          h('button', { type: 'button', style: S.collapseBtn, title: collapsed ? '展开' : '折叠', onClick: onToggle },
            h('span', { style: S.caret }, collapsed ? '▸' : '▾'),
            h('span', { style: S.title }, title),
            hint ? h('span', { style: S.hint }, hint) : null,
          ),
          actions ? h('div', { style: S.row }, actions) : null,
        ),
        collapsed ? null : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 } }, children),
      )
    }

    function normalizeParams(entry) {
      const params = entry?.params
      if (Array.isArray(params)) {
        return params
          .map((item) => (typeof item === 'string' ? { name: item } : { ...(item ?? {}) }))
          .filter((item) => typeof item.name === 'string' && item.name.trim() !== '')
      }
      if (params && typeof params === 'object') {
        return Object.entries(params).map(([name, item]) => ({ name, ...(typeof item === 'string' ? { description: item } : (item ?? {})) }))
      }
      return []
    }

    function toToolDraft(entry, index) {
      const method = String(entry?.method ?? 'GET').toUpperCase()
      const idempotent = method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
      // 缺省值要和宿主一致：非幂等方法默认算写操作，写操作默认要确认。
      const dangerous = entry ? (typeof entry.dangerous === 'boolean' ? entry.dangerous : !idempotent) : false
      const confirm = entry && typeof entry.confirm === 'boolean' ? entry.confirm : dangerous
      return {
        index,
        name: entry?.name ?? '',
        method,
        path: entry?.path ?? entry?.url ?? '',
        description: entry?.description ?? '',
        baseUrl: entry?.baseUrl ?? '',
        enabled: entry?.enabled !== false,
        dangerous,
        confirm,
        params: normalizeParams(entry),
      }
    }

    const emptyTool = () => ({ index: 'new', name: '', method: 'GET', path: '', description: '', baseUrl: '', enabled: true, dangerous: false, confirm: false, params: [] })
    const emptyGateway = () => ({ server: '', baseUrl: '', authType: 'none', header: '', queryName: '', env: '' })

    /** 把草稿工具写成 spec 里的一条（只写用户可编辑的字段，其余原样保留）。 */
    function mergeTool(original, draft) {
      const tool = { ...(original ?? {}) }
      tool.name = draft.name.trim()
      tool.method = draft.method
      tool.path = draft.path.trim()
      if (draft.description.trim() !== '') tool.description = draft.description.trim()
      else delete tool.description
      if (draft.baseUrl.trim() !== '') tool.baseUrl = draft.baseUrl.trim()
      else delete tool.baseUrl
      if (draft.enabled) delete tool.enabled
      else tool.enabled = false
      // dangerous / confirm 都只在「和缺省推导不一致」时才写盘，配置保持干净。
      const inferredDangerous = !['GET', 'HEAD', 'OPTIONS'].includes(draft.method)
      if (draft.dangerous && !inferredDangerous) tool.dangerous = true
      else if (!draft.dangerous && inferredDangerous) tool.dangerous = false
      else delete tool.dangerous
      const effectiveDangerous = draft.dangerous || inferredDangerous
      if (draft.confirm && !effectiveDangerous) tool.confirm = true
      else if (!draft.confirm && effectiveDangerous) tool.confirm = false
      else delete tool.confirm
      const params = draft.params
        .map((item) => {
          const param = { name: String(item.name ?? '').trim() }
          if (param.name === '') return undefined
          if (item.in && item.in !== 'query') param.in = item.in
          if (item.type && item.type !== 'string') param.type = item.type
          if (item.required) param.required = true
          if (typeof item.description === 'string' && item.description.trim() !== '') param.description = item.description.trim()
          if (item.example !== undefined && String(item.example).trim() !== '') param.example = String(item.example).trim()
          else delete param.example
          return param
        })
        .filter(Boolean)
      if (params.length > 0) tool.params = params
      else delete tool.params
      return tool
    }

    function ParamEditor(props) {
      const { params, onChange } = props
      const update = (index, patch) => {
        const next = params.map((item, i) => (i === index ? { ...item, ...patch } : item))
        onChange(next)
      }
      return h('div', { style: S.paramsBox },
        params.length === 0 ? h('div', { style: S.hint }, '没有参数（路径里的 {id} 这类占位符会自动变成必填参数）') : null,
        params.length === 0 ? null : h('div', { style: { ...S.paramRow, fontSize: 11, color: FAINT } },
          h('span', null, '参数名'), h('span', null, '位置'), h('span', null, '类型'), h('span', null, '必填'), h('span', null, '说明'), h('span', null, '示例值'), h('span', null, ''),
        ),
        params.map((item, index) => h('div', { key: index, style: S.paramRow },
          h(TextInput, { value: item.name ?? '', placeholder: '参数名', onChange: (e) => update(index, { name: e.target.value }) }),
          h(Select, { value: item.in ?? 'query', options: PARAM_IN, onChange: (e) => update(index, { in: e.target.value }) }),
          h(Select, { value: item.type ?? 'string', options: PARAM_TYPES, onChange: (e) => update(index, { type: e.target.value }) }),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: MUTED } },
            h('input', { type: 'checkbox', checked: item.required === true, onChange: (e) => update(index, { required: e.target.checked }) }), '必填'),
          h(TextInput, { value: item.description ?? '', placeholder: '说明', onChange: (e) => update(index, { description: e.target.value }) }),
          h(TextInput, { value: item.example === undefined ? '' : String(item.example), placeholder: '示例值', onChange: (e) => update(index, { example: e.target.value }) }),
          h(Button, { variant: 'tiny', title: '删除该参数', onClick: () => onChange(params.filter((_, i) => i !== index)) }, '×'),
        )),
        h('div', null, h(Button, { variant: 'tiny', onClick: () => onChange([...params, { name: '', in: 'query', type: 'string', required: false, description: '' }]) }, '+ 参数')),
      )
    }

    function ToolForm(props) {
      const { draft, onDraftChange, onSave, onCancel, saving, file } = props
      const patch = (next) => onDraftChange({ ...draft, ...next })
      const [testing, setTesting] = React.useState(false)
      const [testResult, setTestResult] = React.useState(undefined)
      const [testError, setTestError] = React.useState(undefined)

      /** 用参数行里的「示例值」拼测试入参；没填示例的参数不带上。 */
      const buildArgs = (params) => {
        const args = {}
        for (const item of params) {
          const name = String(item?.name ?? '').trim()
          if (name === '') continue
          const raw = item?.example
          if (raw === undefined || raw === null || String(raw).trim() === '') continue
          const text = String(raw).trim()
          const type = item?.type ?? 'string'
          if (type === 'number' || type === 'integer') args[name] = Number(text)
          else if (type === 'boolean') args[name] = text === 'true' || text === '1'
          else if (type === 'array' || type === 'object' || type === 'json') {
            try {
              args[name] = JSON.parse(text)
            } catch {
              args[name] = text
            }
          } else args[name] = text
        }
        return args
      }

      const runTest = async () => {
        setTesting(true)
        setTestError(undefined)
        setTestResult(undefined)
        try {
          const tool = mergeTool(undefined, draft)
          const args = buildArgs(draft.params)
          const payload = await request('POST', '/test', { file, tool, args })
          setTestResult(payload)
        } catch (err) {
          setTestError(err?.message ?? String(err))
        } finally {
          setTesting(false)
        }
      }

      return h('div', { style: S.card },
        h('div', { style: S.row }, h('div', { style: S.title }, draft.index === 'new' ? '新增接口' : `编辑接口 #${Number(draft.index) + 1}`)),
        h(Field, { label: '工具名' }, h(TextInput, { value: draft.name, placeholder: '如 user_detail（只用字母数字下划线）', onChange: (e) => patch({ name: e.target.value }) })),
        h(Field, { label: '说明' }, h(TextInput, { value: draft.description, placeholder: '告诉模型这个接口做什么', onChange: (e) => patch({ description: e.target.value }) })),
        // 方法、路径各占一行：并排会把下拉框和路径输入框挤到一起。
        h(Field, { label: '请求方法' }, h(Select, { value: draft.method, options: METHODS, onChange: (e) => patch({ method: e.target.value }) })),
        h(Field, { label: '请求路径' }, h(TextInput, { value: draft.path, placeholder: '/v1/users/{id}', onChange: (e) => patch({ path: e.target.value }) })),
        h(Field, { label: '独立 baseUrl' }, h(TextInput, { value: draft.baseUrl, placeholder: '留空则用上面的默认 baseUrl', onChange: (e) => patch({ baseUrl: e.target.value }) })),
        h('div', { style: S.row },
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: MUTED } },
            h('input', { type: 'checkbox', checked: draft.enabled, onChange: (e) => patch({ enabled: e.target.checked }) }), '启用'),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: MUTED } },
            h('input', {
              type: 'checkbox',
              checked: draft.dangerous,
              onChange: (e) => patch({ dangerous: e.target.checked, confirm: e.target.checked ? true : draft.confirm }),
            }), '写操作（会修改远端数据）'),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: MUTED } },
            h('input', { type: 'checkbox', checked: Boolean(draft.confirm), onChange: (e) => patch({ confirm: e.target.checked }) }), '调用前要人工确认'),
        ),
        h('div', { style: S.hint }, '勾了「调用前要人工确认」，模型每次调用这个接口都会先弹审批；没批准就不发请求。'),
        h('div', { style: S.divider }),
        h('div', { style: S.label }, '参数'),
        h(ParamEditor, { params: draft.params, onChange: (params) => patch({ params }) }),
        h('div', { style: S.row },
          h(Button, { variant: 'primary', disabled: saving, onClick: onSave }, saving ? '保存中…' : '保存接口'),
          h(Button, { disabled: testing || saving, onClick: () => { void runTest() } }, testing ? '测试中…' : '在线测试'),
          h(Button, { disabled: saving, onClick: onCancel }, '取消'),
        ),
        testError ? h('div', { style: S.err }, `测试失败：${testError}`) : null,
        testResult ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('div', { style: S.label }, '测试结果（用参数行的「示例值」当入参）'),
          h('div', { style: S.mono }, `已发送参数：${JSON.stringify(testResult.args ?? {})}`),
          testResult.result?.ok
            ? h('div', { style: S.ok }, `${testResult.result.status} · ${testResult.result.durationMs} ms · ${testResult.result.method} ${testResult.result.url}`)
            : h('div', null,
              testResult.result?.status
                ? h('div', { style: S.err }, `${testResult.result.status} · ${testResult.result.durationMs} ms · ${testResult.result.method} ${testResult.result.url}`)
                : h('div', { style: S.err }, `出错：${testResult.result?.error ?? '未知错误'}`),
              testResult.result?.error ? h('div', { style: S.hint }, testResult.result.message ?? '') : null,
            ),
          h('pre', { style: { ...S.mono, margin: 0, maxHeight: 260, overflow: 'auto', padding: 8, border: LINE, borderRadius: 8 } },
            JSON.stringify(testResult.result?.data ?? testResult.result?.text ?? testResult.result, null, 2)),
        ) : null,
      )
    }

    /** 网关列表页：列出目录里的所有网关，可新建 / 删除 / 打开编辑。 */
    function GatewayList(props) {
      // initialData / initialCreating 只供测试预置首屏状态；浏览器里由 load() 拉取。
      const seed = props ?? {}
      const [data, setData] = React.useState(seed.initialData)
      const [error, setError] = React.useState(undefined)
      const [notice, setNotice] = React.useState(undefined)
      const [loading, setLoading] = React.useState(seed.initialData === undefined)
      const [creating, setCreating] = React.useState(seed.initialCreating)
      const [pendingDelete, setPendingDelete] = React.useState(undefined)
      const [saving, setSaving] = React.useState(false)

      const load = React.useCallback(async () => {
        setLoading(true)
        try {
          const next = await request('GET', '/gateways')
          setData(next)
          setError(undefined)
        } catch (err) {
          setError(err?.message ?? String(err))
        } finally {
          setLoading(false)
        }
      }, [])

      React.useEffect(() => {
        void load()
      }, [load])

      const patchCreate = (next) => setCreating({ ...(creating ?? emptyGateway()), ...next })

      const create = async () => {
        const draft = creating ?? emptyGateway()
        setSaving(true)
        setNotice(undefined)
        try {
          const auth = draft.authType === 'none' ? undefined : {
            type: draft.authType,
            ...(draft.authType === 'header' ? { header: draft.header.trim() || 'X-API-Key' } : {}),
            ...(draft.authType === 'query' ? { queryName: draft.queryName.trim() || 'api_key' } : {}),
            ...(draft.env.trim() !== '' ? { env: draft.env.trim() } : {}),
          }
          const payload = await request('POST', '/gateways', { server: draft.server.trim(), baseUrl: draft.baseUrl.trim(), auth })
          setCreating(undefined)
          setNotice(`已创建网关 ${draft.server.trim()}`)
          await load()
          if (typeof props.onOpen === 'function') props.onOpen(payload.file)
        } catch (err) {
          setError(err?.message ?? String(err))
        } finally {
          setSaving(false)
        }
      }

      const remove = async (file) => {
        setSaving(true)
        setNotice(undefined)
        try {
          await request('DELETE', `/gateway?file=${encodeURIComponent(file)}`)
          setPendingDelete(undefined)
          setNotice('已删除网关')
          await load()
        } catch (err) {
          setError(err?.message ?? String(err))
        } finally {
          setSaving(false)
        }
      }

      if (loading && data === undefined) return h('div', { style: S.root }, h('div', { style: S.hint }, '加载中…'))

      const gateways = Array.isArray(data?.gateways) ? data.gateways : []
      const toolCount = (data?.tools ?? []).length

      return h('div', { style: S.root },
        h('div', { style: S.head },
          h('div', null,
            h('div', { style: S.title }, 'API 网关'),
            h('div', { style: S.hint }, data?.dir ?? ''),
          ),
          h('div', { style: S.row },
            h('span', { style: data?.ok ? S.ok : S.err }, `共 ${gateways.length} 个网关 · ${toolCount} 个工具`),
            h(Button, { disabled: loading || saving, onClick: () => { void load() } }, '重新读取'),
            h(Button, { variant: 'primary', disabled: saving, onClick: () => setCreating(creating ? undefined : emptyGateway()) }, creating ? '取消新增' : '+ 新增网关'),
          ),
        ),

        data?.error ? h('div', { style: S.err }, data.error) : null,
        error ? h('div', { style: S.err }, error) : null,
        notice ? h('div', { style: S.notice }, notice) : null,
        data?.problems?.length ? h('div', { style: S.card },
          h('div', { style: S.label }, '加载告警'),
          data.problems.map((item, i) => h('div', { key: i, style: S.err }, `· ${item}`)),
        ) : null,

        creating ? h('div', { style: S.createBox },
          h('div', { style: S.title }, '新增网关'),
          h(Field, { label: '服务名' }, h(TextInput, { value: creating.server, placeholder: '如 erp（工具名前缀，只会用字母数字下划线）', onChange: (e) => patchCreate({ server: e.target.value }) })),
          h(Field, { label: 'baseUrl' }, h(TextInput, { value: creating.baseUrl, placeholder: 'https://erp.example.com', onChange: (e) => patchCreate({ baseUrl: e.target.value }) })),
          h(Field, { label: '鉴权方式' }, h(Select, { value: creating.authType, options: AUTH_TYPES, onChange: (e) => patchCreate({ authType: e.target.value }) })),
          creating.authType === 'none' ? null : h(Field, { label: '密钥环境变量' }, h(TextInput, { value: creating.env, placeholder: '如 ERP_API_KEY（在启动 web 的终端里设置）', onChange: (e) => patchCreate({ env: e.target.value }) })),
          creating.authType === 'header' ? h(Field, { label: '鉴权头名' }, h(TextInput, { value: creating.header, placeholder: 'X-API-Key', onChange: (e) => patchCreate({ header: e.target.value }) })) : null,
          creating.authType === 'query' ? h(Field, { label: '鉴权参数名' }, h(TextInput, { value: creating.queryName, placeholder: 'api_key', onChange: (e) => patchCreate({ queryName: e.target.value }) })) : null,
          h('div', { style: S.row },
            h(Button, { variant: 'primary', disabled: saving, onClick: () => { void create() } }, saving ? '创建中…' : '创建网关'),
            h(Button, { disabled: saving, onClick: () => setCreating(undefined) }, '取消'),
            h('span', { style: S.hint }, '创建后会生成一个空的网关文件，再进去加接口'),
          ),
        ) : null,

        h('div', { style: S.card },
          h('div', { style: S.label }, '网关列表'),
          gateways.length === 0 ? h('div', { style: S.hint }, '还没有网关，点右上角「+ 新增网关」开始。') : null,
          gateways.length === 0 ? null : h('div', { style: S.gwHead },
            h('span', null, '服务名'), h('span', null, 'baseUrl'), h('span', null, '工具数'), h('span', null, '状态'), h('span', null, '操作'),
          ),
          gateways.map((gateway) => {
            const statusStyle = gateway.error ? S.badgeErr : gateway.empty ? S.badge : S.badgeOk
            const statusText = gateway.error ? '错误' : gateway.empty ? '空' : '正常'
            return h('div', { key: gateway.file, style: S.gwRow },
              h('div', null,
                h('div', { style: S.gatewayName }, gateway.server ?? '(未命名)'),
                h('div', { style: S.hint }, gateway.name ?? ''),
              ),
              h('div', { style: S.mono }, gateway.baseUrl ?? ''),
              h('div', { style: S.mono }, String((gateway.tools ?? []).length)),
              h('div', null, h('span', { style: statusStyle }, statusText)),
              h('div', { style: S.ops },
                pendingDelete === gateway.file
                  ? h('span', { style: S.ops },
                    h(Button, { variant: 'danger', disabled: saving, onClick: () => { void remove(gateway.file) } }, '确认删除'),
                    h(Button, { variant: 'tiny', onClick: () => setPendingDelete(undefined) }, '取消'),
                  )
                  : h('span', { style: S.ops },
                    h(Button, { variant: 'tiny', disabled: !props.onOpen, onClick: () => props.onOpen && props.onOpen(gateway.file) }, '编辑'),
                    h(Button, { variant: 'danger', onClick: () => setPendingDelete(gateway.file) }, '删除'),
                  ),
              ),
            )
          }),
          bridgeHint(gateways),
        ),
      )
    }

    const bridgeHint = (gateways) => (gateways.length === 0 ? null : h('div', { style: S.hint }, '工具名 = 网关的「服务名」+ _ + 接口名；不同网关的接口名可以重名，但服务名不能重复。'))

    /** 单个网关的编辑页：基础配置 + 接口列表 + 新增/编辑接口表单。 */
    function GatewayEditor(props) {
      const { file } = props
      const seed = props ?? {}
      const [data, setData] = React.useState(seed.initialData)
      const [draft, setDraft] = React.useState(seed.initialDraft)
      const [error, setError] = React.useState(undefined)
      const [notice, setNotice] = React.useState(undefined)
      const [loading, setLoading] = React.useState(seed.initialData === undefined)
      const [saving, setSaving] = React.useState(false)
      const [editing, setEditing] = React.useState(seed.initialEditing)
      const [collapsed, setCollapsed] = React.useState({ base: false, list: false })
      const toggleCard = (key) => setCollapsed((current) => ({ ...current, [key]: !current[key] }))

      const load = React.useCallback(async () => {
        setLoading(true)
        try {
          const next = await request('GET', `/gateway?file=${encodeURIComponent(file)}`)
          setData(next)
          setDraft(clone(next.spec))
          setError(undefined)
        } catch (err) {
          setError(err?.message ?? String(err))
        } finally {
          setLoading(false)
        }
      }, [file])

      React.useEffect(() => {
        void load()
      }, [load])

      const dirty = Boolean(data && draft) && JSON.stringify(data.spec) !== JSON.stringify(draft)

      const save = async (spec) => {
        setSaving(true)
        setNotice(undefined)
        try {
          await request('PUT', '/gateway', { file, spec })
          await load()
          setNotice('已保存并重新加载')
          setError(undefined)
          return true
        } catch (err) {
          setError(err?.message ?? String(err))
          return false
        } finally {
          setSaving(false)
        }
      }

      const patchDraft = (next) => {
        setDraft((current) => ({ ...(current ?? {}), ...next }))
        setNotice(undefined)
      }

      const tools = Array.isArray(draft?.tools) ? draft.tools : []
      const entries = Array.isArray(data?.entries) ? data.entries : []

      const auth = draft?.auth ?? { type: 'none' }
      const authPatch = (next) => {
        const merged = { ...auth, ...next }
        if (merged.type === 'none') patchDraft({ auth: undefined })
        else patchDraft({ auth: merged })
      }

      const startEdit = (index) => {
        if (index === 'new') setEditing(emptyTool())
        else setEditing(toToolDraft(tools[index], index))
      }

      const commitTool = async () => {
        if (!editing) return
        if (editing.name.trim() === '') {
          setError('工具名不能为空')
          return
        }
        const nextTools = [...tools]
        if (editing.index === 'new') nextTools.push(mergeTool(undefined, editing))
        else nextTools[Number(editing.index)] = mergeTool(tools[Number(editing.index)], editing)
        const nextSpec = { ...(draft ?? {}), tools: nextTools }
        setDraft(nextSpec)
        const ok = await save(nextSpec)
        if (ok) setEditing(undefined)
      }

      const removeTool = async (index) => {
        const nextSpec = { ...(draft ?? {}), tools: tools.filter((_, i) => i !== index) }
        setDraft(nextSpec)
        await save(nextSpec)
      }

      const toggleEnabled = async (index) => {
        const nextTools = tools.map((item, i) => {
          if (i !== index) return item
          const next = { ...(item ?? {}) }
          if (next.enabled === false) delete next.enabled
          else next.enabled = false
          return next
        })
        const nextSpec = { ...(draft ?? {}), tools: nextTools }
        setDraft(nextSpec)
        await save(nextSpec)
      }

      if (loading && data === undefined) return h('div', { style: S.root }, h('div', { style: S.hint }, '加载中…'))

      return h('div', { style: S.root },
        h('div', { style: S.head },
          h('div', null,
            h('div', { style: S.title }, `网关：${data?.server ?? '未命名'}`),
            h('div', { style: S.hint }, data?.file ?? ''),
          ),
          h('div', { style: S.row },
            h('span', { style: data?.ok ? S.ok : S.err }, `已注册 ${(data?.registered ?? []).length} 个工具`),
            h(Button, { disabled: loading || saving, onClick: () => { void load() } }, '重新读取'),
            h(Button, { disabled: saving, onClick: () => props.onBack && props.onBack() }, '← 返回列表'),
          ),
        ),

        data?.error ? h('div', { style: S.err }, data.error) : null,
        error ? h('div', { style: S.err }, error) : null,
        notice ? h('div', { style: S.notice }, notice) : null,
        data?.problems?.length ? h('div', { style: S.card },
          h('div', { style: S.label }, '加载告警'),
          data.problems.map((item, i) => h('div', { key: i, style: S.err }, `· ${item}`)),
        ) : null,

        h(SectionCard, {
          title: '基础配置',
          collapsed: collapsed.base,
          onToggle: () => toggleCard('base'),
          hint: collapsed.base ? `${draft?.server ?? ''} · ${draft?.baseUrl ?? ''}` : undefined,
        },
          h(Field, { label: '服务名' }, h(TextInput, { value: draft?.server ?? '', placeholder: 'api（工具名前缀）', onChange: (e) => patchDraft({ server: e.target.value }) })),
          h(Field, { label: 'baseUrl' }, h(TextInput, { value: draft?.baseUrl ?? '', placeholder: 'https://api.example.com', onChange: (e) => patchDraft({ baseUrl: e.target.value }) })),
          h(Field, { label: '鉴权方式' }, h(Select, { value: auth.type ?? 'none', options: AUTH_TYPES, onChange: (e) => authPatch({ type: e.target.value }) })),
          auth.type === 'none' ? null : h(Field, { label: '密钥环境变量' }, h(TextInput, { value: auth.env ?? '', placeholder: '如 MY_API_TOKEN（在启动 web 的终端里设置）', onChange: (e) => authPatch({ env: e.target.value }) })),
          auth.type === 'header' ? h(Field, { label: '鉴权头名' }, h(TextInput, { value: auth.header ?? '', placeholder: 'X-API-Key', onChange: (e) => authPatch({ header: e.target.value }) })) : null,
          auth.type === 'query' ? h(Field, { label: '鉴权参数名' }, h(TextInput, { value: auth.queryName ?? '', placeholder: 'api_key', onChange: (e) => authPatch({ queryName: e.target.value }) })) : null,
          h(Field, { label: '超时（毫秒）' }, h(TextInput, { value: String(draft?.defaults?.timeoutMs ?? 30000), onChange: (e) => {
            const value = Number(e.target.value)
            patchDraft({ defaults: { ...(draft?.defaults ?? {}), timeoutMs: Number.isFinite(value) ? value : 30000 } })
          } })),
          h(Field, { label: '响应截断字符数' }, h(TextInput, { value: String(draft?.defaults?.maxResponseChars ?? 8000), onChange: (e) => {
            const value = Number(e.target.value)
            patchDraft({ defaults: { ...(draft?.defaults ?? {}), maxResponseChars: Number.isFinite(value) ? value : 8000 } })
          } })),
        ),

        h(SectionCard, {
          title: '接口列表',
          collapsed: collapsed.list,
          onToggle: () => toggleCard('list'),
          hint: collapsed.list ? `共 ${tools.length} 个接口` : undefined,
          actions: h(Button, { variant: 'primary', disabled: saving, onClick: () => startEdit('new') }, '+ 新增接口'),
        },
          tools.length === 0
            ? h('div', { style: S.hint }, '这个网关还没有接口，点「新增接口」开始。')
            : h('div', null,
              h('div', { style: S.listHead }, h('span', null, '工具名'), h('span', null, '方法'), h('span', null, '路径'), h('span', null, '参数'), h('span', null, '操作')),
              tools.map((item, index) => {
                const info = entries.find((entry) => entry.index === index)
                const disabled = item?.enabled === false
                return h('div', { key: index, style: { ...S.listRow, opacity: disabled ? 0.55 : 1 } },
                  h('div', { style: S.mono },
                    h('div', null, item?.name ?? '(未命名)'),
                    info?.error ? h('div', { style: S.err }, info.error) : null,
                  ),
                  h('div', { style: S.mono }, String(item?.method ?? 'GET').toUpperCase()),
                  h('div', { style: S.mono }, item?.path ?? item?.url ?? ''),
                  h('div', { style: S.mono }, String(info?.params ?? normalizeParams(item).length)),
                  h('div', { style: S.ops },
                    h(Button, { variant: 'tiny', onClick: () => startEdit(index) }, '编辑'),
                    h(Button, { variant: 'tiny', onClick: () => { void toggleEnabled(index) } }, disabled ? '启用' : '停用'),
                    h(Button, { variant: 'danger', onClick: () => { void removeTool(index) } }, '删除'),
                  ),
                )
              }),
            ),
          dirty ? h('div', { style: S.row },
            h(Button, { variant: 'primary', disabled: saving, onClick: () => { void save(draft) } }, saving ? '保存中…' : '保存配置'),
            h(Button, { disabled: saving, onClick: () => { setDraft(clone(data.spec)); setNotice(undefined) } }, '放弃修改'),
            h('span', { style: S.hint }, '有未保存的修改'),
          ) : null,
        ),

        editing ? h(ToolForm, {
          file,
          draft: editing,
          saving,
          onDraftChange: setEditing,
          onSave: () => { void commitTool() },
          onCancel: () => setEditing(undefined),
        }) : null,
      )
    }

    /** 分区入口：列表页 ↔ 编辑页。 */
    function ApiGatewaySection(props) {
      const seed = props ?? {}
      const [view, setView] = React.useState(seed.initialView ?? 'list')
      const [file, setFile] = React.useState(seed.initialFile)
      if (view === 'edit' && file) {
        return h(GatewayEditor, {
          key: file,
          file,
          initialData: seed.initialData,
          initialDraft: seed.initialDraft,
          initialEditing: seed.initialEditing,
          onBack: () => setView('list'),
        })
      }
      return h(GatewayList, {
        initialData: seed.initialGateways,
        initialCreating: seed.initialCreating,
        onOpen: (next) => {
          setFile(next)
          setView('edit')
        },
      })
    }

    module.exports = {
      name: 'api-tools-ui',
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'api-tools',
          order: 30,
          label: () => '接口网关',
        }, ApiGatewaySection))
      },
    }
    return module.exports
  },
})
