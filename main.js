// 虎鲸桌宠 - Electron 主进程
// 职责：
//   1. 创建透明无框置顶窗口；处理"拖动身体移动窗口"
//   2. 作为 harness gateway 的第二客户端：订阅事件流、派活、驱动情绪状态机
const { app, BrowserWindow, ipcMain, Menu } = require('electron')
const path = require('node:path')
const { Gateway, fetchBalance } = require('./gateway.js')

const WINDOW_WIDTH = 420
const WINDOW_HEIGHT = 400
// 新版 dsh（桌面版）默认监听 19387；旧版 dsh web 默认 3080。
// 可用 WHALE_PET_URL 显式覆盖。
const GATEWAY_URL = process.env.WHALE_PET_URL || 'http://127.0.0.1:19387'

let win = null
let dragStartBounds = null

// 退出中标记：窗口开始关闭后，网关/WebSocket 的回调可能仍在触发，
// 此时绝不能再往渲染进程发消息（否则 main process 抛 "Object has been destroyed" 并弹框）。
let quitting = false

/**
 * 安全地往主窗口发消息。
 * 窗口对象销毁后依然非 null，所以只判断 `if (win)` 不够——必须查 isDestroyed()。
 * @returns {boolean} 是否真的发出去了
 */
function sendToWin(channel, payload) {
  if (quitting) return false
  if (!win || win.isDestroyed()) return false
  const wc = win.webContents
  if (!wc || wc.isDestroyed()) return false
  try {
    wc.send(channel, payload)
    return true
  } catch {
    // 窗口正在销毁的竞态窗口期：静默忽略，不打扰用户
    return false
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setMenu(null)
  win.loadFile(path.join(__dirname, 'renderer', 'pet.html'))
}

// ---- 拖动：锁定窗口尺寸 + 相对总位移（修复 Windows 显示缩放下反复拖动窗口变大的 bug）----
// 根因：getPosition()+setPosition() 每次做 DIP↔物理像素取整，二者非互逆，误差累积会让窗口"棘轮式"变大；
//       窗口变大后相机距离不变，虎鲸跟着变大（放大），误差持续累积最终卡死/闪退。
// 修法：拖动开始缓存 getBounds()，之后一律用 "起点 + 总位移" 的 setBounds() 并锁死宽高。
ipcMain.on('drag-start', () => {
  if (!win || win.isDestroyed()) return
  dragStartBounds = win.getBounds()
})

ipcMain.on('drag-move', (_event, dx, dy) => {
  if (!win || typeof dx !== 'number' || typeof dy !== 'number') return
  if (!dragStartBounds) dragStartBounds = win.getBounds()
  win.setBounds({
    x: Math.round(dragStartBounds.x + dx),
    y: Math.round(dragStartBounds.y + dy),
    width: dragStartBounds.width,
    height: dragStartBounds.height,
  })
})

ipcMain.on('drag-end', () => {
  dragStartBounds = null
})

// ==================== 右键菜单：换皮肤 / 播放器 / 最小化 / 退出 ====================
const SKINS = [
  { id: 'classic', label: '🔵 深寻蓝' },
  { id: 'night',   label: '🌙 虎鲸黑' },
  { id: 'pink',    label: '🌸 草莓粉' },
  { id: 'green',   label: '🌿 薄荷绿' },
  { id: 'gold',    label: '🌟 土豪金' },
]
const DANCE_LEVELS = [
  { id: 0,   label: '🚫 关闭' },
  { id: 0.4, label: '🐢 低' },
  { id: 0.7, label: '🐬 中' },
  { id: 1.0, label: '🚀 高' },
]

ipcMain.on('pet:context-menu', (_event, cx, cy) => {
  if (!win) return
  const template = [
    {
      label: '🎨 换皮肤',
      submenu: [
        ...SKINS.map((s) => ({
          label: s.label,
          click: () => sendToWin('pet:set-skin', s.id),
        })),
        { type: 'separator' },
        { label: '🎨 自定义配色…', click: () => openColorPanel() },
      ],
    },
    {
      label: '🎚 跳舞强度',
      submenu: DANCE_LEVELS.map((d) => ({
        label: d.label,
        click: () => sendToWin('pet:set-dance-freq', d.id),
      })),
    },
    { label: '🎵 播放器', click: () => openPlayer() },
    { label: '💰 查询余额', click: () => { queryBalance() } },
    { label: '📖 帮助', click: () => openHelpPanel() },
    { type: 'separator' },
    { label: '🗕 最小化', click: () => { if (win && !win.isDestroyed()) win.minimize() } },
    { label: '✕ 退出', click: () => app.quit() },
  ]
  Menu.buildFromTemplate(template).popup({ window: win, x: Math.round(cx), y: Math.round(cy) })
})

// ==================== 余额查询 ====================
// 走 DeepSeek 官方 /user/balance；key 自动从 ~/.dsh/.credentials.yaml 读取。
// 结果推给渲染进程，由虎鲸气泡播报。
let balanceBusy = false

async function queryBalance() {
  if (!win) return
  if (balanceBusy) return
  balanceBusy = true
  sendToWin('pet:balance', { kind: 'loading' })
  try {
    const b = await fetchBalance()
    const symbol = b.currency === 'USD' ? '$' : '¥'
    const total = b.total.toFixed(2)
    let text = `💰 余额 ${symbol}${total}`
    if (b.granted > 0) text += `（赠金 ${symbol}${b.granted.toFixed(2)}）`
    if (!b.available) text = `⚠️ 余额不足，API 已不可用：${symbol}${total}`
    else if (b.total < 1) text += '　⚡ 快没钱啦，记得充值'
    sendToWin('pet:balance', { kind: 'ok', text, data: b })
  } catch (err) {
    sendToWin('pet:balance', { kind: 'error', text: `余额查询失败：${err.message}` })
  } finally {
    balanceBusy = false
  }
}

ipcMain.on('pet:query-balance', () => { queryBalance() })

// ==================== 播放器窗口 ====================
let playerWin = null

function openPlayer() {
  if (playerWin && !playerWin.isDestroyed()) {
    if (!playerWin.isVisible()) playerWin.show()
    playerWin.focus()
    return
  }
  playerWin = new BrowserWindow({
    width: 320,
    height: 420,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#141a2c',
    title: '音乐播放器',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  playerWin.loadFile(path.join(__dirname, 'renderer', 'player.html'))
  playerWin.on('closed', () => { playerWin = null })
}

ipcMain.on('pet:open-player', () => openPlayer())
ipcMain.on('pet:minimize-player', () => { if (playerWin && !playerWin.isDestroyed()) playerWin.hide() })
ipcMain.on('pet:close-panel', (event) => {
  const w = BrowserWindow.fromWebContents(event.sender)
  if (w && w !== win) w.close()
})

// 播放器频谱/曲名 → 转发给主窗口（驱动虎鲸随节奏跳舞）
ipcMain.on('pet:audio-freq', (_event, data) => {
  sendToWin('pet:audio-freq', data)
})
ipcMain.on('pet:music-comment', (_event, name) => {
  sendToWin('pet:music-comment', name)
})

// ==================== 自定义配色窗口 ====================
let colorWin = null
function openColorPanel() {
  if (colorWin && !colorWin.isDestroyed()) { colorWin.focus(); return; }
  colorWin = new BrowserWindow({
    width: 280,
    height: 260,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#141a2c',
    title: '自定义配色',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  colorWin.loadFile(path.join(__dirname, 'renderer', 'color.html'))
  colorWin.on('closed', () => { colorWin = null })
}
ipcMain.on('pet:set-custom-skin', (_event, data) => {
  if (data && data.dark !== undefined) sendToWin('pet:set-custom-skin', data)
})

// ==================== 帮助窗口 ====================
let helpWin = null
function openHelpPanel() {
  if (helpWin && !helpWin.isDestroyed()) { helpWin.focus(); return; }
  helpWin = new BrowserWindow({
    width: 360,
    height: 500,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#141a2c',
    title: '帮助',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  helpWin.loadFile(path.join(__dirname, 'renderer', 'help.html'))
  helpWin.on('closed', () => { helpWin = null })
}

// ==================== gateway 客户端 ====================
// 协议细节全部封装在 gateway.js（鉴权 Cookie / RPC 路径 / WS mux），此处只关心业务。

let sessionId = null
let connected = false
let lastEventAt = 0
let mood = 'idle'
let idleTimer = null
const moodListeners = []

let gateway = null

function pushMood(next) {
  if (mood === next) return
  mood = next
  lastEventAt = Date.now()
  sendToWin('pet:mood', next)
  for (const cb of moodListeners) cb(next)
}

// idle 回退：状态活跃后 40 秒无新事件 → 回归 idle
function resetIdleTimer() {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => { if (mood !== 'idle') pushMood('idle') }, 40_000)
}

function call(method, payload) {
  if (!gateway) throw new Error('gateway 尚未初始化')
  return gateway.call(method, payload)
}

// 选「当前」会话：harness 没有"当前窗口"的 host 端信号，就用"最近有人发消息的会话"近似，
// 也就是用户正在聊的那个窗口。每次派活都重新选，跟随用户切换窗口。
async function pickCurrentSession() {
  try {
    const { items } = await call('session.list', {})
    const live = items && items.filter((it) => !it.blank)
    if (live && live.length > 0) {
      live.sort((a, b) => b.updatedAt - a.updatedAt)
      return live[0].sessionId
    }
    // 没有任何非空白会话：新建一个（对应"刚打开一个全新窗口"的情况）
    const { sessionId } = await call('session.create', { cwd: process.env.USERPROFILE || process.env.HOME || '.' })
    return sessionId
  } catch (err) {
    console.error('pickCurrentSession 失败:', err.message)
    return null
  }
}

function sendMood(next) {
  pushMood(next)
  resetIdleTimer()
}

// 状态机：事件流帧 → 情绪 + 派活会话的流式回复转发（P3）
// 新版 $events 流推送的是事件对象本身（可能与旧版 session/event 包装不同），
// 这里做兼容解析：既接受 {type:'session/event', payload:{...}}，也接受裸事件。
function handleFrame(raw) {
  if (!raw || typeof raw !== 'object') return
  // 控制帧
  if (raw.type === 'ready') return
  let frame = raw
  // 兼容旧版包装：{ type:'server-request', method, payload }
  if (raw.type === 'server-request') {
    frame = { method: raw.method, payload: raw.payload }
  } else if (raw.sessionId !== undefined || raw.event !== undefined) {
    frame = { method: 'session/event', payload: raw }
  } else if (raw.method === undefined) {
    return
  }
  switch (frame.method) {
    case 'session/event':
    case 'session/event-batch': {
      const payload = frame.payload || {}
      const events = payload.events || (payload.event ? [payload.event] : [])
      const evSessionId = payload.sessionId
      for (const event of events) {
        if (!event || !event.type) continue
        const watching = !!sessionId && evSessionId === sessionId
        handleSessionEvent(event, watching)
      }
      break
    }
    case 'approval/requested':
    case 'question/requested':
      sendMood('needs-input')
      break
    case 'stream/error':
      sendMood('blocked')
      break
  }
}

function handleSessionEvent(event, watching) {
  switch (event.type) {
    case 'assistant/chunk': {
      const chunk = event.data && event.data.chunk
      if (watching && chunk && chunk.type === 'text-delta' && chunk.text) {
        sendToWin('pet:stream', {
          kind: 'chunk',
          text: chunk.text,
          turn: event.data && event.data.turn,
          step: event.data && event.data.step,
        })
      }
      sendMood('working')
      break
    }
    case 'assistant/message': {
      if (watching) {
        const text = ((event.data && event.data.content) || [])
          .filter((b) => b && b.type === 'text' && b.text)
          .map((b) => b.text)
          .join('\n')
        if (text) sendToWin('pet:stream', { kind: 'message', text })
      }
      sendMood('ready')
      break
    }
    case 'turn/end': {
      if (watching) sendToWin('pet:stream', { kind: 'done' })
      sendMood('ready')
      break
    }
    case 'turn/start':
    case 'step/start':
    case 'tool/call':
      sendMood('working')
      break
    default:
      break
  }
}

function connectGateway() {
  if (quitting) return
  gateway = new Gateway(GATEWAY_URL, {
    onStatus: (isConnected, url) => {
      connected = isConnected
      // 窗口可能已销毁（用户在退出时网关恰好断开），sendToWin 会安全跳过
      sendToWin('pet:connection', { connected: isConnected, url })
      if (isConnected && !sessionId && !quitting) {
        pickCurrentSession().then((sid) => { sessionId = sid }).catch(() => {})
      }
    },
    onEvent: (value) => {
      if (quitting) return
      handleFrame(value)
    },
    onLog: (message, extra) => {
      sendToWin('pet:log', { where: 'gateway', message, extra })
    },
  })
  gateway.connect()
}

// ---- 派活：renderer 请求 prompt，流式 chunk 转发，结束汇总 ----
ipcMain.on('pet:prompt', async (event, text) => {
  if (!connected) {
    event.reply('pet:reply', { error: '未连接到 harness，请先启动 dsh' })
    return
  }
  try {
    // 每次派活都重新选「当前窗口」的会话，跟随用户在 harness 里切换窗口
    sessionId = await pickCurrentSession()
    if (!sessionId) throw new Error('找不到可用的会话')
    await call('session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text }] })
  } catch (err) {
    event.reply('pet:reply', { error: `派活失败: ${err.message}` })
  }
})

// 流式回复由 handleFrame 观察 mux 流、按会话过滤后转发 pet:stream；renderer 消费。

app.whenReady().then(() => {
  createWindow()
  win.webContents.on('did-finish-load', () => connectGateway())
})

// ---- 退出清理 ----
// 关键顺序：先立 quitting 标记 → 再关网关 → 最后退出。
// 否则 WebSocket 的 close 回调会在窗口销毁之后才跑，触发
// "Object has been destroyed"（main process 未捕获异常弹框）。
function shutdown() {
  if (quitting) return
  quitting = true
  try { if (gateway) gateway.close() } catch { /* 已关闭 */ }
}

// 用户关掉主窗口（例如右键→退出、或系统关闭）时走这里
app.on('before-quit', shutdown)

// 主窗口关闭：标记退出中，避免后续任何 send
app.on('window-all-closed', () => {
  shutdown()
  app.quit()
})

// 兜底：任何漏网的异常都不该弹「JavaScript error occurred」框打扰用户
process.on('uncaughtException', (err) => {
  // 窗口销毁竞态导致的发送失败属于预期内噪声，静默忽略
  if (err && /Object has been destroyed/i.test(String(err.message))) return
  console.error('[whale-pet] uncaughtException:', err)
})