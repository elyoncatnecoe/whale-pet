#!/usr/bin/env node
// 虎鲸桌宠 · DSH 插件安装器
// 把本插件挂进 DSH 的 desktop profile，并安装桌宠自身依赖。
//
// 用法：node dsh-plugin/scripts/install.mjs
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = resolve(HERE, '..')
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const PROFILE = join(DSH_HOME, 'profiles', 'desktop')
const PET = join(PLUGIN, 'pet')
// 包名必须与 dsh-plugin/package.json 的 name 一致。
// 注意：npm 上另有一个同用途但不同项目的 dsh-plugin-whale-pet（网页版），
// 我们刻意带了 -desktop 后缀以避免装错。
const PKG_NAME = 'dsh-plugin-whale-pet-desktop'
// Loader 条目 id：带 -desktop 后缀，与其他宠物插件互不占用。
const ENTRY_ID = 'whale-pet-desktop'
// 历史遗留：早期版本用过旧名/旧 id，升级时要把残留清掉
const LEGACY_IDS = ['whale-pet']
const LEGACY_NAMES = ['dsh-plugin-whale-pet']

function log(msg) { console.log(msg) }
function fail(msg) { console.error('❌ ' + msg); process.exit(1) }

// 1. 检查 DSH profile 是否存在
if (!existsSync(PROFILE)) {
  fail(`找不到 DSH desktop profile：${PROFILE}\n   请先启动一次 DeepSeek Harness 桌面端。`)
}
log(`✅ 找到 DSH profile：${PROFILE}`)

// 2. 先确保桌宠本体已打包
if (!existsSync(join(PET, 'main.js'))) {
  log('📦 桌宠本体未打包，正在打包…')
  execFileSync(process.execPath, [join(HERE, 'bundle-pet.mjs')], { stdio: 'inherit' })
}
log('✅ 桌宠本体已就位')

// 3. 安装桌宠自身依赖（electron + ws）
log('📥 安装桌宠依赖（electron，约 100MB，首次较慢）…')
try {
  execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: PET, stdio: 'inherit', shell: true })
} catch {
  fail('桌宠依赖安装失败，请手动在 dsh-plugin/pet 目录执行 npm install')
}
log('✅ 桌宠依赖安装完成')

// 4. 把插件写进 profile 的 dependencies
const pkgPath = join(PROFILE, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.dependencies = pkg.dependencies ?? {}

// 4a. 清掉同名/旧名的冲突依赖。
// 典型情况：用户在插件栏搜 "whale-pet" 时，pnpm 按包名解析，装到了另一个
// 同名项目（dsh-plugin-whale-pet，网页版小鲸鱼），导致我们的桌宠压根没被挂载。
let cleaned = []
for (const name of LEGACY_NAMES) {
  if (name === PKG_NAME) continue
  if (pkg.dependencies[name] !== undefined) {
    delete pkg.dependencies[name]
    cleaned.push(name)
  }
}
if (cleaned.length > 0) {
  log(`🧹 已移除冲突依赖：${cleaned.join('、')}`)
  // 顺手删掉它的安装产物，避免 pnpm 继续解析到旧包
  try {
    rmSync(join(PROFILE, 'node_modules', cleaned[0]), { recursive: true, force: true })
  } catch { /* 不存在就算了 */ }
}

const spec = 'file:' + PLUGIN.replaceAll('\\', '/')
if (pkg.dependencies[PKG_NAME] === spec) {
  log('✅ profile 依赖已存在，跳过')
} else {
  pkg.dependencies[PKG_NAME] = spec
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  log(`✅ 已写入 profile 依赖：${PKG_NAME} → ${spec}`)
}
if (cleaned.length > 0) {
  // 有清理动作时也要落盘
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
}

// 5. 在 cordis.patch.yml 里加挂载记录
// 注意：新增一行必须用 `- insert:` 包裹；裸 `- id:` 只会去「覆盖」已有行，
// 对不存在的 id 会报 patch: entry "..." not found。
const patchPath = join(PROFILE, 'cordis.patch.yml')
let patch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''

// 5a. 先摘掉早期版本用过的旧 id 条目（例如裸 `whale-pet`），
//     否则升级后 profile 里会同时挂着新旧两行，导致重复挂载。
let removedLegacy = 0
for (const oldId of LEGACY_IDS) {
  if (oldId === ENTRY_ID) continue
  const block = new RegExp(`\\n?\\s*-\\s*id:\\s*${oldId}\\s*\\r?\\n\\s*name:\\s*["'][^"']+["']`, 'g')
  const next = patch.replace(block, '')
  if (next !== patch) { patch = next; removedLegacy++ }
}
if (removedLegacy > 0) {
  writeFileSync(patchPath, patch, 'utf8')
  log(`🧹 已移除 ${removedLegacy} 条旧挂载记录`)
}

if (patch.includes(`id: ${ENTRY_ID}`)) {
  // id 已存在：可能是老版本留下的、name 还是旧包名，得改过来，
  // 否则 DSH 会照着旧名字去解析模块，装不到我们这份。
  const stale = new RegExp(`(id:\\s*${ENTRY_ID}\\s*\\r?\\n\\s*name:\\s*["'])[^"']+(["'])`)
  if (stale.test(patch)) {
    const before = patch
    patch = patch.replace(stale, `$1${PKG_NAME}$2`)
    if (patch !== before) {
      writeFileSync(patchPath, patch, 'utf8')
      log(`✅ 挂载记录已更新为：${ENTRY_ID} → ${PKG_NAME}`)
    } else {
      log('✅ 挂载记录已存在且正确，跳过')
    }
  } else {
    log('✅ 挂载记录已存在，跳过')
  }
} else {
  if (patch.trim() === '' || patch.trim() === '[]') patch = ''
  if (patch !== '' && !patch.endsWith('\n')) patch += '\n'
  patch += `\n- insert:\n    - id: ${ENTRY_ID}\n      name: "${PKG_NAME}"\n`
  writeFileSync(patchPath, patch, 'utf8')
  log(`✅ 已添加插件挂载记录：${ENTRY_ID}（insert 语法）`)
}

// 6. pnpm install 把插件链接进 profile
log('🔗 链接插件到 profile…')
try {
  execFileSync('pnpm', ['install', '--reporter=append-only'], { cwd: PROFILE, stdio: 'inherit', shell: true })
} catch {
  fail('pnpm install 失败，请确认已安装 pnpm（npm i -g pnpm）')
}

log('')
log('🎉 安装完成！')
log('')
log('下一步：')
log('  1. 完全退出 DeepSeek Harness（含托盘图标）')
log('  2. 重新启动 DeepSeek Harness')
log('  3. 侧边栏底部会出现「🐋 虎鲸桌宠」按钮，点它 → 启动')
log('')