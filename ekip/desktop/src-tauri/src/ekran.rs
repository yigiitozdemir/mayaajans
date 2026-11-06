// Ekran görüntüleri: Mac'in ekran görüntüsü klasörünü masaüstü yerine "Resimler/Maya Ekran Görüntüleri" yapar,
// klasörü izler ve programdaki "Ekran Görüntüleri" bölümüne verir. Dosyalar YALNIZCA bu Mac'te kalır; sunucuya gitmez.

use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::{config_dir, flag, page_emit, set_flag};

const FOLDER: &str = "Maya Ekran Görüntüleri";
const ON: &str = "ekran-acik";
const CLEANUP: &str = "ekran-temizlik";
const PREV: &str = "ekran-eski-konum";
const CLEANUP_DAYS: u64 = 30;

#[derive(Serialize)]
pub struct Shot {
    name: String,
    size: u64,
    at: u64, // ms
    kind: &'static str, // image | video
}

fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().picture_dir().map(|d| d.join(FOLDER)).map_err(|e| e.to_string())
}

fn kind_of(p: &Path) -> Option<&'static str> {
    let ext = p.extension()?.to_string_lossy().to_lowercase();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "heic" | "gif" | "tiff" => Some("image"),
        "mov" | "mp4" => Some("video"),
        _ => None,
    }
}

/// Yalnızca klasördeki bir dosya adı kabul edilir (yol geçişi yok).
fn safe(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.starts_with('.') {
        return Err("geçersiz dosya".into());
    }
    let p = folder(app)?.join(name);
    if !p.is_file() {
        return Err("dosya bulunamadı".into());
    }
    Ok(p)
}

fn mtime_ms(p: &Path) -> u64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn list(app: &AppHandle) -> Vec<Shot> {
    let Ok(dir) = folder(app) else { return vec![] };
    let Ok(rd) = fs::read_dir(&dir) else { return vec![] };
    let mut v: Vec<Shot> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || !p.is_file() {
                return None;
            }
            let kind = kind_of(&p)?;
            let size = e.metadata().map(|m| m.len()).unwrap_or(0);
            Some(Shot { name, size, at: mtime_ms(&p), kind })
        })
        .collect();
    v.sort_by(|a, b| b.at.cmp(&a.at));
    v.truncate(3000);
    v
}

