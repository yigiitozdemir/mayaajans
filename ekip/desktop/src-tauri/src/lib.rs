// Maya Ekip — Mac kabuğu.
// Pencerede ekip.mayaajans.net açılır; ekranların güncellemeleri doğrudan siteden gelir.
// Bu kabuk: üst çubuk simgesi, bilgisayar açılınca başlama, arka planda çalışma,
// Mac bildirimi, Dock sayısı ve kendi kendini güncelleme işlerini yapar.

mod ekran;

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

pub(crate) fn config_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    let _ = fs::create_dir_all(&dir);
    Some(dir)
}

pub(crate) fn flag(app: &AppHandle, name: &str) -> bool {
    config_dir(app).map(|d| d.join(name).exists()).unwrap_or(false)
}

pub(crate) fn set_flag(app: &AppHandle, name: &str, on: bool) {
    if let Some(d) = config_dir(app) {
        let p = d.join(name);
        if on {
            let _ = fs::write(p, b"1");
        } else {
            let _ = fs::remove_file(p);
        }
    }
}

// Not: ana pencereye ChatGPT / Claude / WhatsApp görünümleri eklenince Tauri onu artık "tek görünümlü pencere"
// saymaz ve get_webview_window("main") None döner. Bu yüzden pencere ve görünüm her yerde AYRI alınır.
fn main_window(app: &AppHandle) -> Option<tauri::Window> { app.get_window("main") }
fn main_webview(app: &AppHandle) -> Option<tauri::Webview> { app.get_webview("main") }

