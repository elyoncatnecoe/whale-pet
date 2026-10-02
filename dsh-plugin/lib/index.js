// 虎鲸桌宠 · DSH 插件 Host 半边
// 职责：管理 whale-pet Electron 桌宠进程（启动 / 停止 / 状态），并转发 DeepSeek 余额查询。
//
// 通道：在 DSH 自己的 web 服务器上注册一条私有 HTTP 路由 /whale-pet/rpc，
//       客户端半边用 fetch 调用。这条路由复用 DSH 的信任围栏 + 浏览器鉴权，
//       所以只有本机已登录的页面能访问。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 插件自身目录。 */
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))

/** 路由前缀。 */
const ROUTE = '/whale-pet/rpc'

/** 桌宠进程状态。 */
const state = { child: null, startedAt: 0, lastError: undefined }

/** 是否在运行。 */
function isRunning() {
  return state.child !== null && state.child.exitCode === null && !state.child.killed
}

/** 解析桌宠目录：环境变量 > 随插件分发的 pet/ > 源码仓库同级。 */
function resolvePetDir() {
  const fromEnv = process.env.WHALE_PET_DIR
  if (fromEnv && existsSync(join(fromEnv, 'main.js'))) return fromEnv
  const bundled = join(PLUGIN_DIR, '..', 'pet')
  if (existsSync(join(bundled, 'main.js'))) return bundled
  const sibling = join(PLUGIN_DIR, '..', '..')
  if (existsSync(join(sibling, 'main.js'))) return sibling
  return undefined
}

/** 定位 electron 可执行文件。 */
function resolveElectron(petDir) {
  const exe = process.platform === 'win32' ? 'electron.exe' : 'electron'
  const candidates = [
    join(petDir, 'node_modules', 'electron', 'dist', exe),
    join(petDir, 'node_modules', 'electron', exe),
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return undefined
}

/** 启动桌宠。 */
async function startPet() {
  if (isRunning()) return { ok: true, already: true }
  const petDir = resolvePetDir()
  if (!petDir) {
    state.lastError = '找不到桌宠目录，请设置环境变量 WHALE_PET_DIR 指向 whale-pet 项目目录'
    return { ok: false, error: state.lastError }
  }
  const electron = resolveElectron(petDir)
  if (!electron) {
    state.lastError = `桌宠依赖未安装：请先在 ${petDir} 执行 npm install`
    return { ok: false, error: state.lastError }
  }
  try {
    // 关键：剥掉 ELECTRON_RUN_AS_NODE。DSH 宿主可能带着这个变量，
    // 它会让 electron.exe 退化成纯 Node 进程，导致 main.js 拿不到 ipcMain 而秒退。
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(electron, [petDir], {
      cwd: petDir,
      stdio: 'ignore',
      env,
    })
    child.on('exit', () => { state.child = null })
    child.on('error', (err) => { state.lastError = err?.message ?? String(err); state.child = null })
    state.child = child
    state.startedAt = Date.now()
    state.lastError = undefined
    // 等一小会儿确认进程没秒退，把真实原因带回给界面。
    await new Promise((r) => setTimeout(r, 1200))
    if (!isRunning()) {
      return { ok: false, error: state.lastError || '桌宠启动后立即退出，请检查依赖是否完整（在 pet 目录执行 npm install）' }
    }
    return { ok: true }
  } catch (err) {
    state.lastError = err?.message ?? String(err)
    return { ok: false, error: state.lastError }
  }
}

/** 停止桌宠。 */
function stopPet() {
  if (!isRunning()) { state.child = null; return { ok: true, already: true } }
  try { state.child.kill() } catch { /* 已退出 */ }
  state.child = null
  return { ok: true }
}

/** 读取凭据文件里的一个值（最小化逐行解析）。 */
async function readCredential(key) {
  const file = join(process.env.DSH_HOME || join(homedir(), '.dsh'), '.credentials.yaml')
  try {
    const text = await readFile(file, 'utf8')
    const m = new RegExp('^\\s*' + key + ':\\s*(.+?)\\s*$', 'm').exec(text)
    return m ? m[1].replace(/^["']|["']$/g, '') : undefined
  } catch {
    return undefined
  }
}

/** 查询 DeepSeek 余额。 */
async function queryBalance() {
  const key = await readCredential('DEEPSEEK_API_KEY')
  if (!key) return { ok: false, error: '未找到 DEEPSEEK_API_KEY（请检查 ~/.dsh/.credentials.yaml）' }
  try {
    const res = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    })
    if (res.status === 401) return { ok: false, error: 'API Key 无效或已失效' }
    if (!res.ok) return { ok: false, error: `余额接口 HTTP ${res.status}` }
    const body = await res.json()
    const info = (body.balance_infos && body.balance_infos[0]) || {}
    return {
      ok: true,
      available: body.is_available === true,
      currency: info.currency || 'CNY',
      total: Number(info.total_balance ?? 0),
      granted: Number(info.granted_balance ?? 0),
      toppedUp: Number(info.topped_up_balance ?? 0),
    }
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) }
  }
}

/** 方法表。 */
const METHODS = {
  status: async () => ({ ok: true, running: isRunning(), startedAt: state.startedAt, error: state.lastError, petDir: resolvePetDir() }),
  start: async () => startPet(),
  stop: async () => stopPet(),
  balance: async () => queryBalance(),
}

/** 处理一次 RPC 请求。 */
async function handleRpc(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
    return
  }
  let body = ''
  try {
    for await (const chunk of req) body += chunk
    const { method, args } = JSON.parse(body || '{}')
    const fn = METHODS[method]
    if (!fn) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: `unknown method ${method}` }))
      return
    }
    const result = await fn(args)
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(result ?? { ok: true }))
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: err?.message ?? String(err) }))
  }
}

/** 注册路由与围栏。 */
function mountRoute(ctx) {
  const webServer = ctx.get('webServer')
  if (!webServer) return () => {}

  const unregister = webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (req, res) => {
      // 每次请求都实时取 connection（服务可能晚于本插件就绪）
      const connection = ctx.root?.get?.('connection') ?? ctx.get('connection')
      let rejection
      if (connection && typeof connection.requestRejection === 'function') {
        try { rejection = connection.requestRejection(req) } catch (e) { rejection = undefined }
      } else {
        // 拿不到围栏服务时，退化为「无 cookie 一律拒绝」，绝不裸奔
        const cookie = req.headers && req.headers.cookie
        rejection = cookie ? undefined : 401
      }
      if (rejection !== undefined) {
        res.writeHead(rejection, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
      await handleRpc(req, res)
    },
  })
  return () => unregister()
}

export function apply(ctx) {
  ctx.inject(['webServer', 'connection'], (webCtx) => {
    webCtx.effect(() => mountRoute(webCtx), 'whale-pet: rpc route')
  })
  // 插件卸载时收掉桌宠进程，不留孤儿。
  ctx.effect(() => () => { stopPet() }, 'whale-pet: stop pet on dispose')
}

export const name = 'whale-pet'
export const inject = ['webServer', 'connection']