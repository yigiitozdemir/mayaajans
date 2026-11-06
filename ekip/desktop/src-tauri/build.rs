fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["set_unread", "notify", "app_info", "set_theme", "open_ai", "ai_show", "ai_hide"]),
        ),
    )
    .expect("tauri build betiği çalışmadı");
}
