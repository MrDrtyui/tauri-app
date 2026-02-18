// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;
use tauri_plugin_dialog::DialogExt;

// ─── Structs ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct YamlNode {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub image: String,
    pub type_id: String,
    pub namespace: String,
    pub file_path: String,
    pub replicas: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanResult {
    pub nodes: Vec<YamlNode>,
    pub project_path: String,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PodInfo {
    pub name: String,
    pub namespace: String,
    pub phase: String,
    pub ready: u32,
    pub total: u32,
    pub restarts: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FieldStatus {
    pub label: String,
    pub namespace: String,
    pub desired: u32,
    pub ready: u32,
    pub available: u32,
    /// "green" | "yellow" | "red" | "gray"
    pub status: String,
    pub pods: Vec<PodInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ClusterStatus {
    pub fields: Vec<FieldStatus>,
    pub kubectl_available: bool,
    pub error: Option<String>,
}

// ─── kubectl helper ───────────────────────────────────────────────────────────

fn run_kubectl(args: &[&str]) -> Result<String, String> {
    let output = Command::new("kubectl")
        .args(args)
        .output()
        .map_err(|e| format!("kubectl not found: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

fn parse_ready(s: &str) -> (u32, u32) {
    let parts: Vec<&str> = s.split('/').collect();
    if parts.len() == 2 {
        (parts[0].parse().unwrap_or(0), parts[1].parse().unwrap_or(1))
    } else {
        (0, 1)
    }
}

fn compute_status(ready: u32, desired: u32) -> &'static str {
    if desired == 0 { return "gray"; }
    if ready == 0   { return "red"; }
    if ready < desired { return "yellow"; }
    "green"
}

// ─── image → type_id ─────────────────────────────────────────────────────────

fn image_to_type_id(image: &str) -> &'static str {
    let img = image.to_lowercase();
    let img = img.split(':').next().unwrap_or("");
    let img = img.split('/').last().unwrap_or("");
    if img.contains("nginx") || img.contains("traefik") || img.contains("haproxy") || img.contains("envoy") { return "gateway"; }
    if img.contains("redis") { return "cache"; }
    if img.contains("postgres") || img.contains("mysql") || img.contains("mongo") || img.contains("mariadb") || img.contains("cockroach") || img.contains("cassandra") || img.contains("clickhouse") { return "database"; }
    if img.contains("kafka") || img.contains("rabbitmq") || img.contains("nats") || img.contains("pulsar") || img.contains("activemq") { return "queue"; }
    if img.contains("prometheus") || img.contains("grafana") || img.contains("jaeger") || img.contains("elasticsearch") || img.contains("kibana") || img.contains("fluentd") { return "monitoring"; }
    "service"
}

// ─── YAML helpers ─────────────────────────────────────────────────────────────

fn extract_yaml_field<'a>(content: &'a str, key: &str) -> Option<&'a str> {
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix(key) {
            if let Some(rest) = rest.trim().strip_prefix(':') {
                let value = rest.trim().trim_matches('"').trim_matches('\'');
                if !value.is_empty() { return Some(value); }
            }
        }
    }
    None
}

fn extract_images(content: &str) -> Vec<String> {
    content.lines()
        .filter_map(|line| {
            let t = line.trim();
            t.strip_prefix("image:").map(|rest| {
                rest.trim().trim_matches('"').trim_matches('\'').to_string()
            })
        })
        .filter(|s| !s.is_empty() && !s.starts_with("{{"))
        .collect()
}

fn extract_replicas(content: &str) -> Option<u32> {
    content.lines().find_map(|line| {
        line.trim().strip_prefix("replicas:").and_then(|r| r.trim().parse().ok())
    })
}

fn parse_yaml_doc(doc: &str, path: &Path, idx: usize) -> Option<YamlNode> {
    let kind = extract_yaml_field(doc, "kind")?.to_string();
    let relevant = ["Deployment","StatefulSet","DaemonSet","Job","CronJob","ReplicaSet","Pod","Service","Ingress","ConfigMap","Secret"];
    if !relevant.contains(&kind.as_str()) { return None; }

    let name = extract_yaml_field(doc, "name").unwrap_or("unknown").to_string();
    let namespace = extract_yaml_field(doc, "namespace").unwrap_or("default").to_string();
    let replicas = extract_replicas(doc);
    let images = extract_images(doc);

    let (image, type_id) = if let Some(img) = images.first() {
        (img.clone(), image_to_type_id(img).to_string())
    } else {
        let tid = match kind.as_str() {
            "Service" | "Ingress" => "gateway",
            "ConfigMap" | "Secret" => "config",
            _ => "service",
        };
        (String::new(), tid.to_string())
    };

    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("f");
    Some(YamlNode {
        id: format!("{}-{}-{}", name.replace('/', "-").replace('.', "-"), stem, idx),
        label: name, kind, image, type_id, namespace,
        file_path: path.to_string_lossy().to_string(),
        replicas,
    })
}

fn parse_yaml_file(path: &Path) -> Result<Vec<YamlNode>, String> {
    let content = fs::read_to_string(path).map_err(|e| format!("{}: {}", path.display(), e))?;
    Ok(content.split("\n---").enumerate()
        .filter_map(|(i, doc)| parse_yaml_doc(doc.trim(), path, i))
        .collect())
}

fn scan_dir(dir: &Path, nodes: &mut Vec<YamlNode>, errors: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        errors.push(format!("Cannot read: {}", dir.display())); return;
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
                    Ok(ns) => nodes.extend(ns),
                    Err(e) => errors.push(e),
                }
            }
        }
    }
}

