// src/lib/variables.ts — 环境变量 `{{var}}` 替换

import type { EnvVariable } from "@/types/env";

/** 匹配 `{{ key }}`，key 允许字母/数字/下划线/点/连字符，两侧可带空白。 */
const VAR_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}/g;

/** 递归替换上限，防止变量自引用/循环引用死循环。 */
const MAX_DEPTH = 10;

/**
 * 把 input 中的 `{{key}}` 替换为 vars 里的值（递归，变量值里还能引用别的变量）。
 * 未定义的变量保留原文 `{{key}}` 不替换，便于一眼看出没解析到。
 */
export function resolveTemplate(input: string, vars: ReadonlyMap<string, string>): string {
  let result = input;
  for (let i = 0; i < MAX_DEPTH; i++) {
    const replaced = result.replace(VAR_PATTERN, (match, name: string) => {
      const value = vars.get(name);
      return value !== undefined ? value : match;
    });
    if (replaced === result) break;
    result = replaced;
  }
  return result;
}

/**
 * 构建发送时的变量映射：全局变量打底，环境变量覆盖同名全局变量。
 * 仅收录 enabled 且 key 非空的条目。
 */
export function buildVariableMap(globalVariables: EnvVariable[], envVariables: EnvVariable[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const v of globalVariables) {
    if (v.enabled !== false && v.key.trim()) map.set(v.key.trim(), v.value);
  }
  for (const v of envVariables) {
    if (v.enabled !== false && v.key.trim()) map.set(v.key.trim(), v.value);
  }
  return map;
}
