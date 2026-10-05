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
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const PET = join(HERE, '..', 'pet')

function log(m) { console.log(`[whale-pet] ${m}`) }

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