// ─── Patch replicas in YAML file ──────────────────────────────────────────────

fn patch_replicas_in_file(file_path: &str, node_label: &str, new_replicas: u32) -> Result<(), String> {
    let content = fs::read_to_string(file_path)
        .map_err(|e| format!("Cannot read {}: {}", file_path, e))?;

    let docs: Vec<&str> = content.split("\n---").collect();
    let mut patched: Vec<String> = Vec::new();
    let mut found = false;

    for doc in &docs {
        let name = extract_yaml_field(doc, "name").unwrap_or("");
        if name == node_label && extract_replicas(doc).is_some() {
            let fixed = doc.lines().map(|line| {
                if line.trim().starts_with("replicas:") {
                    let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
                    format!("{}replicas: {}", indent, new_replicas)
                } else {
                    line.to_string()
                }
            }).collect::<Vec<_>>().join("\n");
            patched.push(fixed);
            found = true;
        } else {
            patched.push(doc.to_string());
        }
    }

    if !found {
        return Err(format!("'{}' with replicas not found in {}", node_label, file_path));
    }

    fs::write(file_path, patched.join("\n---"))
        .map_err(|e| format!("Cannot write {}: {}", file_path, e))
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
async fn open_folder_dialog(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .set_title("Выберите папку с Kubernetes конфигами")
        .blocking_pick_folder()
        .map(|p: tauri_plugin_dialog::FilePath| p.to_string())
}

#[tauri::command]
fn scan_yaml_files(folder_path: String) -> ScanResult {
    let path = Path::new(&folder_path);
    let mut nodes = Vec::new();
    let mut errors = Vec::new();

    if !path.exists() || !path.is_dir() {
        errors.push(format!("Path does not exist: {}", folder_path));
        return ScanResult { nodes, project_path: folder_path, errors };
    }

    scan_dir(path, &mut nodes, &mut errors);
    for (i, node) in nodes.iter_mut().enumerate() {
        node.id = format!("{}-{}", node.id, i);
    }
    ScanResult { nodes, project_path: folder_path, errors }
}

#[tauri::command]
fn read_yaml_file(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path).map_err(|e| format!("Cannot read {}: {}", file_path, e))
}

#[tauri::command]
fn save_yaml_file(file_path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&file_path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create dir {}: {}", parent.display(), e))?;
    }
    fs::write(&file_path, content)
        .map_err(|e| format!("Cannot write {}: {}", file_path, e))
}

