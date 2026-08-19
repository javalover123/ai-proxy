pub mod open_url;
pub use open_url::open_url;
mod ai;
mod collection;
mod locale;
mod proxy;
mod resend;
mod settings;
pub use ai::{get_ai_session, get_ai_thinking, list_ai_sessions};
pub use collection::{
    create_collection, create_folder, create_request, delete_node, duplicate_request,
    get_collections, move_node, rename_node, save_request,
};
mod theme;

pub use locale::{get_locale, set_locale, sync_tray_locale};
pub use proxy::{get_status, start_proxy, stop_proxy, subscribe_proxy_events};
pub use resend::resend_request;
pub use settings::{export_ca_cert, install_ca_cert, read_ca_cert_pem, test_rule_match};
pub use settings::{get_ai_config, save_ai_config, set_ai_enabled};
pub use settings::{
    get_script_config, get_script_content, save_script_config, save_script_content,
    set_script_enabled,
};
pub use settings::{get_settings, save_settings};
pub use settings::{get_ssl_config, save_ssl_config, set_ssl_enabled};
pub use theme::{get_prose_font_size, get_theme, set_prose_font_size, set_theme};
mod traffic;
pub use traffic::{get_traffic_detail, load_traffic_history};
