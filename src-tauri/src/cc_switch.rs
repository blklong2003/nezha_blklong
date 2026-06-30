use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CcSwitchProvider {
    pub id: String,
    pub name: String,
}

fn cc_switch_db_path() -> Option<std::path::PathBuf> {
    let home = crate::platform::home_dir()?;
    let path = home.join(".cc-switch").join("cc-switch.db");
    path.exists().then_some(path)
}

/// 从 cc-switch SQLite 读取指定 agent 类型的 provider 列表。
/// cc-switch 未安装或 DB 不存在时返回空列表。
fn list_providers(agent: &str) -> Vec<CcSwitchProvider> {
    let db_path = match cc_switch_db_path() {
        Some(p) => p,
        None => return vec![],
    };

    let conn = match rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let app_type = agent_to_app_type(agent);

    let mut stmt = match conn.prepare(
        "SELECT id, name FROM providers WHERE app_type = ?1 AND json_extract(settings_config, '$.env') IS NOT NULL ORDER BY sort_index ASC, name ASC",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    let rows = stmt.query_map([app_type], |row| {
        Ok(CcSwitchProvider {
            id: row.get(0)?,
            name: row.get(1)?,
        })
    });

    match rows {
        Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
        Err(_) => vec![],
    }
}

/// 读取指定 provider 的 env 变量，供 pty.rs 在进程启动时注入。
/// 返回 None 表示找不到该 provider 或无可用 env 变量。
pub fn get_provider_env(provider_id: &str, agent: &str) -> Option<Vec<(String, String)>> {
    let db_path = cc_switch_db_path()?;

    let conn = rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;

    let app_type = agent_to_app_type(agent);

    let settings_json: String = conn
        .query_row(
            "SELECT settings_config FROM providers WHERE id = ?1 AND app_type = ?2",
            [provider_id, app_type],
            |row| row.get(0),
        )
        .ok()?;

    let settings: Value = serde_json::from_str(&settings_json).ok()?;
    let env_map = settings.get("env")?.as_object()?;

    let vars: Vec<(String, String)> = env_map
        .iter()
        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_owned())))
        .filter(|(_, v)| !v.is_empty())
        .collect();

    if vars.is_empty() {
        None
    } else {
        Some(vars)
    }
}

fn agent_to_app_type(agent: &str) -> &str {
    match agent {
        "codex" => "codex",
        _ => "claude",
    }
}

#[tauri::command]
pub fn list_cc_switch_providers(agent: String) -> Vec<CcSwitchProvider> {
    list_providers(&agent)
}
