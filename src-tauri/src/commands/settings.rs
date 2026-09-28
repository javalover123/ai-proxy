use crate::AppState;
use crate::config::{AiConfig, AuthzConfig, ProxyConfig, ScriptConfig, Settings, TlsConfig};
use crate::utils::domain_match::{domain_match, url_candidate};
use std::hash::{DefaultHasher, Hash, Hasher};

#[tauri::command]
pub fn get_settings(state: tauri::State<'_, AppState>) -> Result<Settings, String> {
    Ok(state.settings())
}

#[tauri::command]
pub fn save_settings(state: tauri::State<'_, AppState>, proxy: ProxyConfig) -> Result<(), String> {
    let data_dir = state.store().data_dir();
    let mut settings = Settings::load_from_path(data_dir).map_err(|e| e.to_string())?;
    settings.proxy = proxy;
    settings.save_to_path(data_dir).map_err(|e| e.to_string())?;

    state.set_settings(settings);

    Ok(())
}

#[tauri::command]
pub fn get_script_config(state: tauri::State<'_, AppState>) -> Result<ScriptConfig, String> {
    let settings = state.settings();
    Ok(settings.script)
}

#[tauri::command]
pub fn save_script_config(
    state: tauri::State<'_, AppState>,
    script: ScriptConfig,
) -> Result<(), String> {
    let data_dir = state.store().data_dir();
    let mut settings = Settings::load_from_path(data_dir).map_err(|e| e.to_string())?;

    // validate and generate file_name for each enabled script
    for item in &script.scripts {
        if item.enabled && item.name.trim().is_empty() {
            return Err("Script name is required when enabled".into());
        }
        // name 不允许全部数字（避免与 name 内部 script-N 自动 ID 混淆）
        if item.name.trim().chars().all(|c| c.is_ascii_digit()) {
            return Err(format!(
                "Script name must contain at least one letter: '{}'",
                item.name
            ));
        }
    }

    let mut validated = script;
    for item in &mut validated.scripts {
        // method 归一化：trim + 大写；"ANY" 与空串同义（any，匹配所有方法）
        item.method = item.method.trim().to_uppercase();
        if item.method == "ANY" {
            item.method.clear();
        }
        if item.enabled {
            let raw = format!("{}.js", item.name);
            let mut hasher = DefaultHasher::new();
            raw.hash(&mut hasher);
            item.file_name = format!("{:016x}", hasher.finish());
        } else {
            item.file_name.clear();
        }
    }

    settings.script = validated;
    settings.save_to_path(data_dir).map_err(|e| e.to_string())?;
    state.set_settings(settings);
    Ok(())
}

#[tauri::command]
pub fn get_tls_config(state: tauri::State<'_, AppState>) -> Result<TlsConfig, String> {
    let settings = state.settings();
    Ok(settings.tls)
}

#[tauri::command]
pub fn save_tls_config(state: tauri::State<'_, AppState>, tls: TlsConfig) -> Result<(), String> {
    let data_dir = state.store().data_dir();
    let mut settings = Settings::load_from_path(data_dir).map_err(|e| e.to_string())?;
    settings.tls = tls;
    settings.save_to_path(data_dir).map_err(|e| e.to_string())?;

    state.set_settings(settings);

    Ok(())
}

/// 仅切换 TLS 解密总开关；白名单等其余配置原样保留（供底部栏快捷开关使用）。
#[tauri::command]
pub fn set_tls_enabled(state: tauri::State<'_, AppState>, enabled: bool) -> Result<(), String> {
    let data_dir = state.store().data_dir();
    let mut settings = Settings::load_from_path(data_dir).map_err(|e| e.to_string())?;
    settings.tls.enabled = enabled;
    settings.save_to_path(data_dir).map_err(|e| e.to_string())?;

    state.set_settings(settings);

    Ok(())
}

/// 仅切换脚本总开关；脚本列表原样保留（供底部栏快捷开关使用）。
#[tauri::command]
pub fn set_script_enabled(state: tauri::State<'_, AppState>, enabled: bool) -> Result<(), String> {
    let data_dir = state.store().data_dir();
    let mut settings = Settings::load_from_path(data_dir).map_err(|e| e.to_string())?;
    settings.script.enabled = enabled;
    settings.save_to_path(data_dir).map_err(|e| e.to_string())?;

    state.set_settings(settings);

    Ok(())
}

