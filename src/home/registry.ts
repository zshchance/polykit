import type { RegisteredTool, ToolConfig } from '@/core/types';
import { registryConfig } from './registry-config';

/**
 * 模块注册管线 —— 通过 Vite 的 import.meta.glob 自动发现所有工具。
 *
 * 三组 glob：
 *   1. tool.config.ts  → 模块元数据（slug/name/description/...）
 *   2. assets/icon.*   → 图标资源 URL（可选）
 *   3. assets/cover.*  → 首图资源 URL（可选）
 *
 * 新建一个含 tool.config.ts 的目录即自动出现在首页，无需改任何注册表。
 *
 * eager: true 让数据在首屏立即可用（首页渲染依赖它）。
 * 注意：这里 glob 的根是项目根（vite root），路径用绝对式 /tools/...。
 */

// 1) 元数据
const configModules = import.meta.glob<{ default: ToolConfig }>('/tools/*/tool.config.ts', {
  eager: true,
});

// 2) 图标：匹配 tools/<slug>/assets/icon.<ext>，按 URL 引入
const iconModules = import.meta.glob<string>('/tools/*/assets/icon.*', {
  eager: true,
  query: '?url',
  import: 'default',
});

// 3) 首图：匹配 tools/<slug>/assets/cover.<ext>
const coverModules = import.meta.glob<string>('/tools/*/assets/cover.*', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** 从 glob 路径 /tools/<slug>/... 提取 slug */
function slugFromPath(path: string): string {
  // 形如 /tools/password-generator/tool.config.ts
  const seg = path.split('/');
  return seg[2] ?? '';
}

/**
 * 解析所有已注册工具：合并元数据 + 资源 URL + 应用策展（启用/排序）。
 * 输出按 order 升序、再按 name 排序的稳定序列。
 */
export function getRegisteredTools(): RegisteredTool[] {
  const tools: RegisteredTool[] = [];

  for (const [path, mod] of Object.entries(configModules)) {
    const cfg = mod.default;
    const slug = cfg.slug || slugFromPath(path);

    // 一致性校验：tool.config.ts 里的 slug 必须与目录名一致
    if (slugFromPath(path) && slug !== slugFromPath(path)) {
      console.warn(
        `[registry] tool.config.ts 中 slug="${slug}" 与目录名 "${slugFromPath(path)}" 不一致，已以目录名为准`,
      );
    }

    // 中央策展：enabled（默认 true）
    const override = registryConfig.modules[slug];
    if (override?.enabled === false) continue;

    // 匹配该模块的图标 / 首图 URL
    const iconUrl = pickAsset(iconModules, slug);
    const coverUrl = pickAsset(coverModules, slug);

    tools.push({
      ...cfg,
      slug,
      iconUrl,
      coverUrl,
      order: override?.order ?? 100,
    });
  }

  // 排序：order 升序在前，相同 order 时按名称排，保证顺序稳定
  tools.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-Hans-CN'));
  return tools;
}

/** 在 glob 结果里找出属于指定 slug 的资源 URL */
function pickAsset(
  glob: Record<string, string>,
  slug: string,
): string | undefined {
  for (const [path, url] of Object.entries(glob)) {
    if (slugFromPath(path) === slug) return url;
  }
  return undefined;
}

/** 首页用：所有分类，按出现顺序去重 */
export function getCategories(tools: RegisteredTool[]): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const t of tools) {
    if (!seen.has(t.category)) {
      seen.add(t.category);
      list.push(t.category);
    }
  }
  return list;
}
