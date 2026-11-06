// Maya Ekip — Mac kabuğu.
// Pencerede ekip.mayaajans.net açılır; ekranların güncellemeleri doğrudan siteden gelir.
// Bu kabuk: üst çubuk simgesi, bilgisayar açılınca başlama, arka planda çalışma,
// Mac bildirimi, Dock sayısı ve kendi kendini güncelleme işlerini yapar.

use std::{fs, path::PathBuf, time::Duration};

use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_window_state::StateFlags;

const TRAY_ID: &str = "maya";
const AUTOSTART_ARG: &str = "--acilista";

// ---------- yardımcılar ----------

fn config_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    let _ = fs::create_dir_all(&dir);
    Some(dir)
}

fn flag(app: &AppHandle, name: &str) -> bool {
    config_dir(app).map(|d| d.join(name).exists()).unwrap_or(false)
}

fn set_flag(app: &AppHandle, name: &str, on: bool) {
    if let Some(d) = config_dir(app) {
        let p = d.join(name);
        if on {
            let _ = fs::write(p, b"1");
        } else {
            let _ = fs::remove_file(p);
        }
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Sayfaya masaüstü olayı gönderir (ör. "Yeni iş ekle" penceresini aç).
fn page_event(app: &AppHandle, detail: &str) {
    show_main(app);
    if let Some(w) = app.get_webview_window("main") {
        let js = format!(
            "window.dispatchEvent(new CustomEvent('maya-desktop', {{ detail: {detail} }}))"
        );
        let _ = w.eval(&js);
    }
}

/// Program içinde açılabilecek adres mi? (yükleniyor sayfası + ekip.mayaajans.net)
fn is_internal(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" | "asset" | "about" | "data" | "blob" => true,
        "http" | "https" => matches!(url.host_str(), Some("ekip.mayaajans.net") | Some("tauri.localhost") | Some("localhost")),
        _ => false,
    }
}

/// Dış bağlantıyı (müşteri sitesi, WhatsApp, mailto:…) Mac'in varsayılan uygulamasında aç.
fn open_external(app: &AppHandle, url: &tauri::Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto" | "tel") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

/// İndirilen dosya için İndirilenler klasöründe çakışmayan bir yol: "Logo.png", "Logo (2).png"…
fn download_target(app: &AppHandle, suggested: &std::path::Path, url: &tauri::Url) -> Option<PathBuf> {
    let dir = app.path().download_dir().ok()?;
    let name = suggested
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .or_else(|| url.path_segments().and_then(|mut s| s.next_back().map(|x| x.to_string())))
        .unwrap_or_else(|| "dosya".to_string());
    let p = std::path::Path::new(&name);
    let stem = p.file_stem().map(|x| x.to_string_lossy().to_string()).unwrap_or_else(|| name.clone());
    let ext = p.extension().map(|x| format!(".{}", x.to_string_lossy())).unwrap_or_default();
    let mut path = dir.join(&name);
    let mut i = 2;
    while path.exists() && i < 1000 {
        path = dir.join(format!("{stem} ({i}){ext}"));
        i += 1;
    }
    Some(path)
}

// ---------- sayfanın çağırdığı komutlar ----------

/// Okunmamış bildirim sayısı: üst çubuk simgesinin yanında ve Dock'ta gösterilir.
#[tauri::command]
fn set_unread(app: AppHandle, count: u32) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_title(if count > 0 { Some(count.to_string()) } else { None });
        let tip = if count > 0 {
            format!("Maya Ekip · {count} okunmamış")
        } else {
            "Maya Ekip".to_string()
        };
        let _ = tray.set_tooltip(Some(tip));
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_badge_count(if count > 0 { Some(count as i64) } else { None });
    }
}

/// Mac bildirimi gösterir.
#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) {
    let _ = app.notification().builder().title(title).body(body).show();
}

/// Tema: "dark" / "light" pencerenin başlık çubuğunu da o renge çevirir, "system" Mac ayarına bırakır.
#[tauri::command]
fn set_theme(app: AppHandle, theme: String) {
    if let Some(w) = app.get_webview_window("main") {
        let t = match theme.as_str() {
            "dark" => Some(tauri::Theme::Dark),
            "light" => Some(tauri::Theme::Light),
            _ => None,
        };
        let _ = w.set_theme(t);
    }
}

/// Sayfa, Mac uygulamasında çalıştığını ve kabuk sürümünü buradan öğrenir.
#[tauri::command]
fn app_info(app: AppHandle) -> serde_json::Value {
    serde_json::json!({
        "version": app.package_info().version.to_string(),
        "autostart": app.autolaunch().is_enabled().unwrap_or(false),
    })
}

// ---------- güncelleme ----------

/// Yeni sürüm varsa "neler yeni" notlarını gösterir; kişi "Güncelle" derse indirip kurar ve yeniden başlatır.
async fn check_update(app: AppHandle, manual: bool) {
    let found = match app.updater() {
        Ok(u) => u.check().await,
        Err(e) => Err(e),
    };
    match found {
        Ok(Some(update)) => {
            let version = update.version.clone();
            let notes = update
                .body
                .clone()
                .map(|n| n.trim().to_string())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| "Hata düzeltmeleri ve iyileştirmeler.".to_string());
            let handle = app.clone();
            app.dialog()
                .message(format!(
                    "Neler yeni:\n\n{notes}\n\nGüncelle'ye basınca yeni sürüm indirilir ve Maya Ekip birkaç saniye içinde yeniden açılır."
                ))
                .title(format!("Maya Ekip {version} hazır"))
                .buttons(MessageDialogButtons::OkCancelCustom("Güncelle".into(), "Sonra".into()))
                .show(move |ok| {
                    if !ok {
                        return;
                    }
                    tauri::async_runtime::spawn(async move {
                        match update.download_and_install(|_, _| {}, || {}).await {
                            Ok(()) => handle.restart(),
                            Err(e) => {
                                handle
                                    .dialog()
                                    .message(format!("Güncelleme kurulamadı: {e}\n\nDaha sonra üst çubuktaki menüden \"Güncellemeleri denetle\" ile yeniden deneyebilirsin."))
                                    .title("Güncelleme")
                                    .show(|_| {});
                            }
                        }
                    });
                });
        }
        Ok(None) => {
            if manual {
                app.dialog()
                    .message(format!("Maya Ekip güncel (sürüm {}).", app.package_info().version))
                    .title("Güncelleme")
                    .show(|_| {});
            }
        }
        Err(e) => {
            if manual {
                app.dialog()
                    .message(format!("Güncelleme denetlenemedi: {e}"))
                    .title("Güncelleme")
                    .show(|_| {});
            }
        }
    }
}

// ---------- üst çubuk (menü çubuğu) ----------

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "ac", "Maya Ekip'i aç", true, None::<&str>)?;
    let new_task = MenuItem::with_id(app, "yeni", "Yeni iş ekle…", true, None::<&str>)?;
    let today = MenuItem::with_id(app, "bugun", "Bugün", true, None::<&str>)?;
    let plan = MenuItem::with_id(app, "isler", "İş Planı", true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(
        app,
        "baslat",
        "Bilgisayar açılınca başlat",
        true,
        app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let show_on_start = CheckMenuItem::with_id(
        app,
        "pencere",
        "Açılışta pencereyi göster",
        true,
        !flag(app, "acilista-gizli"),
        None::<&str>,
    )?;
    let update = MenuItem::with_id(app, "guncelle", "Güncellemeleri denetle", true, None::<&str>)?;
    let version = MenuItem::with_id(
        app,
        "surum",
        format!("Sürüm {}", app.package_info().version),
        false,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "cik", "Maya Ekip'ten çık", true, Some("CmdOrCtrl+Q"))?;

    let menu = Menu::with_items(
        app,
        &[
            &open,
            &new_task,
            &PredefinedMenuItem::separator(app)?,
            &today,
            &plan,
            &PredefinedMenuItem::separator(app)?,
            &autostart,
            &show_on_start,
            &update,
            &version,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let autostart_item = autostart.clone();
    let show_item = show_on_start.clone();

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true)
        .tooltip("Maya Ekip")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "ac" => show_main(app),
            "yeni" => page_event(app, "{ action: 'new-task' }"),
            "bugun" => page_event(app, "{ action: 'go', path: '/' }"),
            "isler" => page_event(app, "{ action: 'go', path: '/isler' }"),
            "baslat" => {
                let al = app.autolaunch();
                let on = !al.is_enabled().unwrap_or(false);
                let _ = if on { al.enable() } else { al.disable() };
                let _ = autostart_item.set_checked(al.is_enabled().unwrap_or(on));
            }
            "pencere" => {
                let hidden = !flag(app, "acilista-gizli");
                set_flag(app, "acilista-gizli", hidden);
                let _ = show_item.set_checked(!hidden);
            }
            "guncelle" => {
                let app = app.clone();
                tauri::async_runtime::spawn(check_update(app, true));
            }
            "cik" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

// ---------- uygulama ----------

pub fn run() {
    let app = tauri::Builder::default()
        // ikinci kez açılırsa yeni kopya başlatma, mevcut pencereyi öne getir
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_ARG]),
        ))
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![set_unread, notify, app_info, set_theme])
        .setup(|app| {
            let handle = app.handle().clone();

            // ilk açılışta "bilgisayar açılınca başlat"ı aç (sonra menüden kapatılabilir)
            if !flag(&handle, "kuruldu") {
                let _ = handle.autolaunch().enable();
                set_flag(&handle, "kuruldu", true);
            }

            let from_login = std::env::args().any(|a| a == AUTOSTART_ARG);
            let visible = !(from_login && flag(&handle, "acilista-gizli"));

            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Maya Ekip")
                .inner_size(1320.0, 840.0)
                .min_inner_size(960.0, 620.0)
                .center()
                .visible(visible)
                .on_navigation({
                    let app = handle.clone();
                    move |url| {
                        if is_internal(url) { return true; }
                        open_external(&app, url);
                        false
                    }
                })
                .on_new_window({
                    let app = handle.clone();
                    move |url, _features| {
                        open_external(&app, &url);
                        tauri::webview::NewWindowResponse::Deny
                    }
                })
                .on_download({
                    let app = handle.clone();
                    move |_webview, event| {
                        match event {
                            tauri::webview::DownloadEvent::Requested { url, destination } => {
                                if let Some(p) = download_target(&app, destination, &url) {
                                    *destination = p;
                                }
                            }
                            tauri::webview::DownloadEvent::Finished { success, .. } => {
                                let body = if success { "Dosya İndirilenler klasörüne kaydedildi." } else { "Dosya indirilemedi." };
                                let _ = app.notification().builder().title("İndirme").body(body).show();
                            }
                            _ => {}
                        }
                        true
                    }
                })
                .build()?;

            // kapat düğmesi programı kapatmaz, arka plana alır
            let w = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = w.hide();
                }
            });

            build_tray(&handle)?;

            // açılışta ve 6 saatte bir güncelleme denetimi
            let up = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(20));
                loop {
                    tauri::async_runtime::block_on(check_update(up.clone(), false));
                    std::thread::sleep(Duration::from_secs(6 * 60 * 60));
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Maya Ekip başlatılamadı");

    app.run(|app, event| {
        // Dock simgesine tıklanınca pencereyi geri getir
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            show_main(app);
        }
        let _ = (&app, &event);
    });
}
