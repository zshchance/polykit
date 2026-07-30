/**
 * 密码学安全的随机工具。
 * 用 crypto.getRandomValues 而非 Math.random——
 * 密码、令牌等场景对可预测性敏感，Math.random 不具备密码学安全性。
 */

/** 返回 [min, max] 闭区间内均匀分布的随机整数，避免模偏置 */
export function secureRandomInt(min: number, max: number): number {
  if (min > max) throw new Error('min 不能大于 max');
  const range = max - min + 1;
  // 拒绝采样消除模偏置：丢弃落在不均匀余数区间的取值
  const maxUsable = Math.floor(0xffffffff / range) * range;
  const buf = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= maxUsable);
  return min + (n % range);
}

/** 从数组中随机选一个元素 */
export function securePick<T>(arr: readonly T[]): T {
  if (arr.length === 0) throw new Error('数组不能为空');
  return arr[secureRandomInt(0, arr.length - 1)]!;
}

/** 打乱数组（返回新数组，不修改原数组）——Fisher-Yates */
export function secureShuffle<T>(arr: readonly T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = secureRandomInt(0, i);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
