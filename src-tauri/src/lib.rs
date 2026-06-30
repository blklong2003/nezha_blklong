use parking_lot::Mutex;
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::Write;
use std::sync::Arc;

use usage::CodexRpcClient;

mod agent_assist;
mod analytics;
mod app_settings;
mod cc_switch;
mod config;
mod event_watcher;
mod feishu;
mod fs;
mod git;
mod hooks;
mod notification;
mod platform;
mod push;
mod pty;
mod session;
mod skills;
mod storage;
mod subprocess;
mod usage;

use session::{ClaudeSessionInfo, CodexSessionInfo};

pub struct TaskManager {
    pub(crate) pty_masters: Mutex<HashMap<String, Box<dyn portable_pty::MasterPty + Send>>>,
    pub(crate) pty_writers: Mutex<HashMap<String, Box<dyn Write + Send>>>,
    pub(crate) child_handles:
        Mutex<HashMap<String, Arc<std::sync::Mutex<Box<dyn portable_pty::Child + Send + Sync>>>>>,
    pub(crate) cancelled_tasks: Mutex<HashSet<String>>,
    pub(crate) manually_completed_tasks: Mutex<HashSet<String>>,
    /// Paused flag — exit monitor skips cleanup, keeps session for future resume.
    pub(crate) paused_tasks: Mutex<HashSet<String>>,
    pub(crate) codex_sessions: Mutex<HashMap<String, CodexSessionInfo>>,
    pub(crate) claude_sessions: Mutex<HashMap<String, ClaudeSessionInfo>>,
    pub(crate) claimed_session_paths: Mutex<HashSet<String>>,
    /// Persistent `codex app-server` process reused across `read_usage_snapshot` calls.
    pub(crate) codex_rpc: Arc<Mutex<Option<CodexRpcClient>>>,
    /// Remote panel: output ring-buffer per task. (task_id → (next_seq, chunks))
    pub(crate) task_output: Mutex<HashMap<String, (u64, VecDeque<(u64, String)>)>>,
    /// Remote panel: human-readable label derived from the task prompt.
    pub(crate) task_labels: Mutex<HashMap<String, String>>,
}

impl TaskManager {
    /// Atomically remove a task/shell from all PTY maps (masters, writers, children).
    /// Locks are acquired in a fixed order to prevent deadlocks.
    pub(crate) fn remove_pty_handles(&self, id: &str) {
        let mut masters = self.pty_masters.lock();
        let mut writers = self.pty_writers.lock();
        let mut children = self.child_handles.lock();
        masters.remove(id);
        writers.remove(id);
        children.remove(id);
    }
}

/// macOS: hide main window to Dock instead of quitting.
///
/// Fullscreen windows own a separate Space; hiding while fullscreen leaves a black
/// Space behind. Must exit fullscreen first (async + animated), poll for completion,
/// then issue staggered hides so one lands after the Space collapses.
/// See tauri-apps/tauri#12056, electron/electron#20263.
#[cfg(target_os = "macos")]
fn hide_window_to_dock(window: tauri::Window) {
    use std::time::Duration;
    if !window.is_fullscreen().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    let _ = window.set_fullscreen(false);
    std::thread::spawn(move || {
        let mut exited = false;
        for _ in 0..100 {
            std::thread::sleep(Duration::from_millis(50));
            if !window.is_fullscreen().unwrap_or(false) {
                exited = true;
                break;
            }
        }
        if !exited {
            return;
        }
        for _ in 0..8 {
            std::thread::sleep(Duration::from_millis(120));
            let _ = window.hide();
        }
    });
}

