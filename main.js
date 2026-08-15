// 虎鲸桌宠 - Electron 主进程
// 职责：
//   1. 创建透明无框置顶窗口；处理"拖动身体移动窗口"
//   2. 作为 harness gateway 的第二客户端：订阅事件流、派活、驱动情绪状态机
const { app, BrowserWindow, ipcMain, Menu } = require('electron')
const path = require('node:path')
const WebSocket = require('ws')

const WINDOW_WIDTH = 420
const WINDOW_HEIGHT = 400
const GATEWAY_URL = process.env.WHALE_PET_URL || 'http://127.0.0.1:3080'

let win = null
let dragStartBounds = null

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
  if (!win) return
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
          click: () => { if (win) win.webContents.send('pet:set-skin', s.id) },
        })),
        { type: 'separator' },
        { label: '🎨 自定义配色…', click: () => openColorPanel() },
      ],
    },
    {
      label: '🎚 跳舞强度',
      submenu: DANCE_LEVELS.map((d) => ({
        label: d.label,
        click: () => { if (win) win.webContents.send('pet:set-dance-freq', d.id) },
      })),
    },
    { label: '🎵 播放器', click: () => openPlayer() },
    { label: '📖 帮助', click: () => openHelpPanel() },
    { type: 'separator' },
    { label: '🗕 最小化', click: () => { if (win) win.minimize() } },
    { label: '✕ 退出', click: () => app.quit() },
  ]
  Menu.buildFromTemplate(template).popup({ window: win, x: Math.round(cx), y: Math.round(cy) })
})

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
  if (win) win.webContents.send('pet:audio-freq', data)
})
ipcMain.on('pet:music-comment', (_event, name) => {
  if (win) win.webContents.send('pet:music-comment', name)
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
  if (win && data && data.dark !== undefined) win.webContents.send('pet:set-custom-skin', data)
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
// 信任围栏：Host 为 loopback 且无 Origin 的请求放行；POST 必须 application/json

let sessionId = null
let connected = false
let lastEventAt = 0
let mood = 'idle'
let idleTimer = null
const moodListeners = []

function pushMood(next) {
  if (mood === next) return
  mood = next
  lastEventAt = Date.now()
  if (win) win.webContents.send('pet:mood', next)
  for (const cb of moodListeners) cb(next)
}

// idle 回退：状态活跃后 40 秒无新事件 → 回归 idle
function resetIdleTimer() {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => { if (mood !== 'idle') pushMood('idle') }, 40_000)
}

async function call(method, payload) {
  const res = await fetch(`${GATEWAY_URL}/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `pet-${Date.now()}-${Math.random().toString(36).slice(2)}`, method, payload }),
  })
  if (!res.ok) throw new Error(`${method} HTTP ${res.status}`)
  const body = await res.json()
  if (!body.result || body.result.ok !== true) {
    throw new Error(`${method} 失败: ${JSON.stringify(body.result && body.result.error)}`)
  }
  return body.result.value
}

// 选一个会话：优先最新的非空白会话；没有则新建（cwd 用用户主目录）
async function pickSession() {
  try {
    const { items } = await call('session.list', {})
    const live = items && items.filter((it) => !it.blank && !it.running)
    if (live && live.length > 0) {
      live.sort((a, b) => b.updatedAt - a.updatedAt)
      return live[0].sessionId
    }
    const { sessionId: created } = await call('session.create', { cwd: process.env.USERPROFILE || process.env.HOME || '.' })
    return created
  } catch (err) {
    console.error('pickSession 失败:', err.message)
    return null
  }
}

function sendMood(next) {
  pushMood(next)
  resetIdleTimer()
}

// 状态机：事件流帧 → 情绪 + 派活会话的流式回复转发（P3）
function handleFrame(frame) {
  if (!frame || frame.type !== 'server-request') return
  switch (frame.method) {
    case 'session/event': {
      const { event, sessionId: evSessionId } = frame.payload || {}
      if (!event || !event.type) return
      // 只回显派活目标会话的文本；未选定会话前不转发，避免泄漏其它会话内容
      const watching = !!sessionId && evSessionId === sessionId
      if (event.type === 'assistant/chunk') {
        const chunk = event.data && event.data.chunk
        if (watching && chunk && chunk.type === 'text-delta' && chunk.text) {
          if (win) win.webContents.send('pet:stream', {
            kind: 'chunk',
            text: chunk.text,
            turn: event.data && event.data.turn,
            step: event.data && event.data.step,
          })
        }
        sendMood('working')
      } else if (event.type === 'assistant/message') {
        if (watching) {
          const text = ((event.data && event.data.content) || [])
            .filter((b) => b && b.type === 'text' && b.text)
            .map((b) => b.text)
            .join('\n')
          if (text && win) win.webContents.send('pet:stream', { kind: 'message', text })
        }
        sendMood('ready')
      } else if (event.type === 'turn/end') {
        if (watching && win) win.webContents.send('pet:stream', { kind: 'done' })
        sendMood('ready')
      } else if (event.type === 'turn/start' || event.type === 'step/start' || event.type === 'tool/call') {
        sendMood('working')
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

// 事件流客户端：harness 的事件下发已从 SSE 换成 WebSocket
// （GET /api/events.mux|host 现在返回 426，要求升级到 websocket）。
// 每条 WS 文本消息就是一个 ServerRequest JSON 帧，结构与旧 SSE 的 data:<JSON> 完全一致。
function openWS(path, onFrame, onOpen, onClose) {
  let stopped = false
  let ws = null
  let reconnectTimer = null
  function run() {
    if (stopped) return
    const wsUrl = GATEWAY_URL.replace(/^http/, 'ws') + path
    ws = new WebSocket(wsUrl)
    ws.on('open', () => { if (onOpen) onOpen() })
    ws.on('message', (data) => {
      try { onFrame(JSON.parse(data.toString())) } catch { /* 忽略坏帧 */ }
    })
    ws.on('error', (err) => {
      if (win) win.webContents.send('pet:log', { where: path, err: err.message })
      console.error('WS 断开:', path, err.message)
    })
    ws.on('close', () => {
      if (!stopped) {
        if (onClose) onClose()
        reconnectTimer = setTimeout(run, 2000) // 断线自动重连
      }
    })
  }
  run()
  return {
    close() {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.terminate()
      }
    },
  }
}

function connectGateway() {
  if (!win) return
  openWS('/api/events.mux', handleFrame, () => {
    connected = true
    if (win) win.webContents.send('pet:connection', { connected: true, url: GATEWAY_URL })
    // 仅在尚未选定会话时选取；重连不切换会话，避免派活中途丢失回复
    if (!sessionId) pickSession().then((sid) => { sessionId = sid })
  }, () => {
    connected = false
    if (win) win.webContents.send('pet:connection', { connected: false, url: GATEWAY_URL })
  })
  // host 流：agent-error 等宿主级事件
  openWS('/api/events.host', (frame) => {
    if (frame.method === 'host/agent-error') sendMood('blocked')
  })
}

// ---- 派活：renderer 请求 prompt，流式 chunk 转发，结束汇总 ----
ipcMain.on('pet:prompt', async (event, text) => {
  if (!connected) {
    event.reply('pet:reply', { error: '未连接到 harness，请先启动 dsh web' })
    return
  }
  try {
    if (!sessionId) sessionId = await pickSession()
    await call('session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text }] })
  } catch (err) {
    event.reply('pet:reply', { error: `派活失败: ${err.message}` })
  }
})

// P3：流式回复由 handleFrame 观察 mux 流、按会话过滤后转发 pet:stream；renderer 消费。

app.whenReady().then(() => {
  createWindow()
  win.webContents.on('did-finish-load', () => connectGateway())
})
app.on('window-all-closed', () => app.quit())