// 虎鲸桌宠 - dsh harness gateway 客户端
// 适配新版 dsh（desktop / 19387 端口）协议：
//   * 鉴权：读取 ~/.dsh/.credentials.yaml 里的 browser-session 密钥，自行签发 dsh-auth-<hash> Cookie
//   * RPC ：POST /api/<domain>/<method>，payload 形如 { args: { _request: {...} } }
//   * 事件：WebSocket /api/remote.mux，发送 { type:'open', streamId, endpoint:'$events' }
//
// 同时兼容旧版（3080 端口、/api/session.list、无鉴权、/api/events.mux）：
// 若 reads 到旧版行为则自动降级。
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const WebSocket = require('ws')

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

// ---------- Gateway 客户端 ----------
class Gateway {
  /**
   * @param {string} baseUrl - 形如 http://127.0.0.1:19387
   * @param {{ onEvent: Function, onStatus: Function, onLog: Function }} hooks
   */
  constructor(baseUrl, hooks = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.hooks = hooks
    this.authority = new URL(this.baseUrl).host
    this.secret = readAuthSecret()
    this.cookie = this.secret ? signCookie(this.secret, this.authority) : undefined
    this.connected = false
    this.mux = null
    this.reconnectTimer = null
    this.stopped = false
    this.streamSeq = 0
  }

  log(message, extra) {
    if (this.hooks.onLog) this.hooks.onLog(message, extra)
    console.log('[gateway]', message, extra === undefined ? '' : extra)
  }

  setStatus(connected) {
    if (this.connected === connected) return
    this.connected = connected
    if (this.hooks.onStatus) this.hooks.onStatus(connected, this.baseUrl)
  }

  headers() {
    const h = { 'Content-Type': 'application/json' }
    if (this.cookie) h['Cookie'] = this.cookie
    return h
  }

  /**
   * 调用一个 RPC。
   * 新版：POST /api/<domain>/<method>，body = { type, rpcId, method:'<domain>/<method>', payload:{ args:{ _request } } }
   * 旧版：POST /api/<domain>.<method>，body 里 payload 直接就是业务参数。
   * 这里先试新版，失败再试旧版。
   */
  async call(method, payload = {}) {
    const slash = method.replace('.', '/')
    const attempts = [
      { path: `/api/${slash}`, body: this.newEnvelope(slash, { args: { _request: payload } }) },
      { path: `/api/${slash}`, body: this.newEnvelope(slash, { _request: payload }) },
      { path: `/api/${method}`, body: this.newEnvelope(method, payload) },
    ]
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
  connect() {
    if (this.stopped) return
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

module.exports = { Gateway, readAuthSecret, readDeepSeekKey, fetchBalance, signCookie, dshHome }