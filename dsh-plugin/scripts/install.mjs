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
import { cleanPatchText } from './cleanup-profile.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = resolve(HERE, '..')
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const PROFILE = join(DSH_HOME, 'profiles', 'desktop')
const PET = join(PLUGIN, 'pet')
// 包名必须与 dsh-plugin/package.json 的 name 一致，也与仓库根包名一致。
// 三者统一成 3d-whale-pet 是刻意的：DSH 的 client-modules 用「最近的 package
// manifest 名」当浏览器模块 id，并在这个 id 上等客户端 bundle 注册；包名与
// client.js 里的注册 id 一旦对不上，侧边栏按钮就不激活
// （报 "loaded without registering ..."）。npm 上另有一个同用途但不同项目的
// dsh-plugin-whale-pet（网页版），我们的包名与它不同，不会装错。
const PKG_NAME = '3d-whale-pet'
// Loader 条目 id：与包名相同，便于用户对照 ——dump-config 的输出。
const ENTRY_ID = '3d-whale-pet'
// 历史遗留：早期版本用过旧名/旧 id，升级时要把残留清掉
const LEGACY_IDS = ['whale-pet', 'whale-pet-desktop', '3d-whale-pet-desktop', 'dsh-plugin-whale-pet-desktop']
const LEGACY_NAMES = ['dsh-plugin-whale-pet', 'dsh-plugin-whale-pet-desktop', '3d-whale-pet-desktop']

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

// 4. 整理 profile 依赖
//
// 本插件自带 dsh.bundle.patch，DSH 会依据 profile 的
// dsh.profile.bundles 自动挂载，所以 profile 里只需要一条依赖。
// 这一步做的是「去重与修正」：留下唯一正确的来源，删掉所有历史写法。
const pkgPath = join(PROFILE, 'package.json')
/** 读 JSON 并容忍 BOM（用记事本改过 package.json 的用户会遇到，JSON.parse 直接炸）。 */
function readJson(path) {
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/u, '')
  try {
    return JSON.parse(text)
  } catch (err) {
    fail(`${path} 不是合法 JSON：${err.message}\n   手动修好后再运行本脚本。`)
  }
}
const pkg = readJson(pkgPath)
pkg.dependencies = pkg.dependencies ?? {}

const localSpec = 'file:' + PLUGIN.replaceAll('\\', '/')
// 优先保留用户已有的 github 来源（那是最新的安装方式），
// 否则用本地路径（本地开发者场景）。
const existingGithub = Object.entries(pkg.dependencies)
  .find(([name, spec]) => spec.includes('whale-pet') && /^(github:|git\+)/.test(spec))
const finalSpec = existingGithub ? existingGithub[1] : localSpec

// 删掉所有指向本插件的冗余依赖，只留一个。
const staleNames = [PKG_NAME, ...LEGACY_NAMES, 'whale-pet']
const removed = []
for (const name of staleNames) {
  const spec = pkg.dependencies[name]
  if (spec === undefined) continue
  // 保留那一条「最终采用」的
  if (spec === finalSpec && (name === 'whale-pet' || name === PKG_NAME)) continue
  delete pkg.dependencies[name]
  removed.push(`${name}@${spec}`)
  try { rmSync(join(PROFILE, 'node_modules', name), { recursive: true, force: true }) } catch { /* 不存在 */ }
}

// 确保最终那条存在（用 github 来源时包名是 whale-pet，本地路径时是 PKG_NAME）
const finalName = existingGithub ? existingGithub[0] : PKG_NAME
if (pkg.dependencies[finalName] !== finalSpec) {
  pkg.dependencies[finalName] = finalSpec
}
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
if (removed.length > 0) log(`🧹 已移除冗余依赖：${removed.join('、')}`)
log(`✅ profile 依赖：${finalName} → ${finalSpec}`)

// 确保 bundles 里含该插件（DSH 通常会自动加，这里兜底）
pkg.dsh = pkg.dsh ?? {}
pkg.dsh.profile = pkg.dsh.profile ?? {}
const bundles = pkg.dsh.profile.bundles ?? []
if (!bundles.includes(finalName)) {
  bundles.push(finalName)
  pkg.dsh.profile.bundles = bundles
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  log(`✅ 已把 ${finalName} 加入 profile bundles`)
}

// 5. 清理 cordis.patch.yml 里指向本插件的历史挂载行
//
// 重要前提：本插件自带 dsh.bundle.patch（见 dsh-plugin/cordis.patch.yml），
// 由 profile 的 dsh.profile.bundles 自动挂载，**根本不需要在用户 patch 里手写条目**。
// 历史上我们写过，那些残留行会让插件被挂载两次（issue #2 的第一个问题）。
// 清理逻辑在 scripts/cleanup-profile.mjs 里，postinstall 也会 best-effort 调一次，
// 这样「用 dsh plugin add 升级」的老用户也能自动清干净。
//
// 注意只摘「带 name: 的行」：只有 id + config 的行是用户对本插件行的配置覆盖，要留着。
const patchPath = join(PROFILE, 'cordis.patch.yml')
if (existsSync(patchPath)) {
  const before = readFileSync(patchPath, 'utf8')
  const cleaned = cleanPatchText(before, [ENTRY_ID, ...LEGACY_IDS])
  if (cleaned.changed) {
    writeFileSync(patchPath, cleaned.text, 'utf8')
    log(`🧹 已移除本插件的历史挂载记录 ${cleaned.removed.length} 条（现由 dsh.bundle.patch 自动挂载）`)
  } else {
    log('✅ 用户 patch 中无本插件残留记录')
  }
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
log('  3. 侧边栏底部会出现「🐋 3D小虎鲸」按钮，点它 → 启动')
log('')