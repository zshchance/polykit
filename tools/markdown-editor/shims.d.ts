// 以下插件包未自带类型声明，按各自 README 选项补齐最小结构化声明

interface Window {
  showOpenFilePicker?(options?: {
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
    multiple?: boolean;
  }): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?(options?: {
    suggestedName?: string;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }): Promise<FileSystemFileHandle>;
}

declare module 'markdown-it-task-lists' {
  const plugin: (
    md: object,
    options?: { enabled?: boolean; label?: boolean; labelAfter?: boolean },
  ) => void;
  export default plugin;
}

declare module 'markdown-it-footnote' {
  const plugin: (md: object) => void;
  export default plugin;
}

declare module 'markdown-it-texmath' {
  const plugin: (
    md: object,
    options?: {
      engine?: { renderToString(tex: string, options?: unknown): string };
      delimiters?: string | string[];
      katexOptions?: Record<string, unknown>;
    },
  ) => void;
  export default plugin;
}
