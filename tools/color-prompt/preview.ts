import { h } from '@/core/components/element';
import type { Palette } from './data/palettes';
import { colorOf } from './data/palettes';

/**
 * 配色双预览：把选中的色系套进「网站首屏」与「幻灯片」两个真实界面，
 * 让用户直观看到配色在成品里的观感，而非只看孤立色块。
 *
 * 颜色全部以 inline style 注入（来自 palette），不依赖主题变量，
 * 这样预览永远反映色系本身（即使站点处于暗色模式）。
 *
 * 响应式：移动端单列堆叠，桌面两列并排。
 */

/** 网站/幻灯片预览所用的示例文案（占位，用于演示配色层次） */
const SAMPLE = {
  brand: 'Brand',
  navItems: ['产品', '方案', '价格', '关于'],
  heroTitle: '用更优雅的配色，打动你的受众',
  heroSub: '从精选色系到成品预览，几步生成可复用的配色规范。',
  ctaPrimary: '立即开始',
  ctaAccent: '查看示例',
  cardTitle: '特性卡片',
  cardBody: '展示配色在卡片、按钮、文字层级上的真实表现。',
  slideTitle: '关键结论',
  slidePoints: ['主色用于关键按钮与强调', '背景大面积留白突出内容', '点缀色克制使用于细节'],
  slidePage: '01 / 03',
};

/** 把 hex 转 rgb，便于派生半透明色（按钮悬停、边框等） */
function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const n = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const num = parseInt(n, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/** 半透明 rgba（alpha 0–1） */
function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * 网站首屏预览：顶部导航 + Hero + 三张特性卡片。
 * 外层用色系 bg，内层卡片用 surface，文字/按钮用各角色色。
 */
export function renderWebsitePreview(p: Palette): HTMLElement {
  const bg = colorOf(p, 'bg');
  const surface = colorOf(p, 'surface');
  const text = colorOf(p, 'text');
  const muted = colorOf(p, 'muted');
  const primary = colorOf(p, 'primary');
  const accent = colorOf(p, 'accent');

  const cardEl = (title: string, body: string) =>
    h('div', {
      class: 'rounded-lg p-3',
      style: `background:${surface};color:${text};border:1px solid ${alpha(text, 0.08)};`,
    }, [
      h('div', {
        class: 'mb-1.5 h-6 w-6 rounded',
        style: `background:${alpha(primary, 0.15)};`,
      }),
      h('div', { class: 'text-xs font-semibold', textContent: title }),
      h('div', { class: 'mt-0.5 text-[10px] leading-snug', style: `color:${muted};`, textContent: body }),
    ]);

  return h(
    'section',
    {
      class: 'flex h-full flex-col overflow-hidden rounded-xl',
      style: `background:${bg};color:${text};`,
      'aria-label': '网站首屏配色预览',
    },
    [
      // 导航条
      h('div', {
        class: 'flex items-center justify-between px-4 py-2.5',
        style: `border-bottom:1px solid ${alpha(text, 0.08)};`,
      }, [
        h('span', { class: 'text-sm font-bold', textContent: SAMPLE.brand }),
        h('div', { class: 'hidden gap-3 sm:flex' },
          SAMPLE.navItems.map((it) =>
            h('span', { class: 'text-[11px]', style: `color:${muted};`, textContent: it }),
          ),
        ),
        h('span', {
          class: 'rounded-md px-2.5 py-1 text-[11px] font-medium',
          style: `background:${primary};color:${'#ffffff'};`,
          textContent: '登录',
        }),
      ]),
      // Hero
      h('div', { class: 'px-4 py-5 text-center' }, [
        h('h3', { class: 'mx-auto max-w-md text-base font-bold leading-snug sm:text-lg', textContent: SAMPLE.heroTitle }),
        h('p', { class: 'mx-auto mt-1.5 max-w-sm text-[11px] leading-relaxed sm:text-xs', style: `color:${muted};`, textContent: SAMPLE.heroSub }),
        h('div', { class: 'mt-3 flex justify-center gap-2' }, [
          h('span', {
            class: 'rounded-md px-3 py-1.5 text-[11px] font-medium',
            style: `background:${primary};color:#ffffff;`,
            textContent: SAMPLE.ctaPrimary,
          }),
          h('span', {
            class: 'rounded-md px-3 py-1.5 text-[11px] font-medium',
            style: `background:${alpha(accent, 0.16)};color:${accent};border:1px solid ${alpha(accent, 0.4)};`,
            textContent: SAMPLE.ctaAccent,
          }),
        ]),
      ]),
      // 特性卡片
      h('div', { class: 'grid grid-cols-3 gap-2 px-4 pb-4' }, [
        cardEl(SAMPLE.cardTitle, SAMPLE.cardBody),
        cardEl(SAMPLE.cardTitle, SAMPLE.cardBody),
        cardEl(SAMPLE.cardTitle, SAMPLE.cardBody),
      ]),
    ],
  );
}

/**
 * 幻灯片预览：16:9 画板，左标题要点、右下角页码 + 点缀色块。
 */
export function renderSlidePreview(p: Palette): HTMLElement {
  const bg = colorOf(p, 'bg');
  const surface = colorOf(p, 'surface');
  const text = colorOf(p, 'text');
  const muted = colorOf(p, 'muted');
  const primary = colorOf(p, 'primary');
  const accent = colorOf(p, 'accent');

  return h(
    'section',
    {
      // 16:9 用 aspect-ratio；内层 absolute 布局
      class: 'relative aspect-[16/9] w-full overflow-hidden rounded-xl',
      style: `background:${bg};color:${text};`,
      'aria-label': '幻灯片配色预览',
    },
    [
      // 左上强调色装饰条
      h('div', {
        class: 'absolute left-6 top-6 h-10 w-1.5 rounded-full',
        style: `background:${primary};`,
      }),
      h('div', { class: 'absolute left-10 top-6 right-6' }, [
        h('h3', { class: 'text-base font-bold leading-tight sm:text-lg', textContent: SAMPLE.slideTitle }),
        h('ul', { class: 'mt-2 space-y-1.5' },
          SAMPLE.slidePoints.map((pt) =>
            h('li', { class: 'flex items-start gap-1.5 text-[11px] leading-snug sm:text-xs', style: `color:${muted};` }, [
              h('span', {
                class: 'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                style: `background:${accent};`,
              }),
              h('span', { textContent: pt }),
            ]),
          ),
        ),
      ]),
      // 右下：点缀色块 + 页码
      h('div', { class: 'absolute bottom-4 right-5 flex items-center gap-2' }, [
        h('span', {
          class: 'h-5 w-5 rounded',
          style: `background:${alpha(accent, 0.85)};`,
        }),
        h('span', {
          class: 'rounded px-1.5 py-0.5 text-[10px]',
          style: `background:${surface};color:${muted};border:1px solid ${alpha(text, 0.1)};`,
          textContent: SAMPLE.slidePage,
        }),
      ]),
    ],
  );
}

/** 预览区标题（小标签 + 说明） */
export function previewHeader(label: string): HTMLElement {
  return h('div', { class: 'mb-2 flex items-center gap-2' }, [
    h('span', {
      class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]',
      textContent: label,
    }),
  ]);
}
