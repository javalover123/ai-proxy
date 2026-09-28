// src/hooks/useEnvironments.ts

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Environment, EnvStore, EnvVariable } from "@/types/env";

export interface EnvController {
  environments: Environment[];
  globalVariables: EnvVariable[];
  activeEnvId: number | null;
  activeEnv: Environment | null;
  loading: boolean;
  reload: () => void;
  setActiveEnv: (id: number) => void;
  /** 一次性提交整份环境草稿（含新建/改名/删除/变量），成功后回填真实 id 与激活环境。 */
  saveStore: (draft: EnvStore) => Promise<void>;
}

export function useEnvironments(): EnvController {
  const [store, setStore] = useState<EnvStore>({
    environments: [],
    globalVariables: [],
    activeEnvId: null,
  });
  const [loading, setLoading] = useState(true);

  // 同步一份 ref，供 saveStore 读取提交前的原始 id 集合
  const storeRef = useRef(store);
  useEffect(() => {
    storeRef.current = store;
  }, [store]);

  const reload = useCallback(() => {
    setLoading(true);
    invoke<EnvStore>("get_env_store")
      .then((data) => setStore(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const setActiveEnv = useCallback((id: number) => {
    setStore((prev) => ({ ...prev, activeEnvId: id }));
  }, []);

  const saveStore = useCallback(async (draft: EnvStore) => {
    const saved = await invoke<EnvStore>("save_env_store", {
      store: {
        environments: draft.environments,
        globalVariables: draft.globalVariables,
        activeEnvId: draft.activeEnvId,
      },
    });

    // 把草稿里新建环境的临时 id 映射到落库后的真实 id，用于回填激活环境
    const origIds = new Set(storeRef.current.environments.map((e) => e.id));
    const tempToReal = new Map<number, number>();
    const draftNew = draft.environments.filter((e) => !origIds.has(e.id));
    const savedNew = saved.environments.filter((e) => !origIds.has(e.id));
    draftNew.forEach((e, i) => {
      const real = savedNew[i];
      if (real != null) tempToReal.set(e.id, real.id);
    });

    let activeEnvId = draft.activeEnvId;
    if (activeEnvId != null) {
      activeEnvId = tempToReal.get(activeEnvId) ?? activeEnvId;
      if (!saved.environments.some((e) => e.id === activeEnvId)) {
        activeEnvId = saved.environments[0]?.id ?? null;
      }
    }

    setStore({ ...saved, activeEnvId });
  }, []);

  const activeEnv = store.environments.find((e) => e.id === store.activeEnvId) ?? null;

  return {
    environments: store.environments,
    globalVariables: store.globalVariables,
    activeEnvId: store.activeEnvId,
    activeEnv,
    loading,
    reload,
    setActiveEnv,
    saveStore,
  };
}