#[tauri::command]
pub fn get_authz_config(state: tauri::State<'_, AppState>) -> Result<AuthzConfig, String> {
    let settings = state.settings();
    Ok(settings.authz)
}

#[tauri::command]
pub fn save_authz_config(
    state: tauri::State<'_, AppState>,
    authz: AuthzConfig,
) -> Result<(), String> {
    let data_dir = state.store().data_dir();
    let mut settings = Settings::load_from_path(data_dir).map_err(|e| e.to_string())?;

    // 校验：启用规则必须有 name 与合法 url；method 归一化（trim + 大写，ANY 与空串同义）。
    let mut authz = authz;
    for item in &mut authz.rules {
        item.name = item.name.trim().to_string();
        item.domain = item.domain.trim().to_string();
        item.url = item.url.trim().to_string();
        item.method = item.method.trim().to_uppercase();
        if item.method == "ANY" {
            item.method.clear();
        }
        if item.enabled && item.name.is_empty() {
            return Err("Authz rule name is required when enabled".into());
        }
        if item.enabled && item.url.is_empty() {
            return Err(format!(
                "Authz rule url is required when enabled: '{}'",
                item.name
            ));
        }
    }

    settings.authz = authz;
    settings.save_to_path(data_dir).map_err(|e| e.to_string())?;

    state.set_settings(settings);

    Ok(())
}

/// 仅切换 AI 检测总开关；URL 规则列表原样保留（供底部栏快捷开关使用）。
#[tauri::command]
pub fn set_ai_enabled(state: tauri::State<'_, AppState>, enabled: bool) -> Result<(), String> {
    let data_dir = state.store().data_dir();
    let mut settings = Settings::load_from_path(data_dir).map_err(|e| e.to_string())?;
    settings.ai.enabled = enabled;
    settings.save_to_path(data_dir).map_err(|e| e.to_string())?;

    state.set_settings(settings);

    Ok(())
}

/// 读取指定脚本文件的内容。file_name 是 save_script_config 时生成的 hash 文件名。
#[tauri::command]
pub fn get_script_content(
    state: tauri::State<'_, AppState>,
    file_name: String,
) -> Result<String, String> {
    if file_name.is_empty() {
        return Err("file_name is empty".into());
    }
    let script_path = state.store().scripts_dir().join(&file_name);
    std::fs::read_to_string(&script_path)
        .map_err(|e| format!("Failed to read script {}: {}", file_name, e))
}

/// 保存脚本文件内容。file_name 是 save_script_config 时生成的 hash 文件名。
#[tauri::command]
pub fn save_script_content(
    state: tauri::State<'_, AppState>,
    file_name: String,
    content: String,
) -> Result<(), String> {
    if file_name.is_empty() {
        return Err("file_name is empty".into());
    }
    let script_path = state.store().scripts_dir().join(&file_name);
    std::fs::write(&script_path, &content)
        .map_err(|e| format!("Failed to write script {}: {}", file_name, e))
}

/// 测试 url 对一组 pattern 的命中情况（配置弹窗「匹配测试」行使用）。
/// 与运行时同走 domain_match：match_path=false 仅取 host（TLS/脚本语义），
/// true 取 host+path（AI 检测语义）。url 无法解析时全部返回 false。
#[tauri::command]
pub fn test_rule_match(patterns: Vec<String>, url: String, match_path: bool) -> Vec<bool> {
    let Some(candidate) = url_candidate(&url, match_path) else {
        return vec![false; patterns.len()];
    };
    patterns
        .iter()
        .map(|p| domain_match(p, &candidate))
        .collect()
}

#[tauri::command]
pub fn get_ai_config(state: tauri::State<'_, AppState>) -> Result<AiConfig, String> {
    let settings = state.settings();
    Ok(settings.ai)
}

#[tauri::command]
pub fn save_ai_config(state: tauri::State<'_, AppState>, ai: AiConfig) -> Result<(), String> {
    let data_dir = state.store().data_dir();
    let mut settings = Settings::load_from_path(data_dir).map_err(|e| e.to_string())?;

    // 防御性剔除空 url 规则；其余（含启用状态）以前端为准整体覆盖
    let mut ai = ai;
    ai.detection
        .url_patterns
        .retain(|r| !r.url.trim().is_empty());

    // AI 检测依赖 MITM 解密：启用时联动打开 TLS 总开关并补齐白名单域名
    crate::config::sync_tls_for_ai(&mut settings.tls, &ai);

    settings.ai = ai;
    settings.save_to_path(data_dir).map_err(|e| e.to_string())?;

    state.set_settings(settings);

    Ok(())
}

