/**
 * 首页个人偏好 —— 本地持久化（localStorage）。
 *
 * 记录用户对工具卡片的自定义状态：
 *   - pinned：置顶（强制排到最前，标准「置顶」语义）
 *   - starred：星标（收藏标记，配合「只看星标」筛选）
 *   - order：自定义顺序（拖拽排序落库，slug 数组）
 *
 * 与 registry/registry-config 的关系：registry 是构建期策展（order 权重 / enabled），
 * 这里是用户运行期偏好。排序时用户偏好优先，registry 作为兜底（见 sort.ts）。
 *
 * 存储 blob 带 version，便于将来迁移；损坏/隐私模式时安全回退为空偏好。
 * 备份/恢复仅包含本批偏好（置顶/星标/排序），不含主题等其它本地状态。
 */

import { toDateCompact } from '@/core/utils/date';

// key 命名遵循全站连字符风格（theme/holidays 等均如此）；从旧的冒号风格 key 迁移
const STORAGE_KEY = 'static-toolkit-home-prefs';
const LEGACY_STORAGE_KEY = 'static-toolkit:home-prefs';

/** 旧 key → 新 key 一次性迁移（读到旧值且新 key 为空时搬运，随后清掉旧 key） */
function migrateLegacyKey(): void {
  try {
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy !== null) {
      if (localStorage.getItem(STORAGE_KEY) === null) {
        localStorage.setItem(STORAGE_KEY, legacy);
      }
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  } catch {
    // 存储不可用：忽略，loadPrefs 自会安全回退
  }
}

/** 首页用户偏好 */
export interface HomePrefs {
  /** 置顶的 slug 集合（数组形式，顺序即置顶组内顺序） */
  pinned: string[];
  /** 星标的 slug 集合 */
  starred: string[];
  /** 自定义顺序：slug 数组；未列出的工具按 registry 兜底排在其后 */
  order: string[];
}

interface PrefsBlob {
  version: number;
  pinned: string[];
  starred: string[];
  order: string[];
}

const CURRENT_VERSION = 1;

/** 空偏好（默认值） */
export function emptyPrefs(): HomePrefs {
  return { pinned: [], starred: [], order: [] };
}

/** 校验并清洗单个字段，确保是字符串数组 */
function cleanStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** 读取偏好；存储损坏或为空时安全回退为空偏好 */
export function loadPrefs(): HomePrefs {
  migrateLegacyKey();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyPrefs();
    const parsed = JSON.parse(raw) as Partial<PrefsBlob>;
    if (!parsed) return emptyPrefs();
    return {
      pinned: cleanStrArr(parsed.pinned),
      starred: cleanStrArr(parsed.starred),
      order: cleanStrArr(parsed.order),
    };
  } catch {
    return emptyPrefs();
  }
}

/** 持久化偏好 */
export function savePrefs(p: HomePrefs): void {
  try {
    const blob: PrefsBlob = { version: CURRENT_VERSION, ...p };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // 容量满 / 隐私模式禁用 localStorage：静默忽略，不影响功能
  }
}

// ─────────────────────────── 查询 ───────────────────────────

export function isPinned(p: HomePrefs, slug: string): boolean {
  return p.pinned.includes(slug);
}

export function isStarred(p: HomePrefs, slug: string): boolean {
  return p.starred.includes(slug);
}

// ─────────────────────────── 变更（返回新对象，不可变风格） ───────────────────────────

/** 切换置顶：置顶时追加到置顶组末尾，取消置顶时从置顶组移除 */
export function togglePin(p: HomePrefs, slug: string): HomePrefs {
  const has = p.pinned.includes(slug);
  const pinned = has ? p.pinned.filter((s) => s !== slug) : [...p.pinned, slug];
  return { ...p, pinned };
}

/** 切换星标 */
export function toggleStar(p: HomePrefs, slug: string): HomePrefs {
  const has = p.starred.includes(slug);
  const starred = has ? p.starred.filter((s) => s !== slug) : [...p.starred, slug];
  return { ...p, starred };
}

/** 拖拽后落库自定义顺序。orderedSlugs 为当前可见列表的完整 slug 顺序 */
export function applyOrder(p: HomePrefs, orderedSlugs: string[]): HomePrefs {
  return { ...p, order: [...orderedSlugs] };
}

/** 重置全部偏好 */
export function resetPrefs(): HomePrefs {
  savePrefs(emptyPrefs());
  return emptyPrefs();
}

// ─────────────────────────── 备份 / 恢复 ───────────────────────────

/** 导出为 JSON 字符串（带版本号，便于跨设备迁移） */
export function exportPrefsJSON(p: HomePrefs): string {
  const blob: PrefsBlob = { version: CURRENT_VERSION, ...p };
  return JSON.stringify(blob, null, 2);
}

/** 默认导出文件名（带日期） */
export function prefsExportFilename(): string {
  const d = new Date();
  return `polykit-home-prefs-${toDateCompact(d)}.json`;
}

/**
 * 从 JSON 文本恢复偏好。
 * 校验 version 与字段合法性；任何异常或非法数据返回 null（调用方提示「文件无效」）。
 */
export function importPrefsJSON(text: string): HomePrefs | null {
  try {
    const parsed = JSON.parse(text) as Partial<PrefsBlob>;
    if (!parsed || parsed.version !== CURRENT_VERSION) return null;
    const prefs: HomePrefs = {
      pinned: cleanStrArr(parsed.pinned),
      starred: cleanStrArr(parsed.starred),
      order: cleanStrArr(parsed.order),
    };
    return prefs;
  } catch {
    return null;
  }
}
