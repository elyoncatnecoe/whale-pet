# 3D小虎鲸（3d-whale-pet）

一只常驻桌面的透明置顶 3D 虎鲸：用 Three.js 程序化建模、Electron 承载，并作为 dsh harness 的第二客户端订阅事件流、派发任务、驱动情绪状态机。

> 个人非官方爱好者作品，与 DeepSeek 官方无关联。虎鲸形象为 DeepSeek 品牌标识，权利归其所有，详见 [LICENSE](./LICENSE)。

## 功能特性

- 🐋 **3D 虎鲸**：程序化建模（身体 / 尾鳍 / 背鳍 / 胸鳍 / 眼斑），温和游动动画，带情绪状态机（idle / working / needs-input / ready / blocked）。
- 🎨 **换肤**：5 套预设配色（深寻蓝 / 虎鲸黑 / 草莓粉 / 薄荷绿 / 土豪金）+ 自定义配色（取色器）。
- 🎵 **音乐播放器**：导入本地音频，Web Audio 频谱分析，虎鲸随节拍打点、转圈、冒音符。
- 🎚 **跳舞强度**：关闭 / 低 / 中 / 高 四档可调。
- 🐟 **互动**：投喂（小鱼游入）、爱心、睡眠（闭眼 + 💤）。
- 💰 **余额查询**：右键菜单一键查询 DeepSeek 账户余额，余额偏低自动提醒。
- 💬 **派活**：连接 dsh harness，输入任务并流式回显结果。
- 🖱️ **窗口**：透明无框置顶、左键拖动移动、右键旋转视角、右键菜单。

## 运行

```bash
npm install
npm start
```

依赖：Electron `^31.7.7`、`ws`（事件流 WebSocket 客户端）。建议 Node ≥ 18。

> ⚠️ **桌宠目录必须在本地磁盘**：放在网络盘、虚拟盘或部分挂载卷（例如 `P:\`）上时，Electron 一启动就会崩（退出码 `0xC0000005` / `0x80000003`，连 `--version` 都崩），这与本插件无关。把项目放到本地磁盘（如 `D:\whale-pet`）即可；插件检测到桌宠秒退时也会给出提示。

手动 `npm start` 时，桌宠会先读插件写下的发现文件 `$DSH_HOME/cache/whale-pet-dsh-url.json`（形如 `{"url":"http://127.0.0.1:52062","updatedAt":...}`，另有 `%TEMP%` 一份兼容副本），拿不到才探测默认端口。所以更省事的做法是从侧边栏启动。

## 作为 DSH 插件使用（推荐）

不想碰命令行？本仓库自带一个 **DSH 插件**（`dsh.bundle.patch` 随包分发）：装好后在 DeepSeek Harness 侧边栏点一下就能启动桌宠，并直接查看余额。

安装只有一种方式——在 DSH 的插件栏直接填仓库地址（无需子目录语法）：

```
https://github.com/elyoncatnecoe/whale-pet
```

或者用命令行：

```bash
dsh plugin --profile desktop add "github:elyoncatnecoe/whale-pet"
```

装完**完全重启 DSH**（托盘图标也要退干净），侧边栏底部就会出现 **🐋 3D小虎鲸** 按钮。

> 💡 DSH 会同时写 profile 的 `dependencies`（pnpm 链接）和 `dsh.profile.bundles`（插件加载层）——**两条都写是正常的，不要试图只留一条**。插件自带 `dsh.bundle.patch`，由 bundles 自动挂载，所以**不要**再往 `cordis.patch.yml` 里手写挂载行。

详见 [dsh-plugin/README.md](./dsh-plugin/README.md)。

## 操作说明

| 操作 | 效果 |
| --- | --- |
| 左键拖动 | 移动窗口 |
| 左键单击 | 派活输入 + 互动泡泡 |
| 右键单击 | 菜单 |
| 右键拖动 | 旋转视角 |
| 菜单 → 查询余额 | 查询 DeepSeek 账户余额 |

## 与 dsh harness 的连接

DSH 桌面版**每次启动的端口都是随机的**，没有固定的 19387 / 3080。

- **自动传参**：从侧边栏启动桌宠时，插件会把当前 DSH 的真实地址通过环境变量 `WHALE_PET_URL` 传给桌宠进程。
- **自动发现**：手动 `npm start` 时，桌宠先读插件写下的发现文件 `$DSH_HOME/cache/whale-pet-dsh-url.json`（另有 `%TEMP%` 兼容副本），读不到才探测 `19387` / `3080`。
- **自动跟随**：桌宠每次重连都会重新解析地址，DSH 重启换了端口后它自己会跟回来，不用重开桌宠。
- **面板显示**：侧边栏面板里会显示当前 DSH 地址，排障时以它为准。

- **鉴权**：新版 dsh 需要浏览器会话鉴权。桌宠会自动读取 `$DSH_HOME/.credentials.yaml`（默认 `~/.dsh/.credentials.yaml`）里 `client-connection/browser-session` 的签名密钥，自行签发 `dsh-auth-<authority-hash>` Cookie，无需手动配置。
- **RPC**：`POST /api/<domain>/<method>`，payload 形如 `{ args: { <包装字段>: {...} } }`。注意这个**包装字段名随方法而异**（`session/list` 用 `_request`，`session/prompt` 用 `request`），`gateway.js` 会按候选名依次尝试；`prompt` 类方法还要求必填 `requestId`（自动补 UUID）。
- **事件流**：WebSocket `/api/remote.mux`，打开 `$events` 逻辑流。
- 桌宠是 harness 当前窗口的**遥控输入**：每次派活都自动选「最近有人发消息的会话」（即你正在用的那个窗口），所以虎鲸里发的消息会出现在 harness 当前打开的对应窗口里，并跟着你切换窗口走。回复既显示在虎鲸气泡里，也显示在对应窗口里。

> 兼容性：`gateway.js` 对旧版协议（`/api/session.list`、`/api/events.mux`、无鉴权）做了降级尝试，因此新旧 dsh 都能连。

### ⚠️ 已知限制：新开的空白窗口

harness **没有**「哪个窗口正在被查看」的服务端信号，桌宠只能用「最近有消息的会话」来近似「当前窗口」。因此：

> **刚开一个全新的窗口、还没在里面发过任何消息就用虎鲸派活 → 消息会落到上一个窗口。**

因为空白会话的 `blank: true`，选择逻辑会跳过它（当初这么设计是为了避免落进 DSH 自动创建的空壳会话）。

**规避方法**：先用虎鲸在目标窗口发一句话（哪怕只发个「喵」），该窗口就不再是 blank，之后虎鲸就会跟着它走。

**想改的话**，在 `main.js` 的 `pickCurrentSession()`：

```js
const live = items && items.filter((it) => !it.blank)   // ← 去掉 !it.blank 就会连空白窗口一起参与排序
```

更讲究的做法是区分「用户新开的窗口」和「DSH 自建的空壳会话」（后者多为无标题、`cwd` 为空），只排除后者。这块没有标准答案，按自己的使用习惯调即可。


未连接 harness 时，换肤 / 播放器 / 互动等本地功能仍可正常使用，仅派活会提示「未连接」。

### 可移植性

桌宠不依赖安装位置，解压到任意目录、`npm install && npm start` 即可运行：

- 所有资源用相对路径加载，窗口 / 面板 / vendor 脚本都随应用目录走。
- harness 地址通常由插件自动传递 / 发现，也可用 `WHALE_PET_URL` 显式覆盖；数据目录用 `DSH_HOME` 覆盖，适配不同主机 / 多套 dsh 数据目录。

### 连接自检

若派活提示「未连接到 harness」，按顺序检查：

1. DSH 是否在运行（任务管理器里应有 `DeepSeek Harness.exe`）。
2. 端口不用猜：DSH 桌面版每次启动端口随机，**以侧边栏面板里显示的当前 DSH 地址为准**。
3. 优先从侧边栏「启动」——插件会把真实地址通过 `WHALE_PET_URL` 直接传给桌宠。
4. 手动 `npm start` 时，检查发现文件 `$DSH_HOME/cache/whale-pet-dsh-url.json` 是否存在、里面的 `url` 是否与面板一致；也可以显式覆盖：`$env:WHALE_PET_URL="http://127.0.0.1:<port>"`。
5. 密钥文件是否存在且可读：`~/.dsh/.credentials.yaml`。
6. 看日志：插件会把 electron 的 stderr 写到 `%TEMP%\whale-pet-electron.log`，里面是实际报错。

## 余额查询

右键菜单 → **查询余额**，虎鲸会播报 DeepSeek 账户余额。

- 数据来源：[DeepSeek 官方 `GET /user/balance`](https://api-docs.deepseek.com/zh-cn/api/get-user-balance/)。
- API Key 自动从 `~/.dsh/.credentials.yaml` 的 `DEEPSEEK_API_KEY` 读取，无需额外配置。
- 显示总余额、赠金；余额低于 ¥1 时附加提醒，账户不可用时醒目告警。

## 目录结构

```
whale-pet/
├── main.js            # Electron 主进程：窗口 / 拖动 / 右键菜单 / 面板窗口
├── gateway.js         # dsh harness 客户端：鉴权 Cookie / RPC / WebSocket 事件流
├── preload.js         # contextBridge：拖动、gateway、皮肤、播放器桥
├── package.json
├── LICENSE            # MIT（含虎鲸形象品牌声明）
├── dsh-plugin/        # DSH 插件：在 Harness 侧边栏一键启停桌宠
│   ├── lib/index.js   #   Host 半边：进程管理 + 余额查询 + 私有 RPC 路由
│   ├── lib/client.js  #   Client 半边：侧边栏入口面板
│   └── scripts/       #   打包与安装脚本
└── renderer/
    ├── pet.html       # 主窗口：Three.js 鲸鱼 + 互动 + 情绪/跳舞动画
    ├── player.html    # 音乐播放器窗口
    ├── color.html     # 自定义配色窗口
    ├── help.html      # 内置帮助文档
    └── vendor/        # three.min.js + OrbitControls.js