/// 安装 CA 证书到操作系统信任库。
/// Windows: CryptoAPI 静默安装到 CurrentUser\Root，不弹窗。
/// macOS: 安装到 login keychain（钥匙串未锁时静默）。
/// Linux: pkexec/sudo 复制到系统证书目录。
#[tauri::command]
pub fn install_ca_cert(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let data_dir = state.store().data_dir();
    let ca_cert_path = data_dir.join("ca-cert.pem");

    if !ca_cert_path.exists() {
        return Err(format!(
            "CA certificate not found at {}",
            ca_cert_path.display()
        ));
    }

    #[cfg(not(target_os = "windows"))]
    let cert_path_str = ca_cert_path.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        use std::ptr::null_mut;
        use windows_sys::Win32::Foundation::GetLastError;
        use windows_sys::Win32::Security::Cryptography::{
            CERT_STORE_ADD_REPLACE_EXISTING, CERT_SYSTEM_STORE_CURRENT_USER,
            CertAddEncodedCertificateToStore, CertCloseStore, CertOpenStore, X509_ASN_ENCODING,
            sz_CERT_STORE_PROV_SYSTEM_W,
        };

        // 读取 PEM 并提取 DER 字节
        let ca_pem = std::fs::read_to_string(&ca_cert_path)
            .map_err(|e| format!("Failed to read CA cert: {e}"))?;
        let der_bytes =
            pem_to_der(&ca_pem).map_err(|e| format!("Failed to decode CA cert PEM: {e}"))?;

        // 通过 CryptoAPI 静默安装到 CurrentUser\Root，不弹任何窗口
        unsafe {
            let store = CertOpenStore(
                sz_CERT_STORE_PROV_SYSTEM_W,
                X509_ASN_ENCODING,
                0,
                CERT_SYSTEM_STORE_CURRENT_USER,
                windows_sys::core::w!("Root") as *const _,
            );
            if store.is_null() {
                return Err("Failed to open Windows certificate store".into());
            }

            let ok = CertAddEncodedCertificateToStore(
                store,
                X509_ASN_ENCODING,
                der_bytes.as_ptr(),
                der_bytes.len() as u32,
                CERT_STORE_ADD_REPLACE_EXISTING,
                null_mut(),
            );

            let err = GetLastError();
            CertCloseStore(store, 0);

            if ok == 0 {
                return Err(format!(
                    "Certificate install failed (error code: 0x{err:08X}).\n\
                     You can also export and install the certificate manually.",
                ));
            }
        }

        log::info!("CA cert installed to CurrentUser\\Root via CryptoAPI");
        Ok("Certificate installed to Windows Root store".into())
    }

    #[cfg(target_os = "macos")]
    {
        // 安装到用户级钥匙串，不需要管理员权限。
        let check = std::process::Command::new("security")
            .args(["find-certificate", "-c", "ai-proxy"])
            .output();
        if let Ok(ref out) = check
            && out.status.success()
        {
            log::info!("CA cert already in login keychain, skipping");
            return Ok("Certificate is already installed in login keychain".into());
        }

        let output = std::process::Command::new("security")
            .args([
                "add-trusted-cert",
                "-d",
                "-r",
                "trustRoot",
                "-k",
                &format!(
                    "{}/Library/Keychains/login.keychain-db",
                    std::env::var("HOME").unwrap_or_else(|_| "/Users/unknown".into())
                ),
                &cert_path_str,
            ])
            .output()
            .map_err(|e| format!("Failed to run security: {e}"))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if output.status.success() {
            log::info!("CA cert installed to login keychain: {stdout}");
            Ok("Certificate installed to login keychain".into())
        } else {
            let code = output
                .status
                .code()
                .map(|c| c.to_string())
                .unwrap_or_else(|| "unknown".into());
            Err(format!(
                "security exit={code}\nstdout: {stdout}\nstderr: {stderr}"
            ))
        }
    }

    #[cfg(target_os = "linux")]
    {
        let candidates = [
            // Debian/Ubuntu 系
            (
                "/usr/local/share/ca-certificates/ai-proxy.crt",
                "update-ca-certificates",
            ),
            // Fedora/RHEL 系
            (
                "/etc/pki/ca-trust/source/anchors/ai-proxy.crt",
                "update-ca-trust",
            ),
        ];

        for (dest_path, update_cmd) in &candidates {
            // 尝试复制到目标目录
            let copy_result = std::process::Command::new("pkexec")
                .args(["cp", &cert_path_str, dest_path])
                .output();

            let copied = match &copy_result {
                Ok(o) if o.status.success() => true,
                _ => {
                    // pkexec 需要 GUI 环境，fallback 到 sudo
                    std::process::Command::new("sudo")
                        .args(["cp", &cert_path_str, dest_path])
                        .output()
                        .map(|o| o.status.success())
                        .unwrap_or(false)
                }
            };

            if copied {
                // 更新证书存储
                let update = std::process::Command::new("pkexec")
                    .arg(update_cmd)
                    .output()
                    .or_else(|_| std::process::Command::new("sudo").arg(update_cmd).output());

                match update {
                    Ok(o) if o.status.success() => {
                        let msg = format!("CA cert installed via {}", dest_path);
                        log::info!("{msg}");
                        return Ok(msg);
                    }
                    Ok(o) => {
                        let stdout = String::from_utf8_lossy(&o.stdout).to_string();
                        let stderr = String::from_utf8_lossy(&o.stderr).to_string();
                        let code = o
                            .status
                            .code()
                            .map(|c| c.to_string())
                            .unwrap_or_else(|| "unknown".into());
                        return Err(format!(
                            "{update_cmd} exit={code}\nstdout: {stdout}\nstderr: {stderr}"
                        ));
                    }
                    Err(e) => return Err(format!("Failed to run {update_cmd}: {e}")),
                }
            }
        }

        Err("No supported Linux CA store found. Install manually: copy ca-cert.pem to /usr/local/share/ca-certificates/ and run update-ca-certificates".into())
    }
}

