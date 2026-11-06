fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["set_unread", "notify", "app_info", "set_theme", "open_ai", "ai_show", "ai_hide", "shots_status", "shots_enable", "shots_list", "shots_thumb", "shots_read", "shots_copy", "shots_reveal", "shots_open", "shots_trash", "shots_save_as", "shots_set_cleanup", "wa_notify", "wa_open"]),
        ),
    )
    .expect("tauri build betiği çalışmadı");
}
