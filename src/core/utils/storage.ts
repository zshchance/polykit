/**
 * localStorage JSON 读写共享层。
 *
 * 全站的 settings/history/favorites 模块此前各自复制同一套骨架：
 * getItem + JSON.parse + typeof 校验 + try/catch 回退；save 侧 setItem + catch 静默。
 * 这里把「读出对象或 null」「安全写入」收敛为两个函数，
 * 各模块只需保留自己特有的字段校验与默认值逻辑。
 *
 * 约定：存入的 blob 应带 version 字段，便于将来迁移。
 */

/**
 * 读取并解析 key 下的 JSON 对象。
 * 任何失败（未存储 / JSON 非法 / 不是对象 / 存储被禁用）都返回 null，
 * 调用方用默认值兜底。注意：数组也是 object，需要排除数组的调用方自行判断。
 */
export function readJSON(key: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 读取并解析 key 下的 JSON 数组；失败返回 null（调用方用默认值兜底） */
export function readJSONArray(key: string): unknown[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 安全写入 JSON（带 version 的 blob 用对象字面量传入即可）。
 * 隐私模式 / 配额满 / 存储被禁用时静默失败，返回 false；成功返回 true。
 */
export function writeJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // 容量满 / 隐私模式禁用 localStorage：静默忽略，不影响功能
    return false;
  }
}

/** 删除一个 key（不存在时无操作；存储不可用时静默） */
export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 存储不可用：忽略
  }
}
