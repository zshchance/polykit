/**
 * 角色进度条选项归一化 —— 纯函数单测。
 * 重点覆盖：非法字段单独回退、素材 id 白名单、数值钳制、预设可完整还原。
 */

import { describe, expect, it } from 'vitest';

import { PROGRESS_PRESETS, normalizeProgressEffect } from './options';

describe('normalizeProgressEffect', () => {
  it('关闭状态 / 非对象输入返回 null', () => {
    expect(normalizeProgressEffect(null)).toBeNull();
    expect(normalizeProgressEffect(undefined)).toBeNull();
    expect(normalizeProgressEffect('football')).toBeNull();
    expect(normalizeProgressEffect([])).toBeNull();
  });

  it('合法内置载体与运动/尾迹原样保留', () => {
    const out = normalizeProgressEffect({
      actor: { kind: 'builtin', id: 'meteor' },
      motion: 'fly',
      trail: 'fire',
      trailLen: 0.8,
      size: 0.12,
      tint: 'accent',
      tempoSync: true,
    });
    expect(out).not.toBeNull();
    expect(out!.actor).toEqual({ kind: 'builtin', id: 'meteor' });
    expect(out!.motion).toBe('fly');
    expect(out!.trail).toBe('fire');
    expect(out!.trailLen).toBe(0.8);
    expect(out!.size).toBe(0.12);
    expect(out!.tint).toBe('accent');
    expect(out!.tempoSync).toBe(true);
  });

  it('上传素材 id 必须是 sva: 前缀 + 小写字母数字', () => {
    const ok = normalizeProgressEffect({ actor: { kind: 'asset', id: 'sva:ab12cd34' } });
    expect(ok!.actor).toEqual({ kind: 'asset', id: 'sva:ab12cd34' });

    expect(
      normalizeProgressEffect({ actor: { kind: 'asset', id: 'javascript:alert(1)' } })!.actor,
    ).toEqual({ kind: 'builtin', id: 'football' });
    expect(normalizeProgressEffect({ actor: { kind: 'asset', id: 'sva:AB12' } })!.actor).toEqual({
      kind: 'builtin',
      id: 'football',
    });
  });

  it('非法枚举回退默认，数值越界被钳制', () => {
    const out = normalizeProgressEffect({
      actor: { kind: 'builtin', id: 'no-such-actor' },
      motion: 'teleport',
      trail: 'sparkle',
      trailLen: 2,
      size: 0.01,
      tint: 'rainbow',
    });
    expect(out!.actor).toEqual({ kind: 'builtin', id: 'football' });
    expect(out!.motion).toBe('roll');
    expect(out!.trail).toBe('none');
    expect(out!.trailLen).toBe(1);
    expect(out!.size).toBe(0.06);
    expect(out!.tint).toBe('original');
    expect(out!.tempoSync).toBe(false);
  });

  it('旋转/光晕/偏移越界被钳制', () => {
    const out = normalizeProgressEffect({
      actor: { kind: 'builtin', id: 'earth' },
      spin: 5,
      halo: 2,
      offsetY: 0.5,
    });
    expect(out!.spin).toBe(3);
    expect(out!.halo).toBe(1);
    expect(out!.offsetY).toBe(0.2);
  });

  it('已下线的内置人偶回退足球并重置运动', () => {
    const out = normalizeProgressEffect({
      actor: { kind: 'builtin', id: 'runner' },
      motion: 'run',
    });
    expect(out!.actor).toEqual({ kind: 'builtin', id: 'football' });
    expect(out!.motion).toBe('roll');
  });

  it('全部预设都能完整归一化（不会被校验吃掉字段）', () => {
    for (const preset of PROGRESS_PRESETS) {
      const out = normalizeProgressEffect(preset.effect);
      expect(out).not.toBeNull();
      expect(out!.actor).toEqual(preset.effect.actor);
      expect(out!.motion).toBe(preset.effect.motion);
      expect(out!.trail).toBe(preset.effect.trail);
      expect(out!.trailLen).toBe(preset.effect.trailLen);
      expect(out!.size).toBe(preset.effect.size);
      expect(out!.tint).toBe(preset.effect.tint);
      expect(out!.tempoSync).toBe(preset.effect.tempoSync);
      expect(out!.spin).toBe(preset.effect.spin);
      expect(out!.halo).toBe(preset.effect.halo);
      expect(out!.offsetY).toBe(preset.effect.offsetY);
    }
  });
});
