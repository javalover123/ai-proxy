// src/types/env.ts

/** 单个环境变量 / 全局变量（精简版 key-value）。 */
export interface EnvVariable {
  key: string;
  value: string;
  enabled: boolean;
}

/** 一个环境及其专属变量。 */
export interface Environment {
  id: number;
  name: string;
  variables: EnvVariable[];
  /** 内置默认环境（正式/测试）不可删除。 */
  protected: boolean;
}

/** 后端 `get_env_store` 返回的完整快照。 */
export interface EnvStore {
  environments: Environment[];
  globalVariables: EnvVariable[];
  activeEnvId: number | null;
}
