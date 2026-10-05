# 🐋 虎鲸桌宠 · DSH 插件

把 [whale-pet](../) 虎鲸桌宠接入 **DeepSeek Harness**：在侧边栏一键启动/关闭桌宠，并随时查看 API 余额。

![插件入口](https://img.shields.io/badge/DSH-plugin-blue)

> ⚠️ **注意区分同名插件**
>
> npm 上另有一个 **`dsh-plugin-whale-pet`**（作者 [Yifffan](https://github.com/Yifffan/dsh-plugin-whale-pet)），是**网页版**小鲸鱼，与本项目**无关**。
>
> 本插件的包名是 **`dsh-plugin-whale-pet-desktop`**（带 `-desktop` 后缀）。
> 安装时请认准这个全名 —— 在插件栏只搜「whale-pet」有可能会装到对方那个，那样桌宠不会启动（它没有 `pet/` 目录）。

## 与其他宠物插件共存

本插件的所有标识符都带 `-desktop` 后缀，刻意避开了通用名字：

| 标识符 | 值 |
| --- | --- |
| 包名 | `dsh-plugin-whale-pet-desktop` |
| 侧边栏插槽 id | `whale-pet-desktop` |
| RPC 路由 | `/whale-pet-desktop/rpc` |
| Loader 条目 id | `whale-pet-desktop` |

DSH 的 `sidebar.footer.action` 是**列表插槽**，规则是：

- 用自己的独有 id → **新增**一个入口（不碰别人）
- 复用别人已占用的 id → **替换**掉那一个

所以只要别的宠物插件也用它们自己的独有 id，**多个宠物就能在侧边栏并列共存**，不会互相顶掉。做新宠物插件时照抄这张表的命名方式即可。

## 它做什么

装好之后，DSH 侧边栏底部会多出一个 **「🐋 虎鲸桌宠」** 按钮，点开是一个小面板：

| 功能 | 说明 |
| --- | --- |
| **启动 / 关闭** | 一键拉起或收掉桌面上的虎鲸（Electron 进程由插件托管，随插件卸载自动清理） |
| **查余额** | 显示 DeepSeek 账户余额，低于 ¥1 会提醒充值 |
| **状态** | 实时显示桌宠运行状态（🟢 运行中 / ⚪ 未启动） |

桌宠本身的能力（换皮肤、跳舞、播放器、派活、音效）全部保留，详见 [主 README](../README.md)。

## 已验证的部分

本插件在开发机上做过以下实测（非推测）：

| 验证项 | 状态 |
| --- | --- |
| Host 半边加载与导出（`apply` / `inject` / `name`） | ✅ |
| 私有路由注册与调用（status / start / stop / balance / 未知方法 404） | ✅ |
| 余额查询（读 `~/.dsh/.credentials.yaml` → DeepSeek 官方接口） | ✅ |
| 桌宠进程 spawn / kill 与状态上报 | ✅ |
| `install.mjs` 写入 profile 依赖与 `cordis.patch.yml` 挂载记录 | ✅ |
| `pnpm install` 把插件链接进 profile，DSH 可解析 | ✅ |
| Client bundle 结构（`__ModuleLoader__.load` + factory + exports）与官方 bundle 逐项一致 | ✅ |
| Client 半边在模拟加载器中注册到 `sidebar.footer.action` 插槽 | ✅ |
| 目标插槽在真实 DSH 中存在，注册参数与插槽 catalog 匹配 | ✅ |
| **在真实 DSH 实例中启动**：插件行进入组合后的 profile 树（`--dump-config` 可见） | ✅ |
| **在真实 DSH 实例中**：Host 路由受信任围栏保护（无 cookie → 401，跨站 → 403） | ✅ |
| **在真实 DSH 实例中**：Client bundle 被打进预加载清单并被正确服务（响应体内含插件 id 与插槽名） | ✅ |
| **在真实 DSH 实例中**：`start` 能真正拉起桌宠，`status` 报告 running，`stop` 干净退出 | ✅ |
| **在真实 DSH 实例中**：`balance` 返回账户余额 | ✅ |

> 上述「真实 DSH 实例」验证是在独立 profile + 独立端口上完成的（不影响你的桌面端），测完已删除该 profile。

### 从 GitHub 直接安装（实测通过）

完整走了一遍「用户从零安装」的路径：

| 步骤 | 结果 |
| --- | --- |
| `dsh plugin add github:elyoncatnecoe/whale-pet#path:dsh-plugin` | ✅ |
| 插件包自包含（`dsh.bundle` / `cordis.patch.yml` / `pet/` 全在包内） | ✅ |
| `postinstall` 自动装好桌宠的 electron 依赖 | ✅ |
| profile 的 `dsh.profile.bundles` 自动追加该插件 | ✅ |
| `--dump-config` 显示解析后的 `id: whale-pet-desktop` | ✅ |
| 启动后 `status.ready = true`，`start` 拉起桌宠，`stop` 干净退出 | ✅ |
| `balance` 返回账户余额 | ✅ |

> ⚠️ **pnpm 会拦截 git 依赖的构建脚本**（安全策略），首次安装会报
> `ERR_PNPM_IGNORED_BUILDS`。DSH 会把该包写进 profile 的 `pnpm-workspace.yaml`
> 的 `allowBuilds` 里并留一句 `set this to true or false` —— **把它改成 `true`
> 再重跑一次命令即可**，`postinstall` 就会执行并装好 electron。
> 不改也能用：插件面板在检测到缺依赖时会显示「安装依赖」按钮，点一下就补装。


## 安装（三步）

### 前置条件

- 已安装 **DeepSeek Harness 桌面端**（并至少启动过一次）
- 已安装 **Node.js ≥ 18** 与 **pnpm**（`npm i -g pnpm`）
- 已安装 **Git**

### 步骤

```bash
# 1. 克隆本仓库
git clone https://github.com/elyoncatnecoe/whale-pet.git
cd whale-pet

# 2. 运行安装器（会自动打包桌宠、装依赖、挂载插件）
node dsh-plugin/scripts/install.mjs
```

```text
# 3. 完全退出 DeepSeek Harness（注意托盘图标也要退），重新启动
```

重启后，侧边栏底部就有 **🐋 虎鲸桌宠** 按钮了。

## 手动安装

不想用脚本的话，三步等价操作：

**1. 把插件加入 profile 依赖**

编辑 `~/.dsh/profiles/desktop/package.json`：

```json
{
  "dependencies": {
    "dsh-plugin-whale-pet-desktop": "file:<本仓库的绝对路径>/dsh-plugin"
  }
}
```

**2. 在 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾追加**

```yaml
- id: whale-pet
  name: "dsh-plugin-whale-pet-desktop"
```

**3. 链接并安装依赖**

```bash
cd ~/.dsh/profiles/desktop && pnpm install
cd <本仓库>/dsh-plugin/pet && npm install
```

## 卸载

```bash
# 1. 从 profile 的 cordis.patch.yml 删掉 whale-pet 那段
# 2. 从 profile 的 package.json 删掉 dsh-plugin-whale-pet-desktop 依赖
cd ~/.dsh/profiles/desktop && pnpm install
```

## 工作原理

插件分 Host / Client 两个半边（DSH 的标准插件形态）：

| 半边 | 文件 | 职责 |
| --- | --- | --- |
| **Host** | `lib/index.js` | 管理桌宠 Electron 进程（spawn/kill）、调用 DeepSeek 余额接口、在 DSH 的 web 服务器上注册私有路由 `/whale-pet/rpc` |
| **Client** | `lib/client.js` | 通过 `ctx.slots` 把面板注册到 `sidebar.footer.action` 插槽，用 `fetch` 调用 Host 路由 |

**安全**：`/whale-pet/rpc` 复用了 DSH 自己的信任围栏与浏览器鉴权（`ctx.connection.requestRejection`），非本机或未登录的请求一律 401/403，不会暴露给外部。

**桌宠目录解析顺序**：`WHALE_PET_DIR` 环境变量 → 插件自带 `pet/` → 仓库根目录。所以你也可以把它指向任意一份 whale-pet 源码。

## 常见问题

**Q：侧边栏没出现按钮？**
A：插件是在 DSH 启动时加载的，必须**完全重启** DSH（托盘图标也要退干净）。另外确认 `pnpm install` 没报错。

**Q：怎么确认插件真的加载了？**
A：可以在 DSH 里对 Agent 说「用 cordis_inspect_list 看看 whale-pet」，或检查 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾是否有 `- id: whale-pet` 条目。

**Q：在虎鲸里派活，消息跑到了别的窗口？**
A：这是**已知限制**。harness 没有「哪个窗口正在被查看」的服务端信号，桌宠只能用「最近有消息的会话」近似。所以你**刚开一个还没发过消息的空白窗口**就用虎鲸派活时，它会落到上一个窗口。

- **规避**：先在该窗口发一句话（哪怕只发个「喵」），之后虎鲸就会跟着它走。
- **想改**：见 [主 README 的「已知限制」](../README.md#️-已知限制新开的空白窗口) 一节，`main.js` 的 `pickCurrentSession()` 里去掉 `!it.blank` 过滤即可，按自己习惯调。

**Q：点「启动」提示找不到桌宠目录？**
A：设置环境变量指向你的 whale-pet 目录：`$env:WHALE_PET_DIR="F:\你的路径\whale-pet"`，然后重启 DSH。

**Q：点「启动」提示依赖未安装？**
A：在 `dsh-plugin/pet` 目录执行 `npm install`。

**Q：查余额失败？**
A：需要 `~/.dsh/.credentials.yaml` 里有 `DEEPSEEK_API_KEY`。在 DSH 的「设置 → 模型」里配好 API Key 即可。

**Q：点「启动」提示「桌宠启动后立即退出」？**
A：说明 electron 进程拉起后马上退了。最常见原因是 `pet/` 目录下依赖不全——在 `dsh-plugin/pet` 里执行 `npm install` 再试。插件已自动剥离 `ELECTRON_RUN_AS_NODE`（该变量会让 electron 退化成纯 Node 而拿不到 `ipcMain`），所以不必手动处理。

**Q：改了插件源码后不生效？**
A：profile 里的是**拷贝**而非软链，改完源码需要重新同步：

```bash
cd ~/.dsh/profiles/desktop
rm -rf node_modules/dsh-plugin-whale-pet-desktop node_modules/.pnpm
pnpm install
```

## 许可

MIT。虎鲸形象为 DeepSeek 品牌标识，本项目为非官方个人作品，详见 [../LICENSE](../LICENSE)。