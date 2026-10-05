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

/** 路由前缀。带 -desktop 后缀，避免与其他宠物插件抢同一个路径。 */
const ROUTE = '/3d-whale-pet/rpc'

/** 桌宠进程状态。 */
const state = { child: null, startedAt: 0, lastError: undefined, installing: false }

/** 是否在运行。 */
function isRunning() {
  return state.child !== null && state.child.exitCode === null && !state.child.killed
}

/**
 * 候选桌宠目录，按优先级排列：
 *   1. WHALE_PET_DIR 环境变量（用户显式指定）
 *   2. 随插件分发的 pet/
 *   3. 仓库根目录（开发时插件就在仓库里，源码那份依赖通常已装好）
 * 只收录真正存在 main.js 的目录。
 * @returns {string[]} 去重后的候选绝对路径
 */
function petDirCandidates() {
  const list = []
  if (process.env.WHALE_PET_DIR) list.push(process.env.WHALE_PET_DIR)
  list.push(join(PLUGIN_DIR, '..', 'pet'))
  list.push(join(PLUGIN_DIR, '..', '..'))
  const seen = new Set()
  return list.filter((p) => {
    if (seen.has(p)) return false
    seen.add(p)
    return existsSync(join(p, 'main.js'))
  })
}

/**
 * 定位 electron 可执行文件。
 * 桌宠要跑起来必须能找到 electron，所以解析目录时以「哪里装好了依赖」为准，
 * 而不是单纯看 main.js 在不在。
 */
function resolveElectron(petDir) {
  if (!petDir) return undefined
  const exe = process.platform === 'win32' ? 'electron.exe' : 'electron'
  const candidates = [
    join(petDir, 'node_modules', 'electron', 'dist', exe),
    join(petDir, 'node_modules', 'electron', exe),
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return undefined
}

/**
 * 选出真正可用的桌宠目录：优先能跑起来的（依赖齐全）。
 * 全都没依赖时退回第一个候选，好把「请先 npm install」的原话报给用户。
 * @returns {{ dir: string|undefined, electron: string|undefined, candidates: string[] }}
 */
function resolvePet() {
  const candidates = petDirCandidates()
  for (const dir of candidates) {
    const electron = resolveElectron(dir)
    if (electron) return { dir, electron, candidates }
  }
  return { dir: candidates[0], electron: undefined, candidates }
}

/** 启动桌宠。 */
async function startPet() {
  if (isRunning()) return { ok: true, already: true }
  const { dir: petDir, electron, candidates } = resolvePet()
  if (!petDir) {
    state.lastError = '找不到桌宠目录，请设置环境变量 WHALE_PET_DIR 指向 whale-pet 项目目录'
    return { ok: false, error: state.lastError }
  }
  if (!electron) {
    // 把所有候选都告诉用户，方便他挑一个装依赖 / 或设 WHALE_PET_DIR
    const tried = candidates.length > 0 ? candidates.join(' 、 ') : petDir
    state.lastError =
      `桌宠依赖未安装（缺 electron）。可在界面点「安装依赖」自动处理，` +
      `或手动在下面任一目录执行 npm install：${tried}`
    return { ok: false, error: state.lastError, needsInstall: true, petDir }
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

/**
 * 按需安装桌宠依赖（主要是 electron，约 180MB）。
 *
 * 为什么不在 postinstall 里做：pnpm 10+ 默认拦截依赖的构建脚本，
 * 插件从 git/npm 装下来时 postinstall 不会执行。所以改成用户点按钮
 * 时再装，进度也能反馈到界面。
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function installDeps() {
  if (state.installing) return { ok: false, error: '正在安装中，请稍候…' }
  const { dir: petDir, candidates } = resolvePet()
  if (!petDir) {
    return { ok: false, error: '找不到桌宠目录，无法安装依赖' }
  }
  state.installing = true
  state.lastError = undefined
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: petDir,
        stdio: 'ignore',
        shell: true,
        env: { ...process.env },
      })
      const timer = setTimeout(() => {
        try { child.kill() } catch { /* 已退出 */ }
        reject(new Error('安装超时（10 分钟），请检查网络后手动安装'))
      }, 10 * 60 * 1000)
      child.on('exit', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve()
        else reject(new Error(`npm install 退出码 ${code}`))
      })
      child.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
    // 装完再验一次
    const { electron } = resolvePet()
    if (!electron) {
      return { ok: false, error: `npm install 已执行，但仍找不到 electron。可手动在 ${petDir} 执行 npm install 查看报错。` }
    }
    return { ok: true }
  } catch (err) {
    const msg = err?.message ?? String(err)
    state.lastError = `依赖安装失败：${msg}`
    const tried = candidates.length > 0 ? candidates.join(' 、 ') : petDir
    return { ok: false, error: `${state.lastError}。可手动在 ${tried} 执行 npm install。` }
  } finally {
    state.installing = false
  }
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
  status: async () => {
    const { dir, electron } = resolvePet()
    return {
      ok: true,
      running: isRunning(),
      startedAt: state.startedAt,
      error: state.lastError,
      petDir: dir,
      // 让界面能区分「找不到目录」和「目录在但依赖没装」
      ready: Boolean(dir && electron),
      installing: Boolean(state.installing),
    }
  },
  start: async () => startPet(),
  stop: async () => stopPet(),
  install: async () => installDeps(),
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