use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, State};

use crate::platform::home_dir;
use crate::TaskManager;

#[derive(Serialize)]
pub struct QuickChatResponse {
    pub response: String,
    pub session_id: String,
}

#[derive(Deserialize)]
pub struct QuickChatSession {
    pub agent: String,
    pub session_path: Option<String>,
}

static QUICK_CHAT_SESSIONS: Mutex<Vec<QuickChatSession>> = Mutex::new(Vec::new());

/// 临时对话 (Quick Chat) — 轻量级临时对话，无需创建项目/任务。
/// 调用 Claude Code CLI 并返回响应。
#[tauri::command]
pub async fn quick_chat(
    app: AppHandle,
    prompt: String,
    session_id: Option<String>,
    agent: String,
) -> Result<QuickChatResponse, String> {
    // 生成或使用已有 session ID
    let sid = session_id.unwrap_or_else(|| {
        format!(
            "quick_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        )
    });

    // 查找已有 session 路径
    let existing_session = QUICK_CHAT_SESSIONS
        .lock()
        .map(|sessions| {
            sessions
                .iter()
                .find(|s| s.agent == agent && s.session_path.is_some())
                .and_then(|s| s.session_path.clone())
        })
        .ok()
        .flatten();

    // 构建 Claude Code 命令
    let agent_bin = crate::app_settings::get_agent_launch_spec(&agent).program;
    let mut cmd = Command::new(&agent_bin);

    if agent == "claude" {
        if let Some(sess_path) = &existing_session {
            // Resume existing session
            cmd.arg("--resume");
            cmd.arg(sess_path);
        }
        cmd.arg("--output-format");
        cmd.arg("text");
        cmd.arg("--print");
        cmd.arg(&prompt);
    } else if agent == "codex" {
        cmd.arg("resume");
        if let Some(sess_path) = &existing_session {
            cmd.arg(sess_path);
        }
        cmd.arg(&prompt);
    }

    // 执行命令
    let output = cmd.output().map_err(|e| format!("Failed to execute agent: {}",e))?;

    let response = if output.status.success() {
        String::from_utf8_lossy(&output.stdout).to_string()
    } else {
        format!(
            "Agent error (exit {}): {}",
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stderr)
        )
    };

    // 保存 session 信息（简化版）
    let _ = QUICK_CHAT_SESSIONS.lock().map(|mut sessions| {
        sessions.retain(|s| s.agent != agent);
        sessions.push(QuickChatSession {
            agent: agent.clone(),
            session_path: Some(format!(
                "{}/.nezha/quick_chat_{}.jsonl",
                home_dir().unwrap_or_default().display(),
                sid
            )),
        });
    });

    Ok(QuickChatResponse {
        response,
        session_id: sid,
    })
}
