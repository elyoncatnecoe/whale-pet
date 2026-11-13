// 清理 profile 里指向本插件的**历史挂载行**。
//
// 为什么需要它（issue #2 的问题 1）：
//   本插件自带 dsh.bundle.patch，由 profile 的 dsh.profile.bundles 自动挂载。
//   早期版本的安装脚本/文档还教用户往 profile 的 cordis.patch.yml 手写一条挂载行，
//   于是同一个插件被挂载两次 → 浏览器把 client bundle 执行两遍 →
//   DSH 报 client-modules: duplicate factory registration ...
//   更早期的包名（3d-whale-pet-desktop、dsh-plugin-whale-pet-desktop、whale-pet）
//   还会让同一个包从两条 Loader 来源解析，宿主直接拒绝组合：
//   package "..." resolves from multiple active Loader sources ...
//
// 这里只做「摘除挂载行 + 清掉空 insert 残块」两件事，并且**只摘带 name: 的行**：
//   - 带 name: 的行 = 挂载/重定向，指向本插件才有害
//   - 只有 id + config 的行 = 用户对本插件行的配置覆盖，必须保留
// 拿不准的写法一律原样保留（宁可少清，不可误删用户配置）。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 本插件历史上用过的 Loader 条目 id（含当前 id）。 */
export const OUR_IDS = [
  '3d-whale-pet',
  '3d-whale-pet-desktop',
  'dsh-plugin-whale-pet-desktop',
  'whale-pet',
  'whale-pet-desktop',
]

/** 把字符串转成可直接嵌进正则的字面量。 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/** 匹配「以本插件 id 开头的 YAML 块」：行首到 id，以及其后的缩进续行。 */
function rowPattern(ids) {
  const alts = ids.map(escapeRegExp).join('|')
  return new RegExp(
    `^([ \\t]*)-[ \\t]*id:[ \\t]*(${alts})[ \\t]*(?:\\r?\\n|$)((?:[ \\t]+[^\\r\\n]*(?:\\r?\\n|$))*)`,
    'gm',
  )
}

/**
 * 摘除挂载行：任何缩进层级（顶层行与 insert 子项都算）上「本插件 id + 带 name:」的条目。
 * @param {string} text - profile 的 cordis.patch.yml 内容
 * @param {string[]} [ids] - 视为本插件的 id 列表
 * @returns {{ text: string, removed: string[], changed: boolean }}
 */
export function stripOurMountRows(text, ids = OUR_IDS) {
  const removed = []
  const pattern = rowPattern(ids)
  const next = text.replace(pattern, (match, indent, id, body) => {
    // 只删「挂载行」。光有 id + config 的覆盖行要留给用户。
    if (!/^[ \t]+name[ \t]*:/mu.test(body)) return match
    removed.push(`${indent}- id: ${id}`)
    return ''
  })
  return { text: next, removed, changed: removed.length > 0 }
}

/**
 * 摘掉空的 `- insert:` 残块（YAML 合法但毫无意义；我们早期清理留下的）。
 * 既要处理「后面还有别的块」，也要处理「它是文件最后一行且没有换行」。
 * @param {string} text
 * @returns {string}
 */
export function stripEmptyInserts(text) {
  return text.replace(
    /^[ \t]*-[ \t]*insert:[ \t]*(?:\r?\n(?=[ \t]*\r?\n|^[ \t]*-[ \t]*\S|$)|$)/gmu,
    '',
  )
}

/**
 * 对一段 patch 文本做完整清理（挂载行 + 空 insert + 空文件兜底 + 行尾）。
 * @param {string} text - 原内容
 * @param {string[]} [ids]
 * @returns {{ text: string, removed: string[], changed: boolean }}
 */
export function cleanPatchText(text, ids = OUR_IDS) {
  const stripped = stripOurMountRows(text, ids)
  const withoutEmpty = stripEmptyInserts(stripped.text)
  let result = withoutEmpty
  if (result.trim() === '') {
    // DSH 要求 patch 文件是顶层 YAML 数组，不能是空文件
    result = '[]\n'
  } else if (!result.endsWith('\n')) {
    result += '\n'
  }
  return { text: result, removed: stripped.removed, changed: result !== text }
}

/**
 * 扫描 $DSH_HOME/profiles/* 下每个 profile 的 cordis.patch.yml 并清理。
 *
 * 逐行正则 + 只摘带 name: 的行，所以不会误删其它插件的条目。
 * @param {object} options
 * @param {string} options.home - DSH home（默认 $DSH_HOME 或 ~/.dsh）
 * @param {(line: string) => void} [options.log] - 进度输出
 * @param {boolean} [options.write] - false 时只报告不落盘（试运行）
 * @returns {{ scanned: number, changed: string[], removed: string[] }}
 */
export function cleanupProfilePatches({ home, log = () => {}, write = true }) {
  const profilesDir = join(home, 'profiles')
  const result = { scanned: 0, changed: [], removed: [] }
  let entries
  try {
    entries = readdirSync(profilesDir, { withFileTypes: true })
  } catch {
    return result // 没装过任何 profile：没什么可清的
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const file = join(profilesDir, entry.name, 'cordis.patch.yml')
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue // 这个 profile 没有自己的 patch 文件
    }
    result.scanned += 1
    const cleaned = cleanPatchText(text)
    if (!cleaned.changed) continue
    if (write) {
      try {
        writeFileSync(file, cleaned.text, 'utf8')
      } catch (err) {
        log(`⚠️ 无法写入 ${file}：${err && err.message ? err.message : String(err)}`)
        continue
      }
    }
    result.changed.push(entry.name)
    result.removed.push(...cleaned.removed)
    log(`🧹 ${entry.name}/cordis.patch.yml：已摘除 ${cleaned.removed.length} 条本插件的历史挂载行`)
  }
  return result
}