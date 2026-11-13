// 虎鲸桌宠 - dsh harness gateway 客户端
// 适配新版 dsh（桌面版）协议：
//   * 鉴权：读取 ~/.dsh/.credentials.yaml 里的 browser-session 密钥，自行签发 dsh-auth-<hash> Cookie
//   * RPC ：POST /api/<domain>/<method>，payload 形如 { args: { _request: {...} } }
//   * 事件：WebSocket /api/remote.mux，发送 { type:'open', streamId, endpoint:'$events' }
//
// 同时兼容旧版（3080 端口、/api/session.list、无鉴权、/api/events.mux）：
// 若 reads 到旧版行为则自动降级。
//
// 地址来源：桌面版的监听端口**每次启动都是随机的**，所以不写死端口，按
//   WHALE_PET_URL → 插件写的发现文件 → 探测常见端口
// 的顺序解析（见 resolveGatewayUrl）。
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const WebSocket = require('ws')

/** 新版网关要求 prompt 带 requestId（UUID）。 */
const randomUUID = () => crypto.randomUUID()

/**
 * DSH 插件（Host 半边）写下的地址发现文件，按优先级排列。
 *
 * 首选 `$DSH_HOME/cache/`：Host 与桌宠都从 DSH_HOME（或 ~/.dsh）推导路径，
 * 基准天然一致，不受 TMP/TEMP 被宿主或终端改掉的影响。
 * `%TEMP%` 那份是旧版本写的，保留读取以兼容。
 * @returns {string[]} 去重后的候选绝对路径
 */
function discoveryFiles() {
  const files = []
  try {
    files.push(path.join(dshHome(), 'cache', 'whale-pet-dsh-url.json'))
  } catch {
    // dshHome() 只是字符串拼接，理论上不会抛；真抛了就用下面的 TEMP 兜底
  }
  files.push(path.join(os.tmpdir(), 'whale-pet-dsh-url.json'))
  return [...new Set(files)]
}

/** 探测候选端口：新版/旧版 dsh 的默认值，最后兜底用。 */
const CANDIDATE_PORTS = [19387, 3080]

// ---------- 基础工具 ----------
function b64u(buf) {
  return Buffer.from(buf).toString('base64')
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function decodeB64u(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) return undefined
  const pad = '='.repeat((4 - value.length % 4) % 4)
  const decoded = Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/') + pad, 'base64')
  return b64u(decoded) === value ? decoded : undefined
}

// ---------- 读取 browser-session 签名密钥 ----------
// dsh 把密钥持久化在 $DSH_HOME/.credentials.yaml 的
//   records: -> 'client-connection/browser-session' -> payload.secret
// 目录名里带斜杠，YAML 里会带引号。这里做最小化的逐行解析，避免引入 yaml 依赖。
function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

