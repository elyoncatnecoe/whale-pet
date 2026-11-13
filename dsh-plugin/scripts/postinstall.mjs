// 插件安装后的收尾：把桌宠本体（pet/）的依赖装好。
//
// 为什么需要这一步：
//   * 插件从 git/npm 装下来时只带源码，不带 pet/node_modules
//   * 桌宠本体要跑必须有 electron（约 180MB），不能塞进仓库
//   * 所以装完插件后在这里补一次 npm install
//
// 该脚本必须「永不失败」——postinstall 抛错会让整个插件安装回滚，
// 那样用户连插件都装不上。失败时只打印提示，等用户点「启动」再由
// Host 半边给出可操作的错误信息。
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { cleanupProfilePatches } from './cleanup-profile.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PET = join(HERE, '..', 'pet')

function log(m) { console.log(`[whale-pet] ${m}`) }

// 第一步：清理 profile 里指向本插件的历史挂载行。
//
// 老版本（0.1.x）的安装脚本教用户往 profile 的 cordis.patch.yml 手写挂载行，
// 而本插件现在自带 dsh.bundle.patch 自动挂载 → 两条 → 同一个 client bundle
// 执行两遍 → DSH 报 duplicate factory registration，整条侧边栏入口失效
// （issue #2 的第一个问题）。用 `dsh plugin add` 升级的老用户不会主动跑
// install.mjs，所以在这里 best-effort 清一次。
// 绝不让它影响安装：任何异常都只打印，不抛出。
try {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const res = cleanupProfilePatches({ home, log })
  if (res.removed.length > 0) log(`已清理 ${res.removed.length} 条本插件的历史挂载行`)
} catch (err) {
  log('⚠️ 清理 profile 历史挂载行失败（已忽略）：' + (err && err.message ? err.message : String(err)))
}

const exe = process.platform === 'win32' ? 'electron.exe' : 'electron'
const installed = join(PET, 'node_modules', 'electron', 'dist', exe)

if (existsSync(installed)) {
  log('桌宠依赖已就绪，跳过')
  process.exit(0)
}

if (!existsSync(join(PET, 'package.json'))) {
  log('未找到 pet/package.json，跳过（可能是不含桌宠本体的安装方式）')
  process.exit(0)
}

log('正在安装桌宠依赖（含 electron，约 180MB，首次较慢）…')
try {
  execFileSync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: PET,
    stdio: 'inherit',
    shell: true,
  })
  log('桌宠依赖安装完成')
} catch (err) {
  log('⚠️ 桌宠依赖自动安装失败：' + (err && err.message ? err.message : String(err)))
  log(`   请手动执行：cd "${PET}" && npm install`)
  log('   否则点击「启动」时会提示依赖缺失。')
}
process.exit(0)
