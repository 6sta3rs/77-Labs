use rusqlite::{Connection, OpenFlags};
use serde_json::{Map, Value};
use std::{fs, path::PathBuf, time::UNIX_EPOCH};

fn data_dir() -> Result<PathBuf, String> {
    crate::runtime::active_data_dir()
}

// Read only our private database. Never create a DB, migrate it, or open the old installation.
#[tauri::command]
pub async fn library_profiles() -> Result<Vec<Value>, String> {
    tauri::async_runtime::spawn_blocking(read_profiles)
        .await
        .map_err(|e| e.to_string())?
}

pub(crate) fn read_profiles() -> Result<Vec<Value>, String> {
    let root = data_dir()?;
    let path = root.join("omnivoice.db");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Nie można odczytać biblioteki głosów: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_secs(2))
        .map_err(|e| e.to_string())?;
    let mut query = conn
        .prepare("SELECT * FROM voice_profiles ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = query
        .query_map([], |row| {
            let mut record = Map::new();
            for (index, name) in row.as_ref().column_names().iter().enumerate() {
                use rusqlite::types::ValueRef;
                let value = match row.get_ref(index)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(value) => Value::from(value),
                    ValueRef::Real(value) => Value::from(value),
                    ValueRef::Text(value) => Value::from(String::from_utf8_lossy(value).as_ref()),
                    ValueRef::Blob(_) => Value::Null,
                };
                record.insert((*name).to_owned(), value);
            }
            let id = record.get("id").and_then(Value::as_str).unwrap_or_default();
            let image_url = safe_id(&id)
                .then(|| root.join("voices").join(format!("{id}.portrait.jpg")))
                .and_then(|p| fs::metadata(p).ok())
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|t| format!("/profiles/{id}/image?v={}", t.as_nanos()));
            record.insert(
                "image_url".into(),
                image_url.map(Value::from).unwrap_or(Value::Null),
            );
            Ok(Value::Object(record))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[tauri::command]
pub async fn library_portrait(id: String) -> Result<tauri::ipc::Response, String> {
    if !safe_id(&id) {
        return Err("Nieprawidłowy identyfikator głosu".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let root = data_dir()?
            .join("voices")
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let path = root
            .join(format!("{id}.portrait.jpg"))
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if !path.starts_with(&root)
            || fs::metadata(&path).map_err(|e| e.to_string())?.len() > 8 * 1024 * 1024
        {
            return Err("Niedostępny portret głosu".into());
        }
        fs::read(path)
            .map(tauri::ipc::Response::new)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn profile_ids_cannot_escape_library() {
        for id in ["../secret", "a/b", "a\\b", "", "C:", ".."] {
            assert!(!safe_id(id));
        }
        assert!(safe_id("voice-a1_23"));
    }
}