function readAuthSecret() {
  const file = path.join(dshHome(), '.credentials.yaml')
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  // 定位 client-connection/browser-session 段落，往后找第一个 secret:
  const lines = text.split(/\r?\n/)
  let inRecord = false
  for (const raw of lines) {
    const line = raw.trim()
    if (!inRecord) {
      if (/client-connection\/browser-session/.test(line)) inRecord = true
      continue
    }
    const m = /^secret:\s*(.+?)\s*$/.exec(line)
    if (m) {
      const secret = decodeB64u(m[1].replace(/^["']|["']$/g, ''))
      if (secret && secret.byteLength === 32) return secret
      return undefined
    }
    // 遇到下一个同级记录就停止（避免误读别的 secret）
    if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+:\s*$/.test(line) || /^records:\s*$/.test(line)) break
  }
  return undefined
}

// ---------- 读取 DeepSeek API Key ----------
// 同一个 .credentials.yaml 的 refs 段落里存着 DEEPSEEK_API_KEY，用于查询账户余额。
function readDeepSeekKey() {
  const file = path.join(dshHome(), '.credentials.yaml')
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  const m = /^\s*DEEPSEEK_API_KEY:\s*(.+?)\s*$/m.exec(text)
  if (!m) return undefined
  return m[1].replace(/^["']|["']$/g, '')
}

/**
 * 查询 DeepSeek 账户余额。
 * 官方接口：GET https://api.deepseek.com/user/balance
 * @param {string} [apiKey] - 省略时自动从 .credentials.yaml 读取
 * @returns {Promise<{ available: boolean, currency: string, total: number, granted: number, toppedUp: number, raw: object }>}
 */
async function fetchBalance(apiKey) {
  const key = apiKey || readDeepSeekKey()
  if (!key) throw new Error('未找到 DEEPSEEK_API_KEY（请检查 ~/.dsh/.credentials.yaml）')
  const res = await fetch('https://api.deepseek.com/user/balance', {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  })
  if (res.status === 401) throw new Error('API Key 无效或已失效')
  if (!res.ok) throw new Error(`余额接口 HTTP ${res.status}`)
  const body = await res.json()
  const info = (body.balance_infos && body.balance_infos[0]) || {}
  return {
    available: body.is_available === true,
    currency: info.currency || 'CNY',
    total: Number(info.total_balance ?? 0),
    granted: Number(info.granted_balance ?? 0),
    toppedUp: Number(info.topped_up_balance ?? 0),
    raw: body,
  }
}

// ---------- 签发 dsh 浏览器会话 Cookie ----------
// 与 dsh 的 browser-auth.ts 完全一致：
//   name  = 'dsh-auth-' + base64url(sha256(authority))
//   value = 'v1.' + base64url(json) + '.' + base64url(hmacSha256(secret, base64url(json)))
function signCookie(secret, authority, days = 30) {
  const name = 'dsh-auth-' + b64u(crypto.createHash('sha256').update(authority).digest())
  const now = Date.now()
  const body = b64u(Buffer.from(JSON.stringify({
    version: 1,
    authority,
    issuedAt: now,
    expiresAt: now + days * 24 * 60 * 60 * 1000,
  }), 'utf8'))
  const sig = b64u(crypto.createHmac('sha256', secret).update(body).digest())
  return `${name}=v1.${body}.${sig}`
}

// ---------- DSH 地址发现 ----------
// 桌面版 DSH 每次启动都由 OS 分配随机端口，写死 19387 是错的。Host 半边
// （DSH 插件）知道真实地址，会通过环境变量 WHALE_PET_URL 传给被它拉起的桌宠；
// 手动 `npm start` 时没有这个环境变量，就读 Host 写的发现文件。

/** 读发现文件里的地址；没有/坏了返回 undefined。 */
function readDiscoveryUrl() {
  for (const file of discoveryFiles()) {
    try {
      const raw = fs.readFileSync(file, 'utf8')
      const json = JSON.parse(raw)
      if (json && typeof json.url === 'string' && /^https?:\/\//i.test(json.url)) {
        return json.url.replace(/\/+$/u, '')
      }
    } catch {
      // 没有发现文件（插件还没跑过）或内容损坏：不致命，继续试下一个位置
    }
  }
  return undefined
}

/**
 * 探测某个地址后面是不是 DSH。
 *
 * 判据是「带上签好的 browser-session cookie 能拿到 DSH 的首页」：0.2.x 的信任围栏
 * 对没有/错误 cookie 的请求回 401/403，带对了才 200 且 HTML 里有 __DSH_BOOT__。
 * 所以**不能**把 401/403 当成「是 DSH」——那会把任何本地要鉴权的服务误认成 DSH。
 * 拿不到密钥时（首次安装、凭据还没生成）退化为「HTTP 端口有响应」，
 * 仅用于判断发现文件里的地址是否还活着。
 * @param {string} baseUrl
 * @param {Buffer|undefined} secret - browser-session 签名密钥
 * @returns {Promise<boolean>}
 */
async function probeDsh(baseUrl, secret) {
  const headers = {}
  if (secret) headers.cookie = signCookie(secret, new URL(baseUrl).host)
  try {
    const res = await fetch(baseUrl + '/', {
      headers,
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) return secret === undefined && (res.status === 401 || res.status === 403)
    const text = await res.text()
    return /__DSH_BOOT__|DeepSeek Harness/.test(text)
  } catch {
    return false
  }
}

/**
 * 解析要连的 DSH 地址。
 *
 * 顺序：WHALE_PET_URL（用户显式指定）→ 插件写的发现文件（先探活再用）
 * → 常见端口探测 → undefined（调用方提示用户怎么配）。
 * @param {(url: string) => void} [onTried] - 每次尝试前回报候选地址，便于报错时点名
 * @returns {Promise<string|undefined>}
 */
async function resolveGatewayUrl(onTried) {
  const explicit = (process.env.WHALE_PET_URL || '').trim()
  if (explicit) return explicit.replace(/\/+$/u, '')
  const secret = readAuthSecret()
  const tried = []
  const attempt = async (url) => {
    tried.push(url)
    if (onTried) onTried(url)
    return await probeDsh(url, secret)
  }
  const discovered = readDiscoveryUrl()
  if (discovered && await attempt(discovered)) return discovered
  for (const port of CANDIDATE_PORTS) {
    const url = `http://127.0.0.1:${port}`
    if (await attempt(url)) return url
  }
  return undefined
}

// ---------- Gateway 客户端 ----------
class Gateway {
  /**
   * @param {string|(() => string|Promise<string|undefined>)} source
   *   DSH 地址，或「每次连接前重新解析一次」的解析器。
   *   传解析器时，DSH 重启换了端口也能自动跟上。
   * @param {{ onEvent?: Function, onStatus?: Function, onLog?: Function }} hooks
   */
  constructor(source, hooks = {}) {
    this.source = source
    this.hooks = hooks
    this.baseUrl = typeof source === 'string' ? source.replace(/\/+$/u, '') : undefined
    this.authority = this.baseUrl ? new URL(this.baseUrl).host : undefined
    this.secret = undefined
    this.cookie = undefined
    this.connected = false
    this.mux = null
    this.reconnectTimer = null
    this.connecting = false
    this.stopped = false
    this.streamSeq = 0
    /** 上一次解析失败的原因，用来避免日志刷屏。 */
    this.lastResolveError = undefined
    /** 最近一次解析尝试过的候选地址。 */
    this.triedUrls = []
    if (this.baseUrl) this.signIn()
  }

  /** 按当前 baseUrl 重新读取签名密钥并签发 cookie（地址变了就必须重签）。 */
  signIn() {
    if (!this.baseUrl) return
    this.authority = new URL(this.baseUrl).host
    this.secret = readAuthSecret()
    this.cookie = this.secret ? signCookie(this.secret, this.authority) : undefined
  }

  log(message, extra) {
    if (this.hooks.onLog) this.hooks.onLog(message, extra)
    console.log('[gateway]', message, extra === undefined ? '' : extra)
  }

  setStatus(connected, info) {
    const reason = info && info.reason ? info.reason : undefined
    if (this.connected === connected && this.lastStatusReason === reason) return
    this.connected = connected
    this.lastStatusReason = reason
    if (this.hooks.onStatus) this.hooks.onStatus(connected, this.baseUrl, info)
  }

  headers() {
    const h = { 'Content-Type': 'application/json' }
    if (this.cookie) h['Cookie'] = this.cookie
    return h
  }

  /**
   * 调用一个 RPC。
   *
   * 新版 dsh（typert 网关）的形态是：
   *   POST /api/<domain>/<method>
   *   body = { type, rpcId, method:'<domain>/<method>', payload: { args: { <field>: {...} } } }
   *
   * 注意第 4 层那个字段名**随方法而异**，由该方法的 descriptor 决定：
   *   session/list   → `_request`
   *   session/prompt → `request`
   * 所以这里逐个候选字段名试，哪个不报 "arguments-invalid" 就用哪个。
   *
   * 旧版（3080 端口）则是 POST /api/<domain>.<method>，payload 直接是业务参数，作为最后兜底。
   */
  async call(method, payload = {}) {
    if (!this.baseUrl) throw new Error('还没找到 DSH 地址（桌宠尚未连上 harness）')
    const slash = method.replace('.', '/')
    const wrapped = { ...payload }

    // 新版必填字段：prompt 类方法要求带 requestId（新式 UUID）
    if (slash === 'session/prompt' || slash === 'subagent/prompt') {
      if (!wrapped.requestId) wrapped.requestId = randomUUID()
    }

    // 字段名候选：按经验把最常见的放前面，减少一次往返
    const FIELD_CANDIDATES = ['request', '_request', 'args', 'params', 'input']

    const attempts = []
    for (const field of FIELD_CANDIDATES) {
      attempts.push({ path: `/api/${slash}`, body: this.newEnvelope(slash, { args: { [field]: wrapped } }) })
    }
    // 旧版兜底
    attempts.push({ path: `/api/${method}`, body: this.newEnvelope(method, payload) })

    let lastErr
    for (const attempt of attempts) {
      try {
        const res = await fetch(this.baseUrl + attempt.path, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(attempt.body),
        })
        if (res.status === 401 || res.status === 403) {
          throw new Error(`鉴权失败 HTTP ${res.status}（请确认 dsh 已启动且密钥可读）`)
        }
        if (!res.ok) {
          lastErr = new Error(`${attempt.path} HTTP ${res.status}`)
          continue
        }
        const json = await res.json()
        const result = json && json.result
        if (!result) { lastErr = new Error(`${attempt.path} 响应缺少 result`); continue }
        if (result.ok !== true) {
          const err = result.error || {}
          // 字段名猜错 / 参数不匹配：换下一个候选继续试，不算致命
          if (err.code === 'gateway/arguments-invalid' || err.code === 'gateway/input-invalid'
            || err.code === 'gateway/internal') {
            lastErr = new Error(`${err.code}: ${err.message || ''}`)
            continue
          }
          lastErr = new Error(`${err.code || 'error'}: ${err.message || JSON.stringify(err)}`)
          continue
        }
        return result.value
      } catch (err) {
        lastErr = err
      }
    }
    throw lastErr || new Error(`${method} 调用失败`)
  }

  newEnvelope(method, payload) {
    return {
      type: 'client-request',
      rpcId: `pet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      method,
      payload,
    }
  }

  // ---------- 事件流 ----------

  /**
   * 连接一次（重入安全）：解析地址 → 重签 cookie → 建 WebSocket 并订阅 $events。
   * 每次重连都重新解析地址，所以 DSH 重启换了随机端口后能自己跟回来。
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.stopped || this.connecting) return
    this.connecting = true
    let url
    try {
      url = typeof this.source === 'function' ? await this.source() : this.source
    } catch (err) {
      url = undefined
      this.log('解析 DSH 地址失败', err && err.message)
    } finally {
      this.connecting = false
    }
    if (this.stopped) return
    if (!url) {
      this.setStatus(false, {
        reason: 'no-url',
        tried: this.triedUrls.slice(),
        discovery: discoveryFiles(),
        hint: '请从 DSH 侧边栏「启动」桌宠（插件会把真实地址传进来），'
          + '或手动设 WHALE_PET_URL 指向 DSH 当前地址',
      })
      this.scheduleReconnect()
      return
    }
    const previous = this.baseUrl
    this.baseUrl = url.replace(/\/+$/u, '')
    this.signIn()
    if (previous !== this.baseUrl) this.log('已定位 DSH', this.baseUrl)

    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/api/remote.mux'
    const opts = this.cookie ? { headers: { Cookie: this.cookie } } : {}
    let ws
    try {
      ws = new WebSocket(wsUrl, opts)
    } catch (err) {
      this.log('WebSocket 创建失败', err.message)
      this.scheduleReconnect()
      return
    }
    this.mux = ws

    ws.on('open', () => {
      this.setStatus(true)
      // 打开 $events 逻辑流：这是 harness 的应用事件来源
      const streamId = `pet-events-${++this.streamSeq}`
      ws.send(JSON.stringify({ type: 'open', streamId, endpoint: '$events', payload: { args: {} } }))
      this.log('已连接并订阅 $events')
    })

    ws.on('message', (data) => {
      let frame
      try { frame = JSON.parse(data.toString()) } catch { return }
      this.handleFrame(frame)
    })

    ws.on('error', (err) => {
      this.log('WS 错误', err.message)
    })

    ws.on('close', () => {
      this.setStatus(false)
      this.mux = null
      this.scheduleReconnect()
    })
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, 2000)
  }

  /** 新版 mux 帧：{ type:'item'|'ready'|'end', streamId, value } */
  handleFrame(frame) {
    if (!frame || typeof frame !== 'object') return
    if (frame.type === 'item' && frame.value !== undefined) {
      if (this.hooks.onEvent) this.hooks.onEvent(frame.value)
      return
    }
    if (frame.type === 'stream-error' || frame.error) {
      this.log('流错误', JSON.stringify(frame.error || frame))
    }
  }

  close() {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.mux && (this.mux.readyState === WebSocket.OPEN || this.mux.readyState === WebSocket.CONNECTING)) {
      this.mux.terminate()
    }
  }
}

module.exports = {
  Gateway, resolveGatewayUrl, readDiscoveryUrl, discoveryFiles,
  readAuthSecret, readDeepSeekKey, fetchBalance, signCookie, dshHome,
}