```

## 常见问题

**Q：桌宠从侧边栏启动后立刻退出（或手动跑 electron 报 `0xC0000005` / `0x80000003`）？**

A：先确认项目放在**本地磁盘**上。网络盘、虚拟盘或部分挂载卷（例如 `P:\`）会让 Electron 在启动阶段就崩，连 `--version` 都跑不起来，与本项目无关；把项目移到本地磁盘即可。其他原因看 `%TEMP%\whale-pet-electron.log`。

**Q：派活提示「未连接到 harness」？**

A：DSH 桌面版端口每次启动随机，没有固定端口。从侧边栏启动时插件会自动把地址传给桌宠；手动 `npm start` 则依赖 `$DSH_HOME/cache/whale-pet-dsh-url.json`，或用 `WHALE_PET_URL` 显式指定。详见上面的「连接自检」。

**Q：侧边栏按钮不见了 / 控制台报 `duplicate factory registration for "3d-whale-pet"`？**

A：说明插件被挂载了两次——插件自带的 `dsh.bundle.patch` 已经自动挂载了一行，profile 的 `cordis.patch.yml` 里不能再手写挂载行（旧安装器/手动安装教程留下过这种残留）。跑一次 `node dsh-plugin/scripts/install.mjs` 会自动清理，然后完全重启 DSH。详见 [dsh-plugin/README.md](./dsh-plugin/README.md)。

**Q：包名怎么变了？**

A：`0.2.0` 起统一为 **`3d-whale-pet`**（仓库根包、`dsh-plugin` 子包、Loader 条目 id、客户端注册 id、插槽 id、RPC 路由全部同名）。旧名 `3d-whale-pet-desktop` / `dsh-plugin-whale-pet-desktop` 由安装器自动清理，重启即可，不需要手动卸。

## 注意事项

- Windows 显示缩放（125% / 150%）下拖动窗口存在 DIP↔物理像素取整漂移的历史 bug，主进程已用 `getBounds() + setBounds()` 锁定窗口尺寸修复。
- harness 事件流协议历经三代：SSE → `/api/events.mux` WebSocket → `/api/remote.mux` WebSocket（当前）。`gateway.js` 已适配当前版本并保留旧版降级路径。
- 首次运行若 electron 包装文件（`cli.js`/`index.js`/`path.txt`）缺失，重新执行 `npm install` 即可。

## 许可

源代码采用 **MIT** 许可，详见 [LICENSE](./LICENSE)：你可以自由地使用、修改、分发本项目，只需保留版权声明。

> ⚠️ **品牌声明**：虎鲸 / 鲸鱼形象是 **DeepSeek** 的品牌标识与商标，权利归 DeepSeek 所有，不在本项目的授权范围内。本项目是**个人非官方的爱好者作品**，与 DeepSeek 官方无关联、未获其背书。请勿暗示官方关系，也请勿将虎鲸形象用于商业或商标性用途。

第三方依赖保留其原有许可：`renderer/vendor/` 下的 Three.js 与 OrbitControls 版权归 Three.js Authors（MIT），Electron 与 `ws` 遵循各自的许可。

Copyright (c) 2026 elyoncatnecoe