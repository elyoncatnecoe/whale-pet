// 把桌宠本体（main.js / preload.js / gateway.js / renderer/ / package.json）复制进插件 pet/ 目录，
// 让插件成为一个自包含的分发单元。
// 用法：node dsh-plugin/scripts/bundle-pet.mjs
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = resolve(HERE, '..')
const REPO = resolve(PLUGIN, '..')
const PET = join(PLUGIN, 'pet')

const FILES = ['main.js', 'preload.js', 'gateway.js']
const DIRS = ['renderer']

if (!existsSync(join(REPO, 'main.js'))) {
  console.error(`找不到桌宠源码目录（期望 ${REPO} 下有 main.js）`)
  process.exit(1)
}

rmSync(PET, { recursive: true, force: true })
mkdirSync(PET, { recursive: true })

for (const f of FILES) {
  const src = join(REPO, f)
  if (!existsSync(src)) { console.error(`缺少文件: ${f}`); process.exit(1) }
  cpSync(src, join(PET, f))
}
for (const d of DIRS) {
  const src = join(REPO, d)
  if (!existsSync(src)) { console.error(`缺少目录: ${d}`); process.exit(1) }
  cpSync(src, join(PET, d), { recursive: true })
}

// 生成一个最小 package.json，指向 electron 依赖（安装时由用户 npm install）。
const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
writeFileSync(join(PET, 'package.json'), JSON.stringify({
  name: 'whale-pet-app',
  version: pkg.version ?? '0.1.0',
  private: true,
  main: 'main.js',
  dependencies: pkg.dependencies ?? {},
  devDependencies: { electron: pkg.devDependencies?.electron ?? '^31.7.7' },
}, null, 2) + '\n', 'utf8')

// pet/ 自身也要 ignore 依赖与锁文件：本目录是要入库的，
// 不能让 180MB 的 electron 或本地 lockfile 混进版本控制。
writeFileSync(join(PET, '.gitignore'), 'node_modules/\npackage-lock.json\n', 'utf8')

console.log(`✅ 桌宠已打包到 ${PET}`)
console.log('   下一步：cd dsh-plugin/pet && npm install')