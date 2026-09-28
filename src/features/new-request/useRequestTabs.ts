// src/features/new-request/useRequestTabs.ts
import { useCallback, useRef, useState } from "react";
import type { ApiRequestNode, KeyValuePair, RequestTab, RequestTabSavedData } from "@/types/collection";

/** Extract saved data snapshot from a tab (or node) */
function snapshot(tab: RequestTab): RequestTabSavedData {
  return {
    method: tab.method,
    url: tab.url,
    params: tab.params,
    headers: tab.headers,
    cookies: tab.cookies,
    bodyType: tab.bodyType,
    body: tab.body,
    authType: tab.authType,
    authData: tab.authData,
  };
}

/** Deep-compare two KeyValuePair arrays（含 type/description，未设置时按默认值归一） */
function kvEqual(a: KeyValuePair[], b: KeyValuePair[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.key !== y.key || x.value !== y.value) return false;
    if ((x.enabled !== false) !== (y.enabled !== false)) return false;
    if ((x.type ?? "string") !== (y.type ?? "string")) return false;
    if ((x.description ?? "") !== (y.description ?? "")) return false;
  }
  return true;
}

/** Compare tab current data against savedData — returns true if identical */
function isClean(tab: RequestTab): boolean {
  const s = tab.savedData;
  if (!s) return false;
  return (
    tab.method === s.method &&
    tab.url === s.url &&
    kvEqual(tab.params, s.params) &&
    kvEqual(tab.headers, s.headers) &&
    kvEqual(tab.cookies, s.cookies) &&
    tab.bodyType === s.bodyType &&
    tab.body === s.body &&
    tab.authType === s.authType &&
    tab.authData === s.authData
  );
}

function createTabFromNode(node: ApiRequestNode): RequestTab {
  const tab: RequestTab = {
    id: crypto.randomUUID(),
    name: node.name,
    linkedNodeId: node.id,
    dirty: false,
    savedData: null,
    method: node.method,
    url: node.url,
    params: node.params ?? [],
    headers: node.headers ?? [],
    cookies: node.cookies ?? [],
    bodyType: node.bodyType ?? "json",
    body: node.body ?? "",
    authType: node.authType ?? "",
    authData: node.authData ?? "",
    responseEntryId: null,
    sending: false,
    error: "",
  };
  tab.savedData = snapshot(tab);
  return tab;
}

/** 创建空白临时 tab */
function createEmptyTab(): RequestTab {
  const tab: RequestTab = {
    id: crypto.randomUUID(),
    name: "",
    linkedNodeId: null,
    dirty: false,
    savedData: null,
    method: "GET",
    url: "",
    params: [],
    headers: [],
    cookies: [],
    bodyType: "json",
    body: "",
    authType: "",
    authData: "",
    responseEntryId: null,
    sending: false,
    error: "",
  };
  // Capture initial empty state so isClean() can detect when user clears all fields
  tab.savedData = snapshot(tab);
  return tab;
}

export function useRequestTabs() {
  const [tabs, setTabs] = useState<RequestTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  // ref 确保 openTab 的 useCallback([]) 闭包里始终读到最新 tabs
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // --- openTab ---
  const openTab = useCallback((linkedNodeId?: number | null, nodeData?: ApiRequestNode) => {
    if (linkedNodeId != null) {
      // 用 ref 读取最新 tabs，避免 setState 回调异步导致 dedup 失效
      const existing = tabsRef.current.find((t) => t.linkedNodeId === linkedNodeId);
      if (existing) {
        setActiveTabId(existing.id);
        return;
      }
    }

    const tab: RequestTab = nodeData ? createTabFromNode(nodeData) : createEmptyTab();

    // cURL 导入：不关联集合节点，标记为 dirty 提示用户手动保存
    if (linkedNodeId == null && nodeData) {
      tab.linkedNodeId = null;
      tab.savedData = null;
      tab.dirty = true;
    }

    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  // --- closeTab ---
  const closeTab = useCallback(
    (tabId: string) => {
      let nextActiveTabId: string | null = null;

      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId);
        if (idx === -1) return prev;

        const next = [...prev.slice(0, idx), ...prev.slice(idx + 1)];

        // 如果关闭的是 active tab，计算需要激活的相邻 tab
        if (tabId === activeTabId) {
          if (next.length === 0) {
            nextActiveTabId = null;
          } else if (idx < next.length) {
            nextActiveTabId = next[idx].id;
          } else {
            nextActiveTabId = next[next.length - 1].id;
          }
        }
        return next;
      });

      if (nextActiveTabId !== null) {
        setActiveTabId(nextActiveTabId);
      }
    },
    [activeTabId],
  );

  // --- activateTab ---
  const activateTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  // --- updateActiveTab ---
  const updateActiveTab = useCallback(
    (patch: Partial<RequestTab>, tabId?: string) => {
      const targetId = tabId ?? activeTabId;
      if (!targetId) return;

      const DATA_KEYS = [
        "method",
        "url",
        "params",
        "headers",
        "cookies",
        "bodyType",
        "body",
        "authType",
        "authData",
      ] as const;
      const hasDataChange = Object.keys(patch).some((k) => (DATA_KEYS as readonly string[]).includes(k));

      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== targetId) return t;
          const updated = { ...t, ...patch };
          if (hasDataChange) {
            updated.dirty = !isClean(updated);
          }
          return updated;
        }),
      );
    },
    [activeTabId],
  );

  // --- closeOthers ---
  const closeOthers = useCallback(() => {
    if (!activeTabId) return;
    setTabs((prev) => prev.filter((t) => t.id === activeTabId));
  }, [activeTabId]);

  // --- closeAll ---
  const closeAll = useCallback(() => {
    setTabs([]);
    setActiveTabId(null);
  }, []);

  const activeTab = activeTabId ? (tabs.find((t) => t.id === activeTabId) ?? null) : null;

  // --- linkTabToNode ---
  const linkTabToNode = useCallback((tabId: string, node: ApiRequestNode) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        const updated = { ...t, linkedNodeId: node.id, name: node.name, dirty: false };
        updated.savedData = snapshot(updated);
        return updated;
      }),
    );
  }, []);

  // --- markTabClean ---
  const markTabClean = useCallback((tabId: string) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        return { ...t, dirty: false, savedData: snapshot(t) };
      }),
    );
  }, []);

  // --- syncNodeRename ---
  const syncNodeRename = useCallback((nodeId: number, newName: string) => {
    setTabs((prev) => prev.map((t) => (t.linkedNodeId === nodeId ? { ...t, name: newName } : t)));
  }, []);

  return {
    tabs,
    activeTab,
    openTab,
    closeTab,
    activateTab,
    updateActiveTab,
    closeOthers,
    closeAll,
    linkTabToNode,
    syncNodeRename,
    markTabClean,
  };
}
