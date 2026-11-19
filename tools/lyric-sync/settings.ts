/** 歌词打轴工具的选项与草稿持久化。 */

import { readJSON, removeKey, writeJSON } from '@/core/utils/storage';

import type { LyricDocument, LyricLine } from './lyrics';

export interface ToolOptions {
  precise: boolean;
  loop: boolean;
}

export interface TimeSelection {
  start: number;
  end: number;
}

export interface LyricDraft {
  document: LyricDocument;
  selectedId: string | null;
  selection: TimeSelection | null;
  audioName: string | null;
  savedAt: number;
}

export const DEFAULT_OPTIONS: Readonly<ToolOptions> = Object.freeze({
  precise: false,
  loop: false,
});

const OPTIONS_KEY = 'lyric-sync:options';
const DRAFT_KEY = 'lyric-sync:draft';
const CURRENT_VERSION = 1;

const MAX_LINES = 5_000;
const MAX_TOTAL_TEXT_LENGTH = 200_000;
const MAX_NAME_LENGTH = 512;
const MAX_METADATA_ENTRIES = 100;
const MAX_METADATA_KEY_LENGTH = 128;
const MAX_METADATA_VALUE_LENGTH = 4_096;
const MAX_METADATA_TOTAL_LENGTH = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isValidName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_NAME_LENGTH;
}

function parseMetadata(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;

  const entries = Object.entries(value);
  if (entries.length > MAX_METADATA_ENTRIES) return null;

  let totalLength = 0;
  const parsed: Array<[string, string]> = [];
  for (const [key, item] of entries) {
    if (
      key.length > MAX_METADATA_KEY_LENGTH ||
      typeof item !== 'string' ||
      item.length > MAX_METADATA_VALUE_LENGTH
    ) {
      return null;
    }
    totalLength += key.length + item.length;
    if (totalLength > MAX_METADATA_TOTAL_LENGTH) return null;
    parsed.push([key, item]);
  }

  return Object.fromEntries(parsed);
}

function parseDraft(value: unknown): LyricDraft | null {
  if (!isRecord(value) || !isRecord(value.document)) return null;

  const document = value.document;
  const format = document.format;
  if (format !== 'lrc' && format !== 'srt') return null;
  if (!isValidName(document.fileName)) return null;

  const metadata = parseMetadata(document.metadata);
  if (!metadata || !Array.isArray(document.lines) || document.lines.length > MAX_LINES) {
    return null;
  }

  const lines: LyricLine[] = [];
  const ids = new Set<string>();
  let totalTextLength = 0;

  for (const line of document.lines) {
    if (!isRecord(line)) return null;

    const id = line.id;
    const start = line.start;
    const end = line.end;
    const text = line.text;
    if (
      typeof id !== 'string' ||
      id.trim().length === 0 ||
      ids.has(id) ||
      !isFiniteNonNegative(start) ||
      !isFiniteNonNegative(end) ||
      end <= start ||
      typeof text !== 'string'
    ) {
      return null;
    }

    totalTextLength += text.length;
    if (totalTextLength > MAX_TOTAL_TEXT_LENGTH) return null;

    ids.add(id);
    lines.push({ id, start, end, text });
  }

  const selectedId = value.selectedId;
  if (selectedId !== null && typeof selectedId !== 'string') return null;
  if (typeof selectedId === 'string' && !ids.has(selectedId)) return null;

  let selection: TimeSelection | null = null;
  if (value.selection !== null) {
    if (!isRecord(value.selection)) return null;
    const start = value.selection.start;
    const end = value.selection.end;
    if (!isFiniteNonNegative(start) || !isFiniteNonNegative(end) || end <= start) return null;
    selection = { start, end };
  }

  const audioName = value.audioName;
  if (audioName !== null && !isValidName(audioName)) return null;

  const savedAt = value.savedAt;
  if (!isFiniteNonNegative(savedAt)) return null;

  const parsedDocument: LyricDocument = {
    format,
    fileName: document.fileName,
    metadata,
    lines,
  };

  return {
    document: parsedDocument,
    selectedId,
    selection,
    audioName,
    savedAt,
  };
}

export function loadOptions(): ToolOptions {
  const blob = readJSON(OPTIONS_KEY);
  if (!blob || blob.version !== CURRENT_VERSION || !isRecord(blob.options)) {
    return { ...DEFAULT_OPTIONS };
  }

  return {
    precise: typeof blob.options.precise === 'boolean' ? blob.options.precise : false,
    loop: typeof blob.options.loop === 'boolean' ? blob.options.loop : false,
  };
}

export function saveOptions(options: ToolOptions): boolean {
  return writeJSON(OPTIONS_KEY, {
    version: CURRENT_VERSION,
    options: { precise: options.precise, loop: options.loop },
  });
}

/** 严格解析完整草稿 blob；任何核心字段非法都返回 null。 */
export function parseDraftBlob(raw: unknown): LyricDraft | null {
  if (!isRecord(raw) || raw.version !== CURRENT_VERSION) return null;
  return parseDraft(raw.draft);
}

export function loadDraft(): LyricDraft | null {
  return parseDraftBlob(readJSON(DRAFT_KEY));
}

/** 校验并深拷贝后保存，调用方之后修改原对象不会影响已保存内容。 */
export function saveDraft(draft: LyricDraft): boolean {
  const copy = parseDraft(draft);
  if (!copy) return false;
  return writeJSON(DRAFT_KEY, { version: CURRENT_VERSION, draft: copy });
}

export function clearDraft(): void {
  removeKey(DRAFT_KEY);
}
