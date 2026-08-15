# 虎鲸桌宠（whale-pet）

一只常驻桌面的透明置顶虎鲸桌宠：用 Three.js 程序化建模、Electron 承载，并作为 dsh harness 的第二客户端订阅事件流、派发任务、驱动情绪状态机。

## 功能特性

- 🐋 **3D 虎鲸**：程序化建模（身体 / 尾鳍 / 背鳍 / 胸鳍 / 眼斑），温和游动动画，带情绪状态机（idle / working / needs-input / ready / blocked）。
- 🎨 **换肤**：5 套预设配色（深寻蓝 / 虎鲸黑 / 草莓粉 / 薄荷绿 / 土豪金）+ 自定义配色（取色器）。
- 🎵 **音乐播放器**：导入本地音频，Web Audio 频谱分析，虎鲸随节拍打点、转圈、冒音符。
- 🎚 **跳舞强度**：关闭 / 低 / 中 / 高 四档可调。
- 🐟 **互动**：投喂（小鱼游入）、爱心、睡眠（闭眼 + 💤）。
- 💬 **派活**：连接 dsh harness，输入任务并流式回显结果。
- 🖱️ **窗口**：透明无框置顶、左键拖动移动、右键旋转视角、右键菜单。

## 运行

```bash
npm install
npm start
```

依赖：Electron 31、`ws`（事件流 WebSocket 客户端）。建议 Node ≥ 18。

## 操作说明

| 操作 | 效果 |
| --- | --- |
| 左键拖动 | 移动窗口 |
| 左键单击 | 派活输入 + 互动泡泡 |
| 右键单击 | 菜单 |
| 右键拖动 | 旋转视角 |

## 与 dsh harness 的连接

桌宠通过 `WHALE_PET_URL`（默认 `http://127.0.0.1:3080`）连接 dsh web：

- 事件流通过 WebSocket `/api/events.mux` 与 `/api/events.host` 订阅。
- 派活通过 `POST /api/session.prompt`。

未连接 harness 时，换肤 / 播放器 / 互动等本地功能仍可正常使用，仅派活会提示「未连接」。

## 目录结构

```
whale-pet/
├── main.js            # Electron 主进程：窗口 / 拖动 / 右键菜单 / gateway 客户端 / 面板窗口
├── preload.js         # contextBridge：拖动、gateway、皮肤、播放器桥
├── package.json
└── renderer/
    ├── pet.html       # 主窗口：Three.js 鲸鱼 + 互动 + 情绪/跳舞动画
    ├── player.html    # 音乐播放器窗口
    ├── color.html     # 自定义配色窗口
    ├── help.html      # 内置帮助文档
    └── vendor/        # three.min.js + OrbitControls.js
```

## 注意事项

- Windows 显示缩放（125% / 150%）下拖动窗口存在 DIP↔物理像素取整漂移的历史 bug，主进程已用 `getBounds() + setBounds()` 锁定窗口尺寸修复。
- 事件流协议已从 SSE 迁移到 WebSocket；若 dsh 版本较旧仍走 SSE，需相应调整 `main.js` 的 `openWS`。
- 首次运行若 electron 包装文件（`cli.js`/`index.js`/`path.txt`）缺失，重新执行 `npm install` 即可。