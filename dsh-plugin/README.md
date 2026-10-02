# 🐋 虎鲸桌宠 · DSH 插件

把 [whale-pet](../) 虎鲸桌宠接入 **DeepSeek Harness**：在侧边栏一键启动/关闭桌宠，并随时查看 API 余额。

![插件入口](https://img.shields.io/badge/DSH-plugin-blue)

## 它做什么

装好之后，DSH 侧边栏底部会多出一个 **「🐋 虎鲸桌宠」** 按钮，点开是一个小面板：

| 功能 | 说明 |
| --- | --- |
| **启动 / 关闭** | 一键拉起或收掉桌面上的虎鲸（Electron 进程由插件托管，随插件卸载自动清理） |
| **查余额** | 显示 DeepSeek 账户余额，低于 ¥1 会提醒充值 |
| **状态** | 实时显示桌宠运行状态（🟢 运行中 / ⚪ 未启动） |

桌宠本身的能力（换皮肤、跳舞、播放器、派活、音效）全部保留，详见 [主 README](../README.md)。

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
    "dsh-plugin-whale-pet": "file:<本仓库的绝对路径>/dsh-plugin"
  }
}
```

**2. 在 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾追加**

```yaml
- id: whale-pet
  name: "dsh-plugin-whale-pet"
```

**3. 链接并安装依赖**

```bash
cd ~/.dsh/profiles/desktop && pnpm install
cd <本仓库>/dsh-plugin/pet && npm install
```

## 卸载

```bash
# 1. 从 profile 的 cordis.patch.yml 删掉 whale-pet 那段
# 2. 从 profile 的 package.json 删掉 dsh-plugin-whale-pet 依赖
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

**Q：点「启动」提示找不到桌宠目录？**
A：设置环境变量指向你的 whale-pet 目录：`$env:WHALE_PET_DIR="F:\你的路径\whale-pet"`，然后重启 DSH。

**Q：点「启动」提示依赖未安装？**
A：在 `dsh-plugin/pet` 目录执行 `npm install`。

**Q：查余额失败？**
A：需要 `~/.dsh/.credentials.yaml` 里有 `DEEPSEEK_API_KEY`。在 DSH 的「设置 → 模型」里配好 API Key 即可。

## 许可

MIT。虎鲸形象为 DeepSeek 品牌标识，本项目为非官方个人作品，详见 [../LICENSE](../LICENSE)。