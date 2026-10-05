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
const PKG_NAME = '3d-whale-pet-desktop'
// Loader 条目 id：带 -desktop 后缀，与其他宠物插件互不占用。
const ENTRY_ID = '3d-whale-pet-desktop'
// 历史遗留：早期版本用过旧名/旧 id，升级时要把残留清掉
const LEGACY_IDS = ['whale-pet', 'whale-pet-desktop']
const LEGACY_NAMES = ['dsh-plugin-whale-pet', 'dsh-plugin-whale-pet-desktop']

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
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
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

// 5. 在 cordis.patch.yml 里加挂载记录
//
// 重要前提：本插件现在自带 dsh.bundle.patch（见 dsh-plugin/cordis.patch.yml），
// 由 profile 的 dsh.profile.bundles 自动挂载，**根本不需要在用户 patch 里手写条目**。
// 历史上我们写过，那些残留记录会指向旧包名，导致：
//   dsh: warning: 1 entry did not activate ... failed to import
// 所以这里以「清理」为主：把本插件的所有历史遗留条目摘干净。
//
// 若清理后 patch 为空，需要补一个合法的空数组（YAML 不允许空文件当 patch）。
const patchPath = join(PROFILE, 'cordis.patch.yml')
let patch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''

const beforeClean = patch
// 5a. 摘掉任何指向本插件的 id 条目（含旧 id 与当前 id），
//     无论 name 写的是新包名、旧包名还是不存在的包名。
const ourIds = new Set([ENTRY_ID, ...LEGACY_IDS])
const blockRe = /^[ \t]*-[ \t]*id:[ \t]*([A-Za-z0-9._-]+)[ \t]*\r?\n(?:[ \t]+[^\r\n]*\r?\n?)*/gm
patch = patch.replace(blockRe, (match, id) => (ourIds.has(id) ? '' : match))

// 5b. 摘掉空的 insert 块（只有 `- insert:` 没有任何子项）。
//     这类残块是我们早期清理留下的，YAML 合法但毫无意义。
patch = patch.replace(/^[ \t]*-[ \t]*insert:[ \t]*\r?\n(?=[ \t]*\r?\n|[ \t]*-[ \t]*(?:id|insert):|$)/gm, '')

if (patch !== beforeClean) {
  // 清完可能只剩空白：补一个空数组，否则 DSH 会报
  // 「must be a top-level YAML array of loader patch entries」
  if (patch.trim() === '') patch = '[]\n'
  writeFileSync(patchPath, patch, 'utf8')
  log('🧹 已移除本插件的历史挂载记录（现由 dsh.bundle.patch 自动挂载）')
} else {
  log('✅ 用户 patch 中无本插件残留记录')
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