/// Mac'in şu anki ekran görüntüsü kayıt yeri (ayar yoksa masaüstü).
fn system_location() -> Option<String> {
    let out = Command::new("defaults").args(["read", "com.apple.screencapture", "location"]).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

fn refresh_system_ui() {
    let _ = Command::new("killall").arg("SystemUIServer").status();
}

fn status(app: &AppHandle) -> serde_json::Value {
    let dir = folder(app).map(|d| d.display().to_string()).unwrap_or_default();
    let loc = system_location();
    serde_json::json!({
        "enabled": flag(app, ON),
        "active": loc.as_deref() == Some(dir.as_str()),
        "cleanup": flag(app, CLEANUP),
        "cleanupDays": CLEANUP_DAYS,
        "folder": dir,
        "systemLocation": loc.unwrap_or_else(|| "Masaüstü".into()),
    })
}

#[tauri::command]
pub async fn shots_status(app: AppHandle) -> serde_json::Value {
    status(&app)
}

/// Aç: ekran görüntüleri masaüstü yerine programın klasörüne. Kapat: eski yere geri döner.
#[tauri::command]
pub async fn shots_enable(app: AppHandle, on: bool) -> Result<serde_json::Value, String> {
    let dir = folder(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dir_s = dir.display().to_string();
    let prev_file = config_dir(&app).map(|d| d.join(PREV));
    if on {
        if !flag(&app, ON) {
            let prev = system_location().filter(|p| p != &dir_s).unwrap_or_default();
            if let Some(f) = &prev_file {
                let _ = fs::write(f, prev);
            }
        }
        let ok = Command::new("defaults")
            .args(["write", "com.apple.screencapture", "location", &dir_s])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !ok {
            return Err("Mac ayarı değiştirilemedi".into());
        }
        set_flag(&app, ON, true);
    } else {
        let prev = prev_file.as_ref().and_then(|f| fs::read_to_string(f).ok()).unwrap_or_default();
        let _ = if prev.trim().is_empty() {
            Command::new("defaults").args(["delete", "com.apple.screencapture", "location"]).status()
        } else {
            Command::new("defaults").args(["write", "com.apple.screencapture", "location", prev.trim()]).status()
        };
        set_flag(&app, ON, false);
    }
    refresh_system_ui();
    Ok(status(&app))
}

#[tauri::command]
pub async fn shots_list(app: AppHandle) -> Vec<Shot> {
    list(&app)
}

/// Küçük resim (JPEG, en uzun kenar 480 px). Mac'in kendi araçlarıyla üretilir ve önbelleğe alınır.
#[tauri::command]
pub async fn shots_thumb(app: AppHandle, name: String) -> Result<String, String> {
    let src = safe(&app, &name)?;
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("ekran-kucuk");
    fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    let key: u64 = name.bytes().fold(1469598103934665603u64, |h, b| (h ^ b as u64).wrapping_mul(1099511628211)) ^ mtime_ms(&src);
    let out = cache.join(format!("{key:x}.jpg"));
    if !out.exists() {
        if kind_of(&src) == Some("video") {
            // video: Quick Look ile ilk kare (PNG üretir)
            let tmp = cache.join(format!("{key:x}-ql"));
            let _ = fs::create_dir_all(&tmp);
            let _ = Command::new("qlmanage").arg("-t").args(["-s", "480", "-o"]).arg(&tmp).arg(&src).output();
            let produced = fs::read_dir(&tmp).ok().and_then(|mut r| r.next()).and_then(|e| e.ok()).map(|e| e.path());
            match produced {
                Some(p) => {
                    let _ = Command::new("sips").args(["-s", "format", "jpeg"]).arg(&p).arg("--out").arg(&out).output();
                }
                None => return Err("önizleme yok".into()),
            }
            let _ = fs::remove_dir_all(&tmp);
        } else {
            let st = Command::new("sips")
                .args(["-Z", "480", "-s", "format", "jpeg", "-s", "formatOptions", "70"])
                .arg(&src)
                .arg("--out")
                .arg(&out)
                .output()
                .map_err(|e| e.to_string())?;
            if !st.status.success() {
                return Err("önizleme üretilemedi".into());
            }
        }
    }
    let bytes = fs::read(&out).map_err(|e| e.to_string())?;
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
}

/// Dosyanın kendisi (büyük önizleme, Ajandam'a / Sohbet'e ekleme için).
#[tauri::command]
pub async fn shots_read(app: AppHandle, name: String) -> Result<String, String> {
    let p = safe(&app, &name)?;
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    if meta.len() > 60 * 1024 * 1024 {
        return Err("dosya çok büyük".into());
    }
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "heic" => "image/heic",
        "tiff" => "image/tiff",
        "mov" => "video/quicktime",
        "mp4" => "video/mp4",
        _ => "application/octet-stream",
    };
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

/// Görseli panoya kopyalar (ChatGPT'ye, Sohbet'e, maile ⌘V ile yapıştırılır).
#[tauri::command]
pub async fn shots_copy(app: AppHandle, name: String) -> Result<(), String> {
    let p = safe(&app, &name)?;
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let class = match ext.as_str() {
        "png" => "«class PNGf»",
        "jpg" | "jpeg" => "JPEG picture",
        "tiff" => "TIFF picture",
        _ => return Err("bu dosya panoya kopyalanamaz".into()),
    };
    let path = p.display().to_string().replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!("set the clipboard to (read (POSIX file \"{path}\") as {class})");
    let st = Command::new("osascript").args(["-e", &script]).output().map_err(|e| e.to_string())?;
    if st.status.success() { Ok(()) } else { Err("kopyalanamadı".into()) }
}

#[tauri::command]
pub async fn shots_reveal(app: AppHandle, name: String) -> Result<(), String> {
    let p = safe(&app, &name)?;
    app.opener().reveal_item_in_dir(p).map_err(|e| e.to_string())
}

/// Mac'in varsayılan uygulamasında aç (Önizleme / QuickTime).
#[tauri::command]
pub async fn shots_open(app: AppHandle, name: String) -> Result<(), String> {
    let p = safe(&app, &name)?;
    app.opener().open_path(p.display().to_string(), None::<&str>).map_err(|e| e.to_string())
}

/// Çöp kutusuna taşır (geri alınabilir).
#[tauri::command]
pub async fn shots_trash(app: AppHandle, name: String) -> Result<(), String> {
    let p = safe(&app, &name)?;
    trash::delete(&p).map_err(|e| e.to_string())
}

/// "Farklı kaydet": seçilen yere bir kopya.
#[tauri::command]
pub async fn shots_save_as(app: AppHandle, name: String) -> Result<bool, String> {
    let p = safe(&app, &name)?;
    let target = app.dialog().file().set_file_name(&name).blocking_save_file();
    let Some(target) = target else { return Ok(false) };
    let dest = target.into_path().map_err(|e| e.to_string())?;
    fs::copy(&p, &dest).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn shots_set_cleanup(app: AppHandle, on: bool) -> serde_json::Value {
    set_flag(&app, CLEANUP, on);
    if on {
        cleanup(&app);
    }
    status(&app)
}

/// İsteğe bağlı: 30 günden eski ekran görüntülerini çöp kutusuna taşı.
fn cleanup(app: &AppHandle) {
    if !flag(app, CLEANUP) {
        return;
    }
    let limit = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
        .saturating_sub(CLEANUP_DAYS * 86_400_000);
    let Ok(dir) = folder(app) else { return };
    for s in list(app) {
        if s.at > 0 && s.at < limit {
            let _ = trash::delete(dir.join(&s.name));
        }
    }
}

/// Klasörü izler: yeni ekran görüntüsü gelince sayfaya haber verir. Günde bir temizlik.
pub fn start_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let mut known: Option<HashSet<String>> = None;
        let mut last_cleanup = SystemTime::UNIX_EPOCH;
        loop {
            if !flag(&app, ON) {
                known = None;
                std::thread::sleep(Duration::from_secs(5));
                continue;
            }
            if last_cleanup.elapsed().map(|d| d > Duration::from_secs(86_400)).unwrap_or(true) {
                cleanup(&app);
                last_cleanup = SystemTime::now();
            }
            let now: HashSet<String> = list(&app).into_iter().map(|s| s.name).collect();
            if let Some(prev) = &known {
                let added: Vec<&String> = now.iter().filter(|n| !prev.contains(*n)).collect();
                let removed = prev.iter().any(|n| !now.contains(n));
                for n in &added {
                    let js_name = serde_json::to_string(n).unwrap_or_else(|_| "\"\"".into());
                    page_emit(&app, &format!("{{ action: 'shot', name: {js_name} }}"));
                }
                if added.is_empty() && removed {
                    page_emit(&app, "{ action: 'shots' }");
                }
            }
            known = Some(now);
            std::thread::sleep(Duration::from_millis(1500));
        }
    });
}
