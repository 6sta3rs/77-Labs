//! Explicit external license-source opening, without a general shell capability.
//! Remote pages stay in the user's browser, outside the privileged studio webview.
use tauri::WebviewWindow;

const ALLOWED_HOSTS: &[&str] = &["github.com", "huggingface.co", "modelscope.cn"];
const INVALID_URL: &str = "Otwórz prawidłowy odnośnik HTTPS do źródła warunków na GitHub, Hugging Face lub ModelScope.";

fn source_url(raw: &str) -> Result<String, String> {
    if raw.is_empty() || raw.len() > 4096 || raw.trim() != raw
        || raw.chars().any(char::is_control) || raw.contains('\\') {
        return Err(INVALID_URL.into());
    }
    // Also reject an explicitly empty userinfo, which URL canonicalization
    // otherwise discards (https://@github.com). @ in a path/query is harmless.
    let authority = raw.split_once("://").map(|(_, rest)| rest.split(['/', '?', '#']).next().unwrap_or(""))
        .ok_or_else(|| INVALID_URL.to_string())?;
    let url = tauri::Url::parse(raw).map_err(|_| INVALID_URL.to_string())?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some()
        || authority.contains('@') || url.port_or_known_default() != Some(443)
        || !url.host_str().is_some_and(|host| ALLOWED_HOSTS.contains(&host))
        || url.as_str().len() > 8192 {
        return Err(INVALID_URL.into());
    }
    Ok(url.to_string())
}

fn open_with(label: &str, raw: &str, opener: impl FnOnce(&str) -> Result<(), String>) -> Result<(), String> {
    if label != "main" {
        return Err("Źródła licencji można otwierać wyłącznie z głównego okna studia.".into());
    }
    opener(&source_url(raw)?)
}

fn shell_result(code: isize) -> Result<(), String> {
    if code > 32 {
        Ok(())
    } else {
        Err(format!("Windows nie otworzył strony warunków (kod {code}). Sprawdź domyślną przeglądarkę lub skopiuj widoczny odnośnik i otwórz go ręcznie."))
    }
}

fn com_result(code: i32) -> Result<(), String> {
    if code >= 0 { Ok(()) } else {
        Err("Windows nie przygotował otwierania strony warunków. Skopiuj odnośnik i otwórz go ręcznie w przeglądarce.".into())
    }
}

#[cfg(windows)]
fn platform_open(url: &str) -> Result<(), String> {
    use std::{ffi::c_void, ptr::{null, null_mut}};
    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(window: *mut c_void, operation: *const u16, file: *const u16,
                         parameters: *const u16, directory: *const u16, show: i32) -> *mut c_void;
    }
    #[link(name = "ole32")]
    extern "system" {
        fn CoInitializeEx(reserved: *mut c_void, mode: u32) -> i32;
        fn CoUninitialize();
    }
    // ShellExecute may delegate the HTTPS association to a COM component.
    // Initialize this worker explicitly, and balance even S_FALSE (already
    // initialized STA); never uninitialize a failed/incompatible apartment.
    // https://learn.microsoft.com/windows/win32/api/shellapi/nf-shellapi-shellexecutew
    com_result(unsafe { CoInitializeEx(null_mut(), 0x2 | 0x4) })?;
    struct Com;
    impl Drop for Com { fn drop(&mut self) { unsafe { CoUninitialize(); } } }
    let _com = Com;
    let operation: Vec<u16> = "open\0".encode_utf16().collect();
    let target: Vec<u16> = url.encode_utf16().chain(std::iter::once(0)).collect();
    // URL is the single file argument, not a shell command. No cmd.exe,
    // PowerShell, executable path or interpolated command line is accepted.
    let result = unsafe { ShellExecuteW(null_mut(), operation.as_ptr(), target.as_ptr(), null(), null(), 1) };
    shell_result(result as isize)
}

#[cfg(not(windows))]
fn platform_open(_url: &str) -> Result<(), String> {
    Err("Natywne otwieranie źródła licencji jest dostępne w aplikacji Windows.".into())
}

#[tauri::command]
pub async fn open_license_source(window: WebviewWindow, url: String) -> Result<(), String> {
    let label = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || open_with(&label, &url, platform_open))
        .await.map_err(|_| "Przerwano otwieranie strony warunków. Odnośnik możesz skopiować i otworzyć ręcznie.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[test]
    fn accepts_only_reviewed_https_providers_preserving_query_and_fragment() {
        for raw in ["https://github.com/owner/repo/blob/revision/LICENSE?raw=1#terms",
                    "https://huggingface.co/owner/model/blob/main/LICENSE.md",
                    "https://modelscope.cn/models/owner/model/file/view/master/LICENSE"] {
            assert_eq!(source_url(raw).unwrap(), raw);
        }
        assert_eq!(source_url("HTTPS://GITHUB.COM:443/owner/repo").unwrap(), "https://github.com/owner/repo");
    }

    #[test]
    fn rejects_schemes_userinfo_ports_deceptive_hosts_and_controls() {
        for raw in ["", "http://github.com/owner/repo", "file:///C:/Windows/System32/cmd.exe", "javascript:alert(1)",
                    "ms-settings:appsdefaults", "https://github.com.evil.example/license", "https://sub.github.com/license",
                    "https://github.com./license", "https://example.com/?next=https://github.com", "https://127.0.0.1/license",
                    "https://user:pass@github.com/license", "https://user@github.com/license", "https://@github.com/license",
                    "https://github.com:444/license", "https://github.com\\@evil.example/license", "https://github.com/\nlicense",
                    " https://github.com/license", "https://github.com/license\0", "https://github.com/\u{0085}"] {
            assert!(source_url(raw).is_err(), "Unexpectedly allowed {raw:?}");
        }
        assert!(source_url(&format!("https://github.com/{}", "x".repeat(4096))).is_err());
    }

    #[test]
    fn validation_and_window_boundary_never_call_opener() {
        let called = AtomicBool::new(false);
        assert!(open_with("dictation-widget", "https://github.com/owner/repo", |_| { called.store(true, Ordering::SeqCst); Ok(()) }).is_err());
        assert!(open_with("main", "https://foreign.example/license", |_| { called.store(true, Ordering::SeqCst); Ok(()) }).is_err());
        assert!(!called.load(Ordering::SeqCst));
    }

    #[test]
    fn passes_only_validated_url_and_surfaces_system_failure() {
        let result = open_with("main", "HTTPS://GITHUB.COM:443/owner/repo?raw=1#terms", |url| {
            assert_eq!(url, "https://github.com/owner/repo?raw=1#terms");
            Err("controlled opener failure; no browser was opened".into())
        });
        assert_eq!(result.unwrap_err(), "controlled opener failure; no browser was opened");
    }

    #[test]
    fn shell_success_and_failure_codes_do_not_execute_anything() {
        for code in [0, 2, 3, 5, 8, 26, 27, 28, 29, 30, 31, 32] {
            assert!(shell_result(code).unwrap_err().contains("Windows nie otworzył"));
        }
        assert!(shell_result(33).is_ok());
        assert!(shell_result(42).is_ok());
        assert!(com_result(0).is_ok());
        assert!(com_result(1).is_ok());
        assert!(com_result(0x80010106u32 as i32).is_err());
    }
}