/// 读取 CA 证书内容（PEM 格式），用于前端导出下载。
#[tauri::command]
pub fn read_ca_cert_pem(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let src = state.store().data_dir().join("ca-cert.pem");
    if !src.exists() {
        return Err("CA certificate not found. Start the proxy once to generate it.".into());
    }
    std::fs::read_to_string(&src).map_err(|e| format!("Failed to read CA cert: {e}"))
}

/// 将 CA 证书导出到指定路径。
#[tauri::command]
pub fn export_ca_cert(state: tauri::State<'_, AppState>, dest_path: String) -> Result<(), String> {
    let src = state.store().data_dir().join("ca-cert.pem");
    if !src.exists() {
        return Err("CA certificate not found. Start the proxy once to generate it.".into());
    }
    std::fs::copy(&src, &dest_path)
        .map(|_| ())
        .map_err(|e| format!("Failed to write certificate to {}: {}", dest_path, e))
}

/// 将 PEM 格式的证书转换为 DER 字节。
/// 输入要求是合法 PEM（有头尾标记、base64 内容），否则返回 Err。
#[cfg(target_os = "windows")]
fn pem_to_der(pem: &str) -> Result<Vec<u8>, String> {
    let b64: String = pem
        .lines()
        .filter(|line| !line.starts_with("-----"))
        .collect();

    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(&b64)
        .map_err(|e| format!("Invalid base64 in PEM: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rule_match_host_vs_path_semantics() {
        let patterns = vec![
            "*.openai.com".to_string(),
            "api.openai.com/v1/*".to_string(),
            String::new(),
        ];
        let url = "https://api.openai.com/v1/chat/completions".to_string();
        // host 语义（TLS/脚本）：带路径的 pattern 永不命中；空 pattern 匹配一切（脚本「不限域名」）
        assert_eq!(
            test_rule_match(patterns.clone(), url.clone(), false),
            vec![true, false, true]
        );
        // host+path 语义（AI 检测）：纯域名 pattern 匹配不到带路径的候选串
        assert_eq!(
            test_rule_match(patterns, url, true),
            vec![false, true, true]
        );
    }

    #[test]
    fn rule_match_unparsable_url_all_false() {
        assert_eq!(
            test_rule_match(vec!["*".into()], "://".into(), false),
            vec![false]
        );
    }
}
