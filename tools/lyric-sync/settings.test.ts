import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearDraft,
  loadDraft,
  loadOptions,
  parseDraftBlob,
  saveDraft,
  saveOptions,
  type LyricDraft,
} from './settings';

const store = new Map<string, string>();
let failWrites = false;

function stubLocalStorage(): void {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error('storage unavailable');
      store.set(key, String(value));
    },
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
}

function validDraft(): LyricDraft {
  return {
    document: {
      format: 'lrc',
      fileName: 'song.lrc',
      metadata: { title: 'Song', artist: 'Artist' },
      lines: [
        { id: 'line-1', start: 0, end: 1.25, text: '第一句' },
        { id: 'line-2', start: 1.5, end: 3, text: 'Second line' },
      ],
    },
    selectedId: 'line-2',
    selection: { start: 0.25, end: 2.5 },
    audioName: 'song.mp3',
    savedAt: 1_700_000_000_000,
  };
}

function asBlob(draft: unknown): unknown {
  return { version: 1, draft };
}

describe('lyric-sync 设置与草稿', () => {
  beforeEach(() => {
    store.clear();
    failWrites = false;
    stubLocalStorage();
  });

  it('空存储返回默认选项，保存后可恢复', () => {
    expect(loadOptions()).toEqual({ precise: false, loop: false });
    expect(saveOptions({ precise: true, loop: true })).toBe(true);
    expect(loadOptions()).toEqual({ precise: true, loop: true });
  });

  it('合法草稿可从 version 1 blob 完整恢复', () => {
    const draft = validDraft();
    store.set('lyric-sync:draft', JSON.stringify(asBlob(draft)));
    expect(loadDraft()).toEqual(draft);
  });

  it('刷新式保存读回保持一致，原对象后续修改不影响存档', () => {
    const draft = validDraft();
    const expected = validDraft();
    expect(saveDraft(draft)).toBe(true);

    draft.document.metadata.title = 'Changed';
    draft.document.lines[0].text = 'Changed';
    draft.selection!.start = 99;

    const restored = loadDraft();
    expect(restored).toEqual(expected);
    expect(restored).not.toBe(draft);
    expect(restored!.document).not.toBe(draft.document);

    expect(saveDraft(restored!)).toBe(true);
    expect(loadDraft()).toEqual(expected);
  });

  it('JSON 损坏、版本不符或核心结构缺失时拒绝恢复', () => {
    store.set('lyric-sync:draft', '{broken');
    expect(loadDraft()).toBeNull();
    expect(parseDraftBlob(null)).toBeNull();
    expect(parseDraftBlob({ version: 2, draft: validDraft() })).toBeNull();
    expect(parseDraftBlob({ version: 1 })).toBeNull();
    expect(parseDraftBlob(asBlob({ ...validDraft(), document: null }))).toBeNull();
  });

  it('超过行数或总文本上限时拒绝恢复', () => {
    const tooManyLines = Array.from({ length: 5_001 }, (_, index) => ({
      id: `line-${index}`,
      start: index,
      end: index + 0.5,
      text: '',
    }));
    const draft = validDraft();
    expect(
      parseDraftBlob(asBlob({ ...draft, document: { ...draft.document, lines: tooManyLines } })),
    ).toBeNull();

    expect(
      parseDraftBlob(
        asBlob({
          ...draft,
          document: {
            ...draft.document,
            lines: [{ id: 'long', start: 0, end: 1, text: 'x'.repeat(200_001) }],
          },
        }),
      ),
    ).toBeNull();
  });

  it('无效行、非有限时间、空或重复 ID 均使草稿无效', () => {
    const line = { id: 'line', start: 0, end: 1, text: 'text' };
    const invalidLines: unknown[][] = [
      [null],
      [{ ...line, id: '' }],
      [{ ...line, id: '   ' }],
      [line, { ...line }],
      [{ ...line, start: -0.1 }],
      [{ ...line, start: Number.NaN }],
      [{ ...line, end: Number.POSITIVE_INFINITY }],
      [{ ...line, end: 0 }],
      [{ ...line, text: 42 }],
    ];

    for (const lines of invalidLines) {
      const draft = validDraft();
      expect(
        parseDraftBlob(asBlob({ ...draft, document: { ...draft.document, lines } })),
      ).toBeNull();
    }
  });

  it('metadata 必须是有限大小的字符串记录', () => {
    const draft = validDraft();
    const invalidMetadata: unknown[] = [
      null,
      [],
      { title: 1 },
      { title: 'x'.repeat(4_097) },
      { ['x'.repeat(129)]: 'value' },
      Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`key-${i}`, 'value'])),
    ];

    for (const metadata of invalidMetadata) {
      expect(
        parseDraftBlob(asBlob({ ...draft, document: { ...draft.document, metadata } })),
      ).toBeNull();
    }
  });

  it('selectedId 必须存在，selection 必须是合法时间区间或 null', () => {
    const draft = validDraft();
    expect(parseDraftBlob(asBlob({ ...draft, selectedId: 'missing' }))).toBeNull();
    expect(parseDraftBlob(asBlob({ ...draft, selectedId: 1 }))).toBeNull();

    const invalidSelections: unknown[] = [
      1,
      {},
      { start: -1, end: 2 },
      { start: 2, end: 2 },
      { start: 3, end: 2 },
      { start: 0, end: Number.NaN },
    ];
    for (const selection of invalidSelections) {
      expect(parseDraftBlob(asBlob({ ...draft, selection }))).toBeNull();
    }
  });

  it('文件名、音频名和保存时间等核心字段也会严格校验', () => {
    const draft = validDraft();
    expect(parseDraftBlob(asBlob({ ...draft, audioName: 'x'.repeat(513) }))).toBeNull();
    expect(parseDraftBlob(asBlob({ ...draft, audioName: 1 }))).toBeNull();
    expect(parseDraftBlob(asBlob({ ...draft, savedAt: -1 }))).toBeNull();
    expect(parseDraftBlob(asBlob({ ...draft, savedAt: Number.POSITIVE_INFINITY }))).toBeNull();
    expect(
      parseDraftBlob(asBlob({ ...draft, document: { ...draft.document, format: 'vtt' } })),
    ).toBeNull();
    expect(
      parseDraftBlob(asBlob({ ...draft, document: { ...draft.document, fileName: '' } })),
    ).toBeNull();
  });

  it('clearDraft 只删除草稿', () => {
    expect(saveOptions({ precise: true, loop: false })).toBe(true);
    expect(saveDraft(validDraft())).toBe(true);
    clearDraft();
    expect(store.has('lyric-sync:draft')).toBe(false);
    expect(loadDraft()).toBeNull();
    expect(loadOptions()).toEqual({ precise: true, loop: false });
  });

  it('底层写入失败时保存函数返回 false', () => {
    failWrites = true;
    expect(saveOptions({ precise: true, loop: true })).toBe(false);
    expect(saveDraft(validDraft())).toBe(false);
  });
});