fn show_main(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Sayfaya pencereyi öne getirmeden olay gönderir (ör. yeni ekran görüntüsü).
pub(crate) fn page_emit(app: &AppHandle, detail: &str) {
    if let Some(w) = main_webview(app) {
        let js = format!("window.dispatchEvent(new CustomEvent('maya-desktop', {{ detail: {detail} }}))");
        let _ = w.eval(&js);
    }
}

/// Sayfaya masaüstü olayı gönderir (ör. "Yeni iş ekle" penceresini aç).
fn page_event(app: &AppHandle, detail: &str) {
    show_main(app);
    if let Some(w) = main_webview(app) {
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

/// İndirme: İndirilenler klasörüne (çakışmayan adla) kaydet, bitince bildir.
fn handle_download(app: &AppHandle, event: tauri::webview::DownloadEvent<'_>) -> bool {
    match event {
        tauri::webview::DownloadEvent::Requested { url, destination } => {
            if let Some(p) = download_target(app, destination, &url) {
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

// ---------- Yapay Zekâ: ChatGPT ve Claude, kişinin kendi hesabıyla ----------
// Bu pencerelerin programın komutlarına HİÇBİR erişimi yoktur (yetki dosyası yalnızca "main" penceresine izin verir).

const SAFARI_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";

/// Giriş (OAuth) pencereleri programın içinde açılsın; diğer dış bağlantılar tarayıcıda.
fn is_auth_or_ai_host(url: &tauri::Url) -> bool {
    let h = url.host_str().unwrap_or("");
    let ends = |d: &str| h == d || h.ends_with(&format!(".{d}"));
    ["chatgpt.com", "openai.com", "claude.ai", "anthropic.com", "accounts.google.com", "appleid.apple.com",
     "login.microsoftonline.com", "login.live.com", "auth0.com", "oaistatic.com", "oaiusercontent.com",
     "whatsapp.com", "whatsapp.net"]
        .iter()
        .any(|d| ends(d))
}

fn open_ai_window(app: &AppHandle, which: &str) -> tauri::Result<()> {
    let (label, title, url) = match which {
        "chatgpt" => ("ai-chatgpt", "ChatGPT · Maya Ekip", "https://chatgpt.com/"),
        "claude" => ("ai-claude", "Claude · Maya Ekip", "https://claude.ai/new"),
        _ => return Ok(()),
    };
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let ext = app.clone();
    let dl = app.clone();
    WebviewWindowBuilder::new(app, label, WebviewUrl::External(url.parse().expect("geçerli adres")))
        .title(title)
        .inner_size(1180.0, 820.0)
        .min_inner_size(640.0, 520.0)
        .user_agent(SAFARI_UA)
        .on_new_window(move |url, _features| {
            if is_auth_or_ai_host(&url) {
                tauri::webview::NewWindowResponse::Allow
            } else {
                open_external(&ext, &url);
                tauri::webview::NewWindowResponse::Deny
            }
        })
        .on_download(move |_webview, event| handle_download(&dl, event))
        .build()?;
    Ok(())
}

/// Panelin içinde (sol menü yerinde kalır): ChatGPT / Claude, ana pencerenin içerik alanına yerleşen ayrı bir görünüm.
/// Konum ve boyut sayfadan gelir (içerik alanının dikdörtgeni, mantıksal piksel).
const AI_EMBED: [(&str, &str, &str); 3] = [
    ("chatgpt", "ai-in-chatgpt", "https://chatgpt.com/"),
    ("claude", "ai-in-claude", "https://claude.ai/new"),
    ("whatsapp", "ai-in-whatsapp", "https://web.whatsapp.com/"),
];

/// Uygulama sekmesinin başlığındaki okunmamış sayısı: "(3) WhatsApp" → 3
fn unread_from_title(title: &str) -> u32 {
    let t = title.trim_start();
    if let Some(rest) = t.strip_prefix('(') {
        if let Some(end) = rest.find(')') {
            return rest[..end].trim().parse().unwrap_or(0);
        }
    }
    0
}

static APP_UNREAD: std::sync::Mutex<Vec<(String, u32)>> = std::sync::Mutex::new(Vec::new());
/// Şu an panelde görünen uygulama ("" = hiçbiri)
static VISIBLE_APP: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());
/// Görünen uygulamanın sol/üst boşluğu (sol menü genişliği, üst boşluk)
static LAYOUT: std::sync::Mutex<(f64, f64)> = std::sync::Mutex::new((0.0, 0.0));

/// Okunmamış sayısı değişince menüye bildirir; arttıysa ve program önde değilse Mac bildirimi gönderir.
fn on_app_title(app: &AppHandle, which: &str, title: &str) {
    let n = unread_from_title(title);
    let prev = {
        let mut m = APP_UNREAD.lock().unwrap();
        let prev = m.iter().find(|(k, _)| k == which).map(|(_, v)| *v).unwrap_or(0);
        m.retain(|(k, _)| k != which);
        m.push((which.to_string(), n));
        prev
    };
    if n == prev {
        return;
    }
    page_emit(app, &format!("{{ action: 'app-unread', app: '{which}', count: {n} }}"));
    if n > prev && which == "whatsapp" {
        let focused = main_window(app).and_then(|w| w.is_focused().ok()).unwrap_or(false);
        let showing = VISIBLE_APP.lock().map(|v| v.as_str() == "whatsapp").unwrap_or(false);
        if !(focused && showing) {
            let _ = app.notification().builder().title("WhatsApp").body(format!("{n} okunmamış mesaj")).show();
        }
    }
}

/// Uygulama görünümünü oluşturur (gizli ya da görünür).
fn create_app_view(app: &AppHandle, which: &str, label: &str, url: &str, pos: tauri::LogicalPosition<f64>, size: tauri::LogicalSize<f64>, bg: tauri::window::Color) -> Result<tauri::Webview, String> {
    let window = main_window(app).ok_or("ana pencere yok")?;
    let ext = app.clone();
    let dl = app.clone();
    let tt = app.clone();
    let which_s = which.to_string();
    let builder = tauri::webview::WebviewBuilder::new(label, WebviewUrl::External(url.parse().map_err(|_| "adres")?))
        .user_agent(SAFARI_UA)
        .background_color(bg)
        .on_new_window(move |url, _features| {
            if is_auth_or_ai_host(&url) {
                tauri::webview::NewWindowResponse::Allow
            } else {
                open_external(&ext, &url);
                tauri::webview::NewWindowResponse::Deny
            }
        })
        .on_download(move |_webview, event| handle_download(&dl, event))
        .on_document_title_changed(move |_w, title| on_app_title(&tt, &which_s, &title));
    window.add_child(builder, pos, size).map_err(|e| e.to_string())
}

/// WhatsApp bir kez açıldıysa program açılınca arka planda bağlansın (mesajlar ve bildirimler gelsin).
fn preload_whatsapp(app: &AppHandle) {
    if !flag(app, "whatsapp-acik") || app.get_webview("ai-in-whatsapp").is_some() {
        return;
    }
    if let Ok(v) = create_app_view(app, "whatsapp", "ai-in-whatsapp", "https://web.whatsapp.com/",
        tauri::LogicalPosition::new(-20000.0, -20000.0), tauri::LogicalSize::new(800.0, 600.0), tauri::window::Color(244, 241, 236, 255)) {
        park(&v);
    }
}

#[tauri::command]
async fn ai_show(app: AppHandle, which: String, x: f64, y: f64, w: f64, h: f64, dark: Option<bool>) -> Result<serde_json::Value, String> {
    let _ = (w, h); // ölçü artık pencerenin gerçek iç boyutundan hesaplanıyor (sayfanın ölçüsü yalnızca yedek)
    let Some(&(_, label, url)) = AI_EMBED.iter().find(|(id, _, _)| *id == which) else {
        return Err("bilinmeyen".into());
    };
    for (_, other, _) in AI_EMBED.iter() {
        if *other != label {
            if let Some(v) = app.get_webview(other) {
                park(&v);
            }
        }
    }
    if let Ok(mut v) = VISIBLE_APP.lock() { *v = which.clone(); }
    if let Ok(mut l) = LAYOUT.lock() { *l = (x.max(0.0), y.max(0.0)); }
    let (pos, size, info) = app_rect(&app, x, y, w, h);
    // yüklenirken beyaz parlama olmasın: zemin programın temasıyla aynı
    let bg = if dark.unwrap_or(false) { tauri::window::Color(26, 21, 18, 255) } else { tauri::window::Color(244, 241, 236, 255) };
    if let Some(v) = app.get_webview(label) {
        let _ = v.set_background_color(Some(bg));
        let _ = v.set_position(pos);
        let _ = v.set_size(size);
        let _ = v.show();
        let _ = v.set_focus();
        return Ok(info);
    }
    if which == "whatsapp" {
        set_flag(&app, "whatsapp-acik", true);
    }
    let v = create_app_view(&app, &which, label, url, pos, size, bg)?;
    let _ = v.set_position(pos); // bazı macOS sürümlerinde ilk konum uygulanmayabiliyor
    let _ = v.set_size(size);
    let _ = v.set_focus();
    Ok(info)
}

/// Uygulamanın yeri: sol menünün sağı (x) ve sayfanın üst boşluğu (y); genişlik/yükseklik pencerenin GERÇEK iç
/// boyutundan (mantıksal nokta) hesaplanır. Böylece sayfa ölçüsüyle yerel pencere ölçüsü farkı kaymaya yol açmaz.
fn app_rect(app: &AppHandle, x: f64, y: f64, w: f64, h: f64) -> (tauri::LogicalPosition<f64>, tauri::LogicalSize<f64>, serde_json::Value) {
    let x = x.max(0.0);
    let y = y.max(0.0);
    let win = main_window(app).and_then(|win| {
        let sf = win.scale_factor().ok()?;
        let sz = win.inner_size().ok()?.to_logical::<f64>(sf);
        Some((sz.width, sz.height, sf))
    });
    let (ww, hh, sf) = win.unwrap_or((x + w, y + h, 1.0));
    let width = (ww - x).max(200.0);
    let height = (hh - y).max(200.0);
    let info = serde_json::json!({ "window": [ww, hh], "scale": sf, "rect": [x, y, width, height], "page": [x, y, w, h] });
    (tauri::LogicalPosition::new(x, y), tauri::LogicalSize::new(width, height), info)
}

/// Pencere boyutu değişince görünen uygulamayı anında yeniden yerleştir (sayfanın haber vermesini beklemeden).
fn relayout_visible(app: &AppHandle) {
    let which = VISIBLE_APP.lock().map(|v| v.clone()).unwrap_or_default();
    if which.is_empty() { return; }
    let Some(&(_, label, _)) = AI_EMBED.iter().find(|(id, _, _)| *id == which) else { return };
    let (x, y) = LAYOUT.lock().map(|l| *l).unwrap_or((0.0, 0.0));
    let (pos, size, _) = app_rect(app, x, y, 0.0, 0.0);
    if let Some(v) = app.get_webview(label) {
        let _ = v.set_position(pos);
        let _ = v.set_size(size);
    }
}

/// Başka sayfaya geçilince ya da üstte bir pencere (profil, iş detayı, bildirimler) açılınca gizle; sohbet kaybolmaz.
#[tauri::command]
async fn ai_hide(app: AppHandle) {
    if let Ok(mut v) = VISIBLE_APP.lock() { v.clear(); }
    for (_, label, _) in AI_EMBED.iter() {
        if let Some(v) = app.get_webview(label) {
            park(&v);
        }
    }
}

/// Gizle ve ekranın çok dışına taşı: gizleme tam çalışmasa bile tıklamaların önüne geçmesin.
fn park(v: &tauri::Webview) {
    let _ = v.hide();
    let _ = v.set_position(tauri::LogicalPosition::new(-20000.0, -20000.0));
}

/// Sayfadaki "Ayrı pencerede aç" düğmesi.
#[tauri::command]
fn open_ai(app: AppHandle, which: String) -> Result<(), String> {
    open_ai_window(&app, &which).map_err(|e| e.to_string())
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
    if let Some(w) = main_window(&app) {
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
    if let Some(w) = main_window(&app) {
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
    let chatgpt = MenuItem::with_id(app, "chatgpt", "ChatGPT", true, None::<&str>)?;
    let claude = MenuItem::with_id(app, "claude", "Claude", true, None::<&str>)?;
    let whatsapp = MenuItem::with_id(app, "whatsapp", "WhatsApp", true, None::<&str>)?;
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
            &chatgpt,
            &claude,
            &whatsapp,
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
            "chatgpt" => page_event(app, "{ action: 'go', path: '/yapay-zeka?ai=chatgpt' }"),
            "claude" => page_event(app, "{ action: 'go', path: '/yapay-zeka?ai=claude' }"),
            "whatsapp" => page_event(app, "{ action: 'go', path: '/yapay-zeka?ai=whatsapp' }"),
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
        .invoke_handler(tauri::generate_handler![
            set_unread, notify, app_info, set_theme, open_ai, ai_show, ai_hide,
            ekran::shots_status, ekran::shots_enable, ekran::shots_list, ekran::shots_thumb, ekran::shots_read,
            ekran::shots_copy, ekran::shots_reveal, ekran::shots_open, ekran::shots_trash, ekran::shots_save_as,
            ekran::shots_set_cleanup
        ])
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
                .auto_resize() // içine uygulama görünümleri eklense de pencereyle birlikte boyutlansın
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
                    move |_webview, event| handle_download(&app, event)
                })
                .build()?;

            // kapat düğmesi programı kapatmaz, arka plana alır
            let w = window.clone();
            let rl = handle.clone();
            window.on_window_event(move |event| match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = w.hide();
                }
                WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => relayout_visible(&rl),
                _ => {}
            });

            build_tray(&handle)?;
            ekran::start_watcher(handle.clone());
            // WhatsApp'ı arka planda bağla (sayfa yüklendikten biraz sonra)
            let wa = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(4));
                preload_whatsapp(&wa); // add_child kendisi ana iş parçacığında çalıştırır
            });

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