/// Frontend Cmd+W sends this command; same hide logic as close button.
/// Only macOS has actual behavior (frontend won't trigger on other platforms).
#[tauri::command]
fn hide_main_window(window: tauri::Window) {
    #[cfg(target_os = "macos")]
    hide_window_to_dock(window);
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Warm up login shell path in background
            std::thread::spawn(|| {
                crate::app_settings::get_login_shell_path();
            });
            // Install hook scripts and inject user-level config
            std::thread::spawn(|| {
                crate::hooks::cache_status(crate::hooks::ensure_installed());
                let _ = crate::hooks::regenerate_claude_settings();
            });
            // Start hook event file watcher
            crate::event_watcher::start(app.handle().clone());
            // Start Feishu bot (reads existing config, skips silently if not configured)
            crate::feishu::start(app.handle().clone());
            // Initialize Web Push (load/generate VAPID keys, load stored subscriptions)
            {
                use tauri::Manager;
                crate::push::init(app.path().app_data_dir().ok());
            }
            // Windows system tray
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                use tauri::tray::TrayIconBuilder;
                use tauri::menu::{Menu, MenuItem};
                let show_item = MenuItem::with_id(app, "show", "显示 NeZha", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;
                let tray = TrayIconBuilder::new()
                    .icon(
                        app.default_window_icon()
                            .ok_or("no default window icon set")?
                            .clone(),
                    )
                    .menu(&tray_menu)
                    .tooltip("NeZha")
                    .on_menu_event(|app, event| {
                        use tauri::Manager;
                        match event.id.as_ref() {
                            "show" => {
                                if let Some(w) = app.get_webview_window("main") {
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                }
                            }
                            "quit" => std::process::exit(0),
                            _ => {}
                        }
                    })
                    .on_tray_icon_event(|tray, event| {
                        use tauri::Manager;
                        if let tauri::tray::TrayIconEvent::Click { button, .. } = event {
                            if matches!(button, tauri::tray::MouseButton::Left) {
                                let app = tray.app_handle();
                                if let Some(w) = app.get_webview_window("main") {
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                }
                            }
                        }
                    })
                    .build(app)?;
                app.handle().manage(tray);
            }
            Ok(())
        })
        .manage(TaskManager {
            pty_masters: Mutex::new(HashMap::new()),
            pty_writers: Mutex::new(HashMap::new()),
            child_handles: Mutex::new(HashMap::new()),
            cancelled_tasks: Mutex::new(HashSet::new()),
            manually_completed_tasks: Mutex::new(HashSet::new()),
            paused_tasks: Mutex::new(HashSet::new()),
            codex_sessions: Mutex::new(HashMap::new()),
            claude_sessions: Mutex::new(HashMap::new()),
            claimed_session_paths: Mutex::new(HashSet::new()),
            codex_rpc: Arc::new(Mutex::new(None)),
            task_output: Mutex::new(HashMap::new()),
            task_labels: Mutex::new(HashMap::new()),
        })
        .on_window_event(|window, event| {
            // macOS: hide to Dock on close (same as Cmd+W).
            // Windows: hide to tray; re-show via tray icon.
            // Other platforms: keep default quit behavior.
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                hide_window_to_dock(window.clone());
                api.prevent_close();
            }
            #[cfg(target_os = "windows")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            let _ = (window, event);
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            hide_main_window,
            pty::run_task,
            pty::resume_task,
            pty::cancel_task,
            pty::complete_task,
            pty::pause_task,
            pty::get_active_task_ids,
            pty::reset_task_process,
            pty::send_input,
            pty::resize_pty,
            pty::open_shell,
            pty::kill_shell,
            fs::read_dir_entries,
            fs::open_in_system_file_manager,
            fs::read_file_content,
            fs::read_image_preview,
            fs::write_file_content,
            fs::create_file,
            fs::create_directory,
            fs::delete_path,
            fs::list_project_files,
            fs::search_project_files,
            git::generate_commit_message,
            agent_assist::generate_task_name,
            feishu::configure_feishu_bot,
            feishu::get_remote_server_port,
            feishu::get_remote_token,
            git::git_status,
            git::git_list_branches,
            git::git_create_branch,
            git::git_checkout_branch,
            git::git_log,
            git::git_commit_detail,
            git::git_show_diff,
            git::git_show_file_diff,
            git::git_file_diff,
            git::git_stage,
            git::git_unstage,
            git::git_stage_files,
            git::git_unstage_files,
            git::git_stage_all,
            git::git_unstage_all,
            git::git_commit,
            git::git_discard_file,
            git::git_discard_files,
            git::git_discard_all,
            git::git_push,
            git::git_pull,
            git::git_remote_counts,
            git::create_task_worktree,
            git::merge_task_worktree,
            git::remove_task_worktree,
            git::worktree_diff_stats,
            analytics::read_session_metrics,
            session::resolve_session_path,
            session::read_session_messages,
            session::export_session_markdown,
            config::init_project_config,
            config::read_project_config,
            config::write_project_config,
            config::get_agent_config_file_path,
            config::read_agent_config_file,
            config::write_agent_config_file,
            storage::load_projects,
            storage::save_projects,
            storage::load_project_tasks,
            storage::save_project_tasks,
            app_settings::load_app_settings,
            app_settings::save_app_settings,
            app_settings::save_agent_paths,
            app_settings::save_send_shortcut,
            app_settings::save_shift_enter_newline,
            app_settings::save_claude_force_default_tui,
            app_settings::save_terminal_scrollback,
            app_settings::detect_agent_paths,
            app_settings::detect_agent_versions_for_settings,
            app_settings::get_system_fonts,
            notification::get_notifications,
            notification::mark_notification_read,
            notification::mark_all_notifications_read,
            usage::read_usage_snapshot,
            hooks::get_hook_status,
            hooks::get_hook_readiness,
            hooks::install_hooks,
            hooks::uninstall_hooks,
            skills::get_skill_hub_config,
            skills::set_skill_hub_path,
            skills::clear_skill_hub,
            skills::list_skills,
            skills::list_skill_installations,
            skills::install_skill,
            skills::uninstall_skill,
            skills::cleanup_installations_for_project,
            skills::delete_skill,
            cc_switch::list_cc_switch_providers,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app_handle, _event| {
            // macOS: when window is hidden (Cmd+W), clicking Dock icon triggers Reopen.
            // Need to manually show and focus the main window.
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                if let tauri::RunEvent::Reopen { .. } = _event {
                    if let Some(window) = _app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        });
}