/// Живой статус кластера: поды + deployments/statefulsets
#[tauri::command]
fn get_cluster_status() -> ClusterStatus {
    if run_kubectl(&["version", "--client"]).is_err() {
        return ClusterStatus { fields: vec![], kubectl_available: false, error: Some("kubectl not found".to_string()) };
    }

    // Поды со всеми namespace
    let pods_raw = match run_kubectl(&["get", "pods", "--all-namespaces", "--no-headers"]) {
        Ok(o) => o,
        Err(e) => return ClusterStatus { fields: vec![], kubectl_available: true, error: Some(e) },
    };

    // Парсим поды: NAMESPACE NAME READY STATUS RESTARTS AGE
    let pods: Vec<PodInfo> = pods_raw.lines().filter_map(|line| {
        let p: Vec<&str> = line.split_whitespace().collect();
        if p.len() < 5 { return None; }
        let (ready, total) = parse_ready(p[2]);
        Some(PodInfo {
            namespace: p[0].to_string(),
            name: p[1].to_string(),
            phase: p[3].to_string(),
            ready, total,
            restarts: p[4].parse().unwrap_or(0),
        })
    }).collect();

    // Deployments + StatefulSets: NAMESPACE NAME READY UP-TO-DATE AVAILABLE AGE
    let mut fields: Vec<FieldStatus> = Vec::new();

    for resource in &["deployments", "statefulsets"] {
        let raw = run_kubectl(&["get", resource, "--all-namespaces", "--no-headers"]).unwrap_or_default();
        for line in raw.lines() {
            let p: Vec<&str> = line.split_whitespace().collect();
            if p.len() < 4 { continue; }
            let ns = p[0].to_string();
            let name = p[1].to_string();

            // Deployments: NAMESPACE NAME READY UP-TO-DATE AVAILABLE AGE
            // StatefulSets: NAMESPACE NAME READY AGE
            let (desired, ready, available) = if *resource == "deployments" && p.len() >= 5 {
                let (r, d) = parse_ready(p[2]);
                let avail: u32 = p[4].parse().unwrap_or(r);
                (d, r, avail)
            } else {
                let (r, d) = parse_ready(p[2]);
                (d, r, r)
            };

            let my_pods: Vec<PodInfo> = pods.iter()
                .filter(|pod| pod.namespace == ns && pod.name.starts_with(&name))
                .cloned()
                .collect();

            let status = compute_status(ready, desired).to_string();
            fields.push(FieldStatus { label: name, namespace: ns, desired, ready, available, status, pods: my_pods });
        }
    }

    ClusterStatus { fields, kubectl_available: true, error: None }
}

/// Изменить replicas: патчит YAML → kubectl apply
#[tauri::command]
fn apply_replicas(file_path: String, node_label: String, replicas: u32) -> Result<String, String> {
    patch_replicas_in_file(&file_path, &node_label, replicas)?;
    let out = run_kubectl(&["apply", "-f", &file_path])?;
    Ok(format!("✓ {}", out.trim()))
}

#[tauri::command]
fn kubectl_apply(path: String) -> Result<String, String> {
    run_kubectl(&["apply", "-f", &path])
}

#[tauri::command]
fn get_pod_logs(namespace: String, pod_name: String, tail: u32) -> Result<String, String> {
    run_kubectl(&["logs", "-n", &namespace, &pod_name, &format!("--tail={}", tail)])
}

#[tauri::command]
fn get_events(namespace: String) -> Result<String, String> {
    if namespace == "all" {
        run_kubectl(&["get", "events", "--all-namespaces", "--sort-by=.lastTimestamp", "--no-headers"])
    } else {
        run_kubectl(&["get", "events", "-n", &namespace, "--sort-by=.lastTimestamp", "--no-headers"])
    }
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
            get_cluster_status,
            apply_replicas,
            kubectl_apply,
            get_pod_logs,
            get_events,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
