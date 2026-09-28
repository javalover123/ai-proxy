mod commands;
mod config;
mod proxy;
mod script;
mod storage;
mod tray;
pub mod utils;
use proxy::state::AppState;
use tauri::{Emitter, Manager, RunEvent};

use crate::commands::{
    create_collection, create_folder, create_request, delete_node, duplicate_request,
    export_ca_cert, get_ai_config, get_ai_session, get_ai_thinking, get_ai_usage_summary,
    get_authz_config, get_collections, get_env_store, get_locale, get_prose_font_size,
    get_script_config, get_script_content, get_settings, get_status, get_theme, get_tls_config,
    get_traffic_detail, install_ca_cert, list_ai_sessions, load_traffic_history, move_node,
    open_url, read_ca_cert_pem, rename_node, resend_request, save_ai_config, save_authz_config,
    save_env_store, save_request, save_script_config, save_script_content, save_settings,
    save_tls_config, set_ai_enabled, set_locale, set_prose_font_size, set_script_enabled,
    set_theme, set_tls_enabled, start_proxy, stop_proxy, subscribe_proxy_events, sync_tray_locale,
    test_rule_match,
};
use crate::config::{Settings, Store};

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub(crate) fn open_settings_from_tray(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        state.set_pending_open_settings(true);
    }

    show_main_window(app);

    if let Some(window) = app.get_webview_window("main")
        && window.is_focused().unwrap_or(false)
    {
        if let Some(state) = app.try_state::<AppState>() {
            state.set_pending_open_settings(false);
        }
        let _ = window.emit("open-settings", ());
    }
}

fn app_setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to get app data directory");

    use crate::storage::id;

    let store = Store::new(data_dir);

    // 从 DB 恢复请求 ID 计数器，防止重启后 ID 重复
    match store.max_traffic_id() {
        Ok(max_id) => id::init_request_counter(max_id as u64),
        Err(e) => log::warn!("[db] max_traffic_id failed: {e:?}, counter starts from 1"),
    }

    let settings =
        Settings::load_from_path(store.data_dir()).expect("Failed to load configuration");
    let ui = settings.ui.clone();
    let _ = app
        .handle()
        .plugin(Store::build_log_plugin(&settings.log).build());
    app.manage(AppState::new(store, settings));

    if let Some(window) = app.get_webview_window("main") {
        let tauri_theme = match ui.theme.as_str() {
            "dark" => Some(tauri::Theme::Dark),
            "light" => Some(tauri::Theme::Light),
            _ => None,
        };
        window.set_theme(tauri_theme).ok();

        // 与 CSS 背景色同步，避免拖拽窗口时 webview 重绘滞后露出白色边缘
        let is_dark = window
            .theme()
            .is_ok_and(|t| matches!(t, tauri::Theme::Dark));
        let bg = if is_dark {
            tauri::webview::Color(0x25, 0x25, 0x25, 0xff)
        } else {
            tauri::webview::Color(0xfa, 0xfb, 0xfb, 0xff)
        };
        window.set_background_color(Some(bg)).ok();
    }
    tray::setup_tray(app, ui.tray_locale())?;
    Ok(())
}

fn handle_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::Focused(true) = event {
        let app = window.app_handle();
        let should_open = app
            .try_state::<AppState>()
            .is_some_and(|state| state.take_pending_open_settings());
        if should_open {
            let _ = window.emit("open-settings", ());
        }
    }

    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        log::info!("Window close requested, exiting app");
        window.app_handle().exit(0);
    }
}

pub fn run() {
    // debug 下 rustls/rama HTTP 客户端握手的调用栈很深，tokio 默认 2MiB
    // worker 栈会直接 overflow（表现为点「发送」后进程瞬间退出，无 panic hook）。
    // 必须在任何 Tauri async 初始化之前安装；runtime 不能 drop。
    /* let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_stack_size(4 * 1024 * 1024)
        .build()
        .expect("failed to create tokio runtime");
    tauri::async_runtime::set(runtime.handle().clone());
    std::mem::forget(runtime); */

    // 诊断探针：Windows GUI 应用的 panic 默认只打 stderr（无处可看）。
    // 钩子把 panic 位置与信息写入日志文件，用于排查静默任务死亡/锁毒化。
    // 同时链回默认 hook：logger 未挂载时（setup 早期）panic 仍可见于 stderr。
    let default_panic_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("[panic] {info}");
        default_panic_hook(info);
    }));

    // 排查上游转发偶发永久卡死：绕开 rama 在 Windows 上默认的原生
    // DnsQueryEx 解析器（其取消路径存在 FFI 回调与 inflight 锁的死锁窗口，
    // 新版 race_connect 拨号会高频丢弃在飞查询触发取消）。改用 tokio
    // lookup_host（系统 getaddrinfo，spawn_blocking，无取消/回调路径）。
    // 必须在首次 DNS 查询前调用（全局 OnceLock 懒初始化，一次定型）。
    rama::dns::client::try_init_global_dns_resolver(rama::dns::client::TokioDnsResolver::new())
        .unwrap_or_else(|_| log::warn!("global DNS resolver already initialized"));

    log::info!("Starting AI Proxy");

    let app = tauri::Builder::default()
        .setup(app_setup)
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(handle_window_event)
        .invoke_handler(tauri::generate_handler![
            start_proxy,
            stop_proxy,
            get_status,
            install_ca_cert,
            read_ca_cert_pem,
            export_ca_cert,
            open_url,
            get_tls_config,
            save_tls_config,
            set_tls_enabled,
            get_ai_config,
            save_ai_config,
            set_ai_enabled,
            test_rule_match,
            get_script_config,
            save_script_config,
            set_script_enabled,
            get_script_content,
            save_script_content,
            get_authz_config,
            save_authz_config,
            get_theme,
            set_theme,
            get_prose_font_size,
            set_prose_font_size,
            get_settings,
            save_settings,
            get_locale,
            set_locale,
            subscribe_proxy_events,
            sync_tray_locale,
            load_traffic_history,
            get_traffic_detail,
            list_ai_sessions,
            get_ai_session,
            get_ai_thinking,
            get_ai_usage_summary,
            resend_request,
            get_collections,
            create_collection,
            create_folder,
            create_request,
            delete_node,
            rename_node,
            move_node,
            save_request,
            duplicate_request,
            get_env_store,
            save_env_store,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    log::info!("Configuration loaded, proxy ready");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { .. } = &event
            && let Some(state) = app_handle.try_state::<AppState>()
        {
            if state.running() {
                state.set_running(false);
                log::info!("Proxy stopped (app exiting)");
            }
            if let Some(tx) = state.take_shutdown_signal() {
                tx.send(()).ok();
            }
            state.db().shutdown();
        }
    });
}
