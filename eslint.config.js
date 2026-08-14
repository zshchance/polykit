// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * ESLint 平面配置（项目为 ESM）。
 * 基线：eslint recommended + typescript-eslint recommended（非 type-checked，
 * 保持 CI 速度与零配置摩擦；strict 全开的 tsc 已覆盖大部分类型面）。
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'gui-test-screenshots/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // 未用参数以下划线开头豁免（事件签名常见）
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // 仓库约定：catch 空块 + 注释说明是主要模式，允许空 catch（其余空块仍报错）
      'no-empty': ['error', { allowEmptyCatch: true }],
      // new Function 执行 AI 回填代码的 3 处已有 eslint-disable 注释依赖此规则
      'no-new-func': 'error',
    },
  },
  {
    // 浏览器端源码
    files: ['src/**/*.ts', 'tools/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Node 环境：构建配置与数据维护脚本
    files: ['scripts/**/*.mjs', '*.config.ts', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
);
