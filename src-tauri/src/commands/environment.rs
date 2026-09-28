use crate::AppState;
use crate::storage::environments::{EnvStoreSnapshot, Environment, EnvironmentsRepository};

#[tauri::command]
pub fn get_env_store(state: tauri::State<'_, AppState>) -> Result<EnvStoreSnapshot, String> {
    let db = state.db();
    let mut store = db.load_env_store().map_err(|e| e.to_string())?;

    // 首次启动自动播种默认环境（沿用 get_collections 的「默认模块」做法）。
    // 走 save_env_store：临时负 id 表示新建，protected 标记为内置不可删/不可改名。
    if store.environments.is_empty() {
        let seed = EnvStoreSnapshot {
            environments: vec![
                Environment {
                    id: -1,
                    name: "正式环境".into(),
                    variables: vec![],
                    protected: true,
                },
                Environment {
                    id: -2,
                    name: "测试环境".into(),
                    variables: vec![],
                    protected: true,
                },
            ],
            global_variables: vec![],
            active_env_id: None,
        };
        store = db.save_env_store(&seed).map_err(|e| e.to_string())?;
    }

    Ok(store)
}

#[tauri::command]
pub fn save_env_store(
    state: tauri::State<'_, AppState>,
    store: EnvStoreSnapshot,
) -> Result<EnvStoreSnapshot, String> {
    let db = state.db();
    db.save_env_store(&store).map_err(|e| e.to_string())
}
