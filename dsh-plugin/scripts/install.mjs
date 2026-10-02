#!/usr/bin/env node
// 虎鲸桌宠 · DSH 插件安装器
// 把本插件挂进 DSH 的 desktop profile，并安装桌宠自身依赖。
//
// 用法：node dsh-plugin/scripts/install.mjs
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = resolve(HERE, '..')
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const PROFILE = join(DSH_HOME, 'profiles', 'desktop')
const PET = join(PLUGIN, 'pet')
const ENTRY_ID = 'whale-pet'
const PKG_NAME = 'dsh-plugin-whale-pet'

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
const spec = 'file:' + PLUGIN.replaceAll('\\', '/')
if (pkg.dependencies[PKG_NAME] === spec) {
  log('✅ profile 依赖已存在，跳过')
} else {
  pkg.dependencies[PKG_NAME] = spec
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  log(`✅ 已写入 profile 依赖：${PKG_NAME} → ${spec}`)
}

// 5. 在 cordis.patch.yml 里加挂载记录
// 注意：新增一行必须用 `- insert:` 包裹；裸 `- id:` 只会去「覆盖」已有行，
// 对不存在的 id 会报 patch: entry "..." not found。
const patchPath = join(PROFILE, 'cordis.patch.yml')
let patch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
if (patch.includes(`id: ${ENTRY_ID}`)) {
  log('✅ 挂载记录已存在，跳过')
} else {
  if (patch.trim() === '' || patch.trim() === '[]') patch = ''
  if (patch !== '' && !patch.endsWith('\n')) patch += '\n'
  patch += `\n- insert:\n    - id: ${ENTRY_ID}\n      name: "${PKG_NAME}"\n`
  writeFileSync(patchPath, patch, 'utf8')
  log('✅ 已添加插件挂载记录（insert 语法）')
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