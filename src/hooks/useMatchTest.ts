import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

/**
 * 规则命中测试（按钮触发 + 驻留自动重测）：
 * - runTest() 调后端 test_rule_match，返回与 patterns 等长的命中数组
 *   （与运行时 domain_match 完全同一套匹配逻辑）
 * - 测试成功后 URL 进入驻留：之后规则列表变动（增删/编辑内容）自动按驻留 URL
 *   防抖 300ms 重测，行级 ✓/✗ 实时刷新——针对某条规则「改到命中为止」的调试闭环
 * - 修改测试 URL 本身会解除驻留（结果失效），需重新点「测试」
 *
 * matchPath=false 仅按 host 匹配（TLS 白名单 / 脚本语义），
 * true 按 host+path 匹配（AI 检测语义）。
 */
export function useMatchTest(patterns: string[], matchPath: boolean) {
  const [testUrl, setTestUrl] = useState("");
  const [hits, setHits] = useState<boolean[]>([]);
  /** 当前 hits 是否有效（有效才渲染高亮/✓✗） */
  const [tested, setTested] = useState(false);
  /** 递增序号丢弃过期响应（连点/自动重测交错时的竞态） */
  const seq = useRef(0);
  /** 驻留 URL：最近一次成功测试的输入；规则变动时按它自动重测 */
  const armedUrl = useRef<string | null>(null);

  // parent 每次 render 都会 .map 出新数组，用内容 key 判断规则是否真的变了
  const patternsKey = JSON.stringify(patterns);
  const patternsRef = useRef(patterns);
  patternsRef.current = patterns;

  async function fire(url: string) {
    const id = ++seq.current;
    try {
      const result = await invoke<boolean[]>("test_rule_match", {
        patterns: patternsRef.current,
        url,
        matchPath,
      });
      if (seq.current === id) {
        setHits(result);
        setTested(true);
        armedUrl.current = url;
      }
    } catch {
      if (seq.current === id) {
        setHits([]);
        setTested(false);
        armedUrl.current = null;
      }
    }
  }

  // 测试 URL 被改动（≠ 驻留值）→ 解除驻留、结果失效，等待重新点「测试」
  useEffect(() => {
    if (armedUrl.current !== null && testUrl !== armedUrl.current) {
      seq.current++;
      armedUrl.current = null;
      setHits([]);
      setTested(false);
    }
  }, [testUrl]);

  // 驻留中规则列表变动 → 防抖自动重测（编辑规则时实时看 ✗ 翻 ✓）
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on patternsKey intentionally
  useEffect(() => {
    if (armedUrl.current === null) return;
    const url = armedUrl.current;
    const timer = setTimeout(() => void fire(url), 300);
    return () => clearTimeout(timer);
  }, [patternsKey, matchPath]);

  function runTest() {
    if (testUrl.trim() === "") return;
    void fire(testUrl);
  }

  return { testUrl, setTestUrl, hits, tested, runTest };
}
