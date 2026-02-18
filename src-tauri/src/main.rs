// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri_plugin_dialog::DialogExt;

// ─── Structs sent to frontend ─────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct YamlNode {
    pub id: String,
    pub label: String,       // metadata.name
    pub kind: String,        // Deployment / Service / etc
    pub image: String,       // первый найденный image
    pub type_id: String,     // определяется из image
    pub namespace: String,   // metadata.namespace (или "default")
    pub file_path: String,   // абсолютный путь к yaml файлу
    pub replicas: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanResult {
    pub nodes: Vec<YamlNode>,
    pub project_path: String,
    pub errors: Vec<String>,
}

// ─── Image → type_id mapping ──────────────────────────────────────────────────

fn image_to_type_id(image: &str) -> &'static str {
    let img = image.to_lowercase();
    let img = img.split(':').next().unwrap_or("");
    let img = img.split('/').last().unwrap_or("");

    if img.contains("nginx") || img.contains("traefik") || img.contains("haproxy") || img.contains("envoy") {
        return "gateway";
    }
    if img.contains("redis") {
        return "cache";
    }
    if img.contains("postgres") || img.contains("mysql") || img.contains("mongodb")
        || img.contains("mongo") || img.contains("mariadb") || img.contains("cockroach")
        || img.contains("cassandra") || img.contains("clickhouse")
    {
        return "database";
    }
    if img.contains("kafka") || img.contains("rabbitmq") || img.contains("nats")
        || img.contains("pulsar") || img.contains("activemq")
    {
        return "queue";
    }
    if img.contains("prometheus") || img.contains("grafana") || img.contains("jaeger")
        || img.contains("elasticsearch") || img.contains("kibana") || img.contains("fluentd")
    {
        return "monitoring";
    }
    "service"
}

// ─── Minimal YAML parser (построчный, без внешних зависимостей) ──────────────

fn extract_yaml_field<'a>(content: &'a str, key: &str) -> Option<&'a str> {
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix(key) {
            let rest = rest.trim();
            if let Some(rest) = rest.strip_prefix(':') {
                let value = rest.trim().trim_matches('"').trim_matches('\'');
                if !value.is_empty() {
                    return Some(value);
                }
            }
        }
    }
    None
}

fn extract_images(content: &str) -> Vec<String> {
    let mut images = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("image:") {
            let img = rest.trim().trim_matches('"').trim_matches('\'').to_string();
            if !img.is_empty() && !img.starts_with("{{") {
                images.push(img);
            }
        }
    }
    images
}

fn extract_replicas(content: &str) -> Option<u32> {
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("replicas:") {
            if let Ok(n) = rest.trim().parse::<u32>() {
                return Some(n);
            }
        }
    }
    None
}

// ─── Parse one YAML document string → maybe YamlNode ────────────────────────

fn parse_yaml_doc(doc: &str, path: &Path, doc_index: usize) -> Option<YamlNode> {
    let kind = extract_yaml_field(doc, "kind")?.to_string();

    let relevant_kinds = [
        "Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob",
        "ReplicaSet", "Pod", "Service", "Ingress", "ConfigMap", "Secret",
    ];
    if !relevant_kinds.contains(&kind.as_str()) {
        return None;
    }

    let name = extract_yaml_field(doc, "name")
        .unwrap_or("unknown")
        .to_string();

    let namespace = extract_yaml_field(doc, "namespace")
        .unwrap_or("default")
        .to_string();

    let replicas = extract_replicas(doc);

    let images = extract_images(doc);
    let (image, type_id) = if let Some(first_image) = images.first() {
        let tid = image_to_type_id(first_image).to_string();
        (first_image.clone(), tid)
    } else {
        let tid = match kind.as_str() {
            "Service" | "Ingress" => "gateway",
            "ConfigMap" | "Secret" => "config",
            _ => "service",
        }.to_string();
        (String::new(), tid)
    };

    let file_stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let id = format!(
        "{}-{}-{}",
        name.replace('/', "-").replace('.', "-"),
        file_stem,
        doc_index,
    );

    Some(YamlNode {
        id,
        label: name,
        kind,
        image,
        type_id,
        namespace,
        file_path: path.to_string_lossy().to_string(),
        replicas,
    })
}

// ─── Parse a single YAML file (может содержать несколько docs через ---) ──────

fn parse_yaml_file(path: &Path) -> Result<Vec<YamlNode>, String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("{}: {}", path.display(), e))?;

    // Разбиваем по "---" разделителям документов
    let docs: Vec<&str> = content.split("\n---").collect();

    let nodes = docs
        .iter()
        .enumerate()
        .filter_map(|(i, doc)| parse_yaml_doc(doc.trim(), path, i))
        .collect();

    Ok(nodes)
}

// ─── Recursive directory scan ─────────────────────────────────────────────────

fn scan_dir(dir: &Path, nodes: &mut Vec<YamlNode>, errors: &mut Vec<String>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            errors.push(format!("Cannot read dir {}: {}", dir.display(), e));
            return;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if !name.starts_with('.') && name != "node_modules" && name != "vendor" {
                scan_dir(&path, nodes, errors);
            }
        } else if path.is_file() {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext == "yaml" || ext == "yml" {
                match parse_yaml_file(&path) {
                    Ok(file_nodes) => nodes.extend(file_nodes),
                    Err(e) => errors.push(e),
                }
            }
        }
    }
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

/// Открывает нативный диалог выбора папки
#[tauri::command]
async fn open_folder_dialog(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .set_title("Выберите папку с Kubernetes конфигами")
        .blocking_pick_folder()
        .map(|p: tauri_plugin_dialog::FilePath| p.to_string())
}

/// Сканирует папку и возвращает ноды из YAML файлов
#[tauri::command]
fn scan_yaml_files(folder_path: String) -> ScanResult {
    let path = Path::new(&folder_path);
    let mut nodes = Vec::new();
    let mut errors = Vec::new();

    if !path.exists() || !path.is_dir() {
        errors.push(format!(
            "Путь не существует или не является папкой: {}",
            folder_path
        ));
        return ScanResult {
            nodes,
            project_path: folder_path,
            errors,
        };
    }

    scan_dir(path, &mut nodes, &mut errors);

    // Гарантируем уникальность id
    for (i, node) in nodes.iter_mut().enumerate() {
        node.id = format!("{}-{}", node.id, i);
    }

    ScanResult {
        nodes,
        project_path: folder_path,
        errors,
    }
}

/// Читает содержимое одного YAML файла
#[tauri::command]
fn read_yaml_file(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path)
        .map_err(|e| format!("Не удалось прочитать {}: {}", file_path, e))
}

/// Сохраняет изменения обратно в YAML файл
#[tauri::command]
fn save_yaml_file(file_path: String, content: String) -> Result<(), String> {
    fs::write(&file_path, content)
        .map_err(|e| format!("Не удалось сохранить {}: {}", file_path, e))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            open_folder_dialog,
            scan_yaml_files,
            read_yaml_file,
            save_yaml_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
