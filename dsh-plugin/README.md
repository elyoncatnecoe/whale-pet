# 🐋 3D小虎鲸 · DSH 插件

把 [whale-pet](../) 虎鲸桌宠接入 **DeepSeek Harness**：在侧边栏一键启动/关闭桌宠，随时查看 API 余额。

![插件入口](https://img.shields.io/badge/DSH-plugin-blue)

> ⚠️ **注意区分同名插件**
>
> npm 上另有一个 **`dsh-plugin-whale-pet`**（作者 [Yifffan](https://github.com/Yifffan/dsh-plugin-whale-pet)），是**网页版**小鲸鱼，与本项目**无关**。
>
> 本插件（含仓库根包和 `dsh-plugin/` 子包）的包名统一是 **`3d-whale-pet`**。在插件栏搜索时认准这个名字；装成对方那个的话，桌宠不会启动（它没有 `pet/` 目录）。

## 标识符一览

全部统一成同一个名字，是有原因的：DSH 的 client-modules 用「最近的 package manifest 名」当浏览器模块 id，并在这个 id 上等客户端 bundle 注册——**包名和 `lib/client.js` 里的注册 id 对不上，侧边栏按钮就不激活**（报 `loaded without registering ...`）。

| 标识符 | 值 |
| --- | --- |
| 包名（仓库根 / `dsh-plugin` 子目录） | `3d-whale-pet` |
| Loader 条目 id（`cordis.patch.yml`） | `3d-whale-pet` |
| 客户端注册 id（`lib/client.js` 的 `__ModuleLoader__.load`） | `3d-whale-pet` |
| 侧边栏插槽 id | `3d-whale-pet` |
| RPC 路由 | `/3d-whale-pet/rpc` |

DSH 的 `sidebar.footer.action` 是**列表插槽**：用自己独有的 id 会**新增**一个入口，复用别人已占用的 id 才会**替换**那一个。所以别的宠物插件只要用它们自己的 id，多个宠物就能并列共存。

> 旧版本用过 `3d-whale-pet-desktop` / `dsh-plugin-whale-pet-desktop` / `whale-pet` 这些名字和 id。安装脚本会把它们作为历史遗留清理掉；如果你手改过 profile，见下面「升级 / 迁移」。

## 它做什么

装好之后，DSH 侧边栏底部会多出一个 **「🐋 3D小虎鲸」** 按钮，点开是一个小面板：

| 功能 | 说明 |
| --- | --- |
| **启动 / 关闭** | 一键拉起或收掉桌面上的虎鲸（Electron 进程由插件托管，随插件卸载自动清理） |
| **查余额** | 显示 DeepSeek 账户余额，低于 ¥1 会提醒充值 |
| **状态** | 🟢 运行中 / ⚪ 未启动 / 🔧 依赖未装 / ⏳ 安装依赖中 |
| **当前 DSH 地址** | 面板底部直接显示 `http://127.0.0.1:<本次端口>`，排障不用自己查端口 |

桌宠本身的能力（换皮肤、跳舞、播放器、派活、音效）全部保留，详见 [主 README](../README.md)。

## 安装（只有一种方式：填仓库地址）

在 DSH 的**插件栏**里直接填仓库地址，不用任何子目录语法：

```
https://github.com/elyoncatnecoe/whale-pet
```

或者用命令行：

```bash
dsh plugin --profile desktop add "github:elyoncatnecoe/whale-pet"
```

装完**完全退出 DSH（托盘图标也要退干净）再重启**，侧边栏底部就有 **🐋 3D小虎鲸**。
点「启动」时若提示依赖缺失，面板上会显示「**安装依赖**」按钮，点一下自动装好（约 180MB 的 electron）。

> **pnpm 会拦截 git 依赖的构建脚本**（安全策略），首次 `add` 可能报
> `ERR_PNPM_IGNORED_BUILDS`，并把该包写进 `~/.dsh/profiles/desktop/pnpm-workspace.yaml`
> 的 `allowBuilds` 里，留一句 `set this to true or false`。把它改成 `true` 再重跑一次即可
> （`postinstall` 才会执行、顺手装好 electron）。
> 不改也能用：面板检测到缺依赖时会显示「安装依赖」按钮。

## ⚠️ 只挂一次：不要手写挂载行

这是 issue [#2](https://github.com/elyoncatnecoe/whale-pet/issues/2) 里第一个问题的根因，请务必看完：

- 本包自带 `dsh.bundle.patch`（`cordis.patch.yml`），由 profile 的 `dsh.profile.bundles` **自动挂载**。
- profile 的 `package.json` 里同时出现 `dependencies`（pnpm 链接用）和 `dsh.profile.bundles`（加载层用）是**官方正常状态**，不是重复——`dsh plugin add` 本来就这么写。
- 真正会出事的是**第三条**：再往 profile 的 `cordis.patch.yml` 里手写一条 `- id: 3d-whale-pet`。那样同一个插件被挂载两次，浏览器把 client bundle 执行两遍，DSH 会直接抛：

  ```
  client-modules: duplicate factory registration for "3d-whale-pet"
  (bundle executed twice without invalidate?)
  ```

  整个客户端半边（侧边栏按钮）就都不激活了。
- 本插件对此加了一层**幂等护栏**：client bundle 第二次执行会安全跳过、不再抛错。但正确做法仍然**只挂一次**。

如果你之前手抄过挂载行，运行一次安装器即可自动清理：

```bash
node dsh-plugin/scripts/install.mjs
```

## 升级 / 迁移（旧版包名 → 3d-whale-pet）

包名统一后，历史遗留会被安装器自动清掉：

- 依赖里的 `3d-whale-pet-desktop` / `dsh-plugin-whale-pet-desktop` / `whale-pet` → 只保留 `3d-whale-pet`
- profile `cordis.patch.yml` 里指向本插件的所有挂载行（含空 `insert:` 残块）→ 摘除
- `dsh.profile.bundles` → 确保含 `3d-whale-pet`

```bash
node dsh-plugin/scripts/install.mjs   # 在仓库里执行
```

然后重启 DSH。

## 手动安装（可选，且不要叠第三种写法）

不想用脚本时，等价操作只有两步：

**1. 用 DSH 自己的命令把包加进 profile**（它同时写 `dependencies` 和 `dsh.profile.bundles`）

```bash
dsh plugin --profile desktop add "github:elyoncatnecoe/whale-pet"
```

**2. 装好桌宠本体的依赖**

```bash
cd <插件包目录>/pet && npm install
# 用仓库根安装时：cd ~/.dsh/profiles/desktop/node_modules/3d-whale-pet/dsh-plugin/pet
```

**不要**再往 profile 的 `cordis.patch.yml` 加挂载行——`dsh.bundle.patch` 已经负责挂载。

## 卸载

```bash
dsh plugin --profile desktop remove 3d-whale-pet
```

顺手可清掉的运行时文件：`~/.dsh/cache/whale-pet-dsh-url.json`、`%TEMP%\whale-pet-electron.log`。

## 工作原理

插件分 Host / Client 两个半边（DSH 的标准插件形态）：

| 半边 | 文件 | 职责 |
| --- | --- | --- |
| **Host** | `lib/index.js` | 管理桌宠 Electron 进程（spawn/kill）、调用 DeepSeek 余额接口、在 DSH 的 web 服务器上注册私有路由 `/3d-whale-pet/rpc` |
| **Client** | `lib/client.js` | 通过 `ctx.slots` 把面板注册到 `sidebar.footer.action` 插槽，用 `fetch` 调用 Host 路由 |

**安全**：`/3d-whale-pet/rpc` 复用 DSH 自己的信任围栏与浏览器鉴权（`ctx.connection.requestRejection`），非本机或未登录的请求一律 401/403，不会暴露给外部。

**桌宠目录解析顺序**：`WHALE_PET_DIR` 环境变量 → 插件自带 `pet/` → 仓库根目录。所以你也可以把它指向任意一份 whale-pet 源码。

## 端口自动发现（桌宠怎么找到 DSH）

DSH 桌面版**每次启动的监听端口都是随机的**（`0.2.1-rc.2` 实测是 60236 / 57274 / 63142 / 56618…），所以「写死 19387」必然连不上。桌宠按这个顺序找地址：

1. **`WHALE_PET_URL`**：Host 半边 spawn 桌宠时，用 `webServer.getOrigin()` 取到**本次真实地址**直接塞进环境变量——最可靠，所以请优先从侧边栏启动。
2. **发现文件**：Host 会把地址写进 `$DSH_HOME/cache/whale-pet-dsh-url.json`（另有 `%TEMP%` 一份兼容副本），手动 `npm start` 时桌宠读它。
3. **默认端口探测**：`19387` / `3080` 兜底（旧版或固定端口场景）。

每次重连都会重新解析，所以 **DSH 重启换了端口，桌宠会自己跟回来**，不需要重开桌宠。面板底部也会显示当前地址。

## 常见问题

**Q：侧边栏没出现按钮？**
A：插件在 DSH 启动时加载，必须**完全重启** DSH（托盘图标也要退干净）。另外：
- 浏览器控制台里若出现 `duplicate factory registration`，说明被挂载了两次 → 跑一次 `install.mjs` 清理手写的挂载行；
- 若出现 `could not load "…": loaded without registering`，说明包名与注册 id 不一致 → 确认装的是本仓库最新版（统一名为 `3d-whale-pet`）。

**Q：怎么确认插件真的加载了？**
A：`dsh --profile desktop --dump-config`，输出里应能看到 `id: 3d-whale-pet` 以及 `# == 3d-whale-pet，patched by cordis.patch.yml` 这类注释。

**Q：点「启动」提示找不到桌宠目录？**
A：设置环境变量指向你的 whale-pet 目录：`$env:WHALE_PET_DIR="F:\你的路径\whale-pet"`，然后重启 DSH。

**Q：点「启动」提示依赖未安装？**
A：点面板上的「安装依赖」，或在 `pet/` 目录执行 `npm install`。

**Q：点「启动」后桌宠立刻消失 / 提示退出码 `0xC0000005`、`0x80000003`？**
A：**先把桌宠目录放到本地磁盘**。放在网络盘、虚拟盘或某些挂载卷（例如 `P:\`）上时，任何 Electron 二进制都会一启动就崩（连 `electron.exe --version` 都崩，stderr 一个字都没有），与本插件无关。
- 报错信息里会带这一提示（插件会把 electron 的 stderr 写到 `%TEMP%\whale-pet-electron.log`）；
- 其他原因（依赖不全、安全软件拦截）也看这个日志。

**Q：派活提示「未连接到 harness」？**
A：说明桌宠还没找到 DSH。以**面板底部的 DSH 地址**为准：
- 优先从侧边栏启动（地址会自动传进去）；
- 手动 `npm start` 时确认 `$DSH_HOME/cache/whale-pet-dsh-url.json` 存在且 `url` 与面板一致；
- 也可以显式覆盖：`$env:WHALE_PET_URL="http://127.0.0.1:<端口>"`。

**Q：在虎鲸里派活，消息跑到了别的窗口？**
A：这是**已知限制**。harness 没有「哪个窗口正在被查看」的服务端信号，桌宠只能用「最近有消息的会话」近似。刚开的空白窗口先发一句话（哪怕只发个「喵」），之后虎鲸就会跟着它走。想改见 [主 README](../README.md) 的「已知限制」。

**Q：查余额失败？**
A：需要 `~/.dsh/.credentials.yaml` 里有 `DEEPSEEK_API_KEY`。在 DSH 的「设置 → 模型」里配好 API Key 即可。

**Q：改了插件源码后不生效？**
A：profile 里是**拷贝**而非软链，改完要重新同步：

```bash
cd ~/.dsh/profiles/desktop
rm -rf node_modules/3d-whale-pet node_modules/.pnpm
pnpm install
```

## 已验证

| 验证项 | 状态 |
| --- | --- |
| Host 半边加载与导出（`apply` / `inject` / `name`） | ✅ |
| 私有路由注册与调用（status / start / stop / balance / 未知方法 404） | ✅ |
| 余额查询（读 `~/.dsh/.credentials.yaml` → DeepSeek 官方接口） | ✅ |
| 桌宠进程 spawn / kill 与状态上报 | ✅ |
| Client bundle 结构（`__ModuleLoader__.load` + factory + exports）与官方 bundle 逐项一致 | ✅ |
| 客户端注册 id == 包名（`3d-whale-pet`），且重复执行不会抛重复注册 | ✅（本地用模拟 loader 跑两遍验证） |
| Client 半边在模拟加载器中注册到 `sidebar.footer.action` 插槽 | ✅ |
| bundle patch 的 `insert.name` 相对基准（相对 patch 文件自身） | ✅（对照 `0.2.1-rc.2` 的 `anchorInsertedPluginNames`） |
| 地址发现：解析器 → 探活 → 签名 Cookie → WebSocket → `session.list` 全链路 | ✅（对真实 `0.2.1-rc.2` 实例跑通） |
| `install.mjs` 的遗留清理（旧包名 / 旧挂载行 / 空 `insert:` 残块） | ✅（临时 profile 干跑验证） |

> 上述真实实例验证在独立 profile / 端口上完成，不影响你的桌面端。

## 许可

MIT。虎鲸形象为 DeepSeek 品牌标识，本项目为非官方个人作品，详见 [../LICENSE](../LICENSE)。