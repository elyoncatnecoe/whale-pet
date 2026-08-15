// 虎鲸桌宠 - 预加载桥：窗口拖动 + gateway 通信
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('petWindow', {
  // 拖动协议：主进程锁尺寸 + 相对总位移（修复缩放屏下窗口变大 bug）
  dragStart() {
    ipcRenderer.send('drag-start')
  },
  dragMove(dx, dy) {
    ipcRenderer.send('drag-move', dx, dy)
  },
  dragEnd() {
    ipcRenderer.send('drag-end')
  },
  // 右键菜单（cx/cy 为窗口内坐标）
  contextMenu(cx, cy) {
    ipcRenderer.send('pet:context-menu', cx, cy)
  },
})

contextBridge.exposeInMainWorld('petBridge', {
  // 情绪变化：'idle' | 'working' | 'needs-input' | 'ready' | 'blocked'
  onMood(cb) {
    ipcRenderer.on('pet:mood', (_e, mood) => cb(mood))
  },
  // 连接状态
  onConnection(cb) {
    ipcRenderer.on('pet:connection', (_e, info) => cb(info))
  },
  // 派活结果 / 错误
  onLog(cb) {
    ipcRenderer.on('pet:log', (_e, data) => cb(data))
  },
  onReply(cb) {
    ipcRenderer.on('pet:reply', (_e, data) => cb(data))
  },
  // 流式回复：{ kind: 'chunk' | 'message' | 'done', text? }
  onStream(cb) {
    ipcRenderer.on('pet:stream', (_e, data) => cb(data))
  },
  prompt(text) {
    ipcRenderer.send('pet:prompt', text)
  },
  // —— 皮肤切换 ——
  onSetSkin(cb) {
    ipcRenderer.on('pet:set-skin', (_e, name) => cb(name))
  },
  onSetCustomSkin(cb) {
    ipcRenderer.on('pet:set-custom-skin', (_e, data) => cb(data))
  },
  onSetDanceFreq(cb) {
    ipcRenderer.on('pet:set-dance-freq', (_e, v) => cb(v))
  },
  // —— 播放器：主窗口接收频谱/曲名，可打开播放器 ——
  onAudioFreq(cb) {
    ipcRenderer.on('pet:audio-freq', (_e, data) => cb(data))
  },
  onMusicComment(cb) {
    ipcRenderer.on('pet:music-comment', (_e, name) => cb(name))
  },
  openPlayer() {
    ipcRenderer.send('pet:open-player')
  },
  // —— 播放器窗口：发送频谱/曲名，窗口控制 ——
  sendAudioFreq(data) {
    ipcRenderer.send('pet:audio-freq', data)
  },
  musicComment(name) {
    ipcRenderer.send('pet:music-comment', name)
  },
  minimizePlayer() {
    ipcRenderer.send('pet:minimize-player')
  },
  closePanel() {
    ipcRenderer.send('pet:close-panel')
  },
  // —— 自定义配色窗口：发送所选配色 ——
  sendCustomSkin(dark, white) {
    ipcRenderer.send('pet:set-custom-skin', { dark, white })
  },
})