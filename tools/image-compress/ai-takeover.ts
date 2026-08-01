/**
 * AI 浏览器接管提示词 —— 生成一段可粘贴给 Tabbit 类 AI 浏览器的指令，
 * 让 AI 根据用户的用途描述，自动设置好本页（图片压缩转换）的压缩参数。
 *
 * 设计前提：AI 浏览器读「无障碍树」操作页面。本工具为此提供两条互补途径：
 *   1. 全局脚本 API（推荐，最准）：window.__IMG_COMPRESS__.applyPreset(...)
 *   2. 逐控件 ARIA 操作（备选）：点 aria-label 标注的按钮 / 调滑块 / 选下拉框
 * 提示词同时描述两条途径，AI 自选其一。
 *
 * 重要：图片数据全程在用户浏览器本地处理，AI 只负责"设参数"，无需读取或上传图片。
 */

import type { OutputFormat } from './types';

/** 当前参数快照（注入提示词，让 AI 知道设置前的状态） */
export interface CurrentParams {
  format: OutputFormat;
  quality: number;
  maxLongEdge: number;
  icoSizes: number[];
}

/** 把格式 id 转成显示名，用于 ARIA 备选描述 */
function formatName(format: OutputFormat): string {
  switch (format) {
    case 'webp':
      return 'WebP';
    case 'jpeg':
      return 'JPG';
    case 'png':
      return 'PNG';
    case 'ico':
      return 'ICO';
    default:
      return String(format);
  }
}

/**
 * 组装 AI 接管提示词。
 * @param description 用户的用途描述（自由文本）
 * @param params      设置前的当前参数快照
 * @param pagePath    本页地址（location.href）
 */
export function buildTakeoverPrompt(
  description: string,
  params: CurrentParams,
  pagePath: string,
): string {
  const desc = description.trim() || '（用户未填写具体描述，请按通用压缩处理）';

  return `你是一个 AI 浏览器助手（如 Tabbit）。请根据用户的用途描述，帮 ta 把「图片压缩转换」页面的压缩参数设置好。

【用户的用途描述】
${desc}

【目标页面】
${pagePath}
（如果你已经在这个页面，则无需跳转；如果不在，请先打开该地址。）

【可用的操作途径（两种，优先用第 1 种，最准确）】
途径 1 —— 直接执行脚本（推荐）：
  在该页面的控制台 / 开发者工具里执行：
    window.__IMG_COMPRESS__.applyPreset(format, quality, maxLongEdge)
  例如设置为"WebP 格式、画质 80、最长边 ≤1080"：
    window.__IMG_COMPRESS__.applyPreset('webp', 80, 1080)
  执行后调用下面这个函数校验参数已生效：
    window.__IMG_COMPRESS__.getParams()

  format 取值：'webp' | 'jpeg' | 'png' | 'ico'
  quality：1-100 的整数（仅对 webp/jpeg 有效；png/ico 无损会忽略此项）
  maxLongEdge：最长边像素上限，0 表示不缩放（保持原尺寸）

途径 2 —— 逐个控件操作（备选，当无法执行脚本时用，读页面无障碍树）：
  - 点击 aria-label 为「输出格式：XXX」的按钮（XXX = WebP / JPG / PNG / ICO）
  - 把 aria-label 为「压缩强度」的滑块拖到目标数值
  - 把 aria-label 为「最长边缩放上限」的下拉框选为对应项（如「≤ 1080px」）

【你的任务】
1. 根据上面的用途描述，判断最适合的 format / quality / maxLongEdge 三项参数。
   参考要点：
   - JPG：兼容性最广，但无透明通道，适合照片类。
   - WebP：体积最小，现代平台通吃，推荐首选。
   - PNG：无损、保留透明，适合图标/带透明的图。
   - ICO：多尺寸图标，仅用于网站 favicon。
   - quality 越低体积越小但画质越低；需要看清细节（商品图/教程）就调高，纯分享可调低。
   - maxLongEdge 按发布场景定：手机端社交 720-1080 足够，电商详情/大图可到 1440，需要原图保真填 0。
2. 用途径 1 或途径 2 把参数设置好。
3. 设置完成后，简要告诉用户你选择了什么参数、为什么这么选。

【设置前的当前参数】
format=${params.format}, quality=${params.quality}, maxLongEdge=${params.maxLongEdge}, icoSizes=[${params.icoSizes.join(',')}]

【重要边界】
- 图片全程在用户浏览器本地处理，不会上传。你只是帮 ta 调整"压缩参数"，不需要、也不应当读取或传输图片本身。
- 如果页面尚未上传图片，设好参数即可，用户之后会自行上传图。`;
}

/** 格式显示名导出（供 main.ts 在 ARIA label 复用，避免重复定义） */
export { formatName as displayFormatName };
