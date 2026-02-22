#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;
use tauri_plugin_dialog::DialogExt;

// ─── Structs ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HelmNodeMeta {
    pub release_name: String,
    pub namespace: String,
    pub chart_name: String,
    pub chart_version: String,
    pub repo: String,
    pub values_path: String,
    pub rendered_dir: String,
}

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
    pub source: String,
    pub helm: Option<HelmNodeMeta>,
    // Layout positions
    pub x: f64,
    pub y: f64,
    pub group_x: Option<f64>,
    pub group_y: Option<f64>,
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
    pub status: String,
    pub pods: Vec<PodInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ClusterStatus {
    pub fields: Vec<FieldStatus>,
    pub kubectl_available: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeleteResult {
    pub deleted_files: Vec<String>,
    pub missing_files: Vec<String>,
    pub file_errors: Vec<String>,
    pub kubectl_output: Option<String>,
    pub kubectl_error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HelmRenderResult {
    pub rendered_files: Vec<String>,
    pub warnings: Vec<String>,
    pub error: Option<String>,
}

// ─── kubectl / helm helpers ───────────────────────────────────────────────────

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

fn run_helm(args: &[&str], cwd: &Path) -> Result<String, String> {
    let output = Command::new("helm")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("helm not found: {}", e))?;
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
    if desired == 0 {
        return "gray";
    }
    if ready == 0 {
        return "red";
    }
    if ready < desired {
        return "yellow";
    }
    "green"
}

// ─── image → type_id ─────────────────────────────────────────────────────────

fn image_to_type_id(image: &str) -> &'static str {
    let img = image.to_lowercase();
    let img = img.split(':').next().unwrap_or("");
    let img = img.split('/').last().unwrap_or("");
    if img.contains("nginx")
        || img.contains("traefik")
        || img.contains("haproxy")
        || img.contains("envoy")
    {
        return "gateway";
    }
    if img.contains("redis") {
        return "cache";
    }
    if img.contains("postgres")
        || img.contains("mysql")
        || img.contains("mongo")
        || img.contains("mariadb")
        || img.contains("cockroach")
        || img.contains("cassandra")
        || img.contains("clickhouse")
    {
        return "database";
    }
    if img.contains("kafka")
        || img.contains("rabbitmq")
        || img.contains("nats")
        || img.contains("pulsar")
        || img.contains("activemq")
        || img.contains("redpanda")
    {
        return "queue";
    }
    if img.contains("prometheus")
        || img.contains("grafana")
        || img.contains("jaeger")
        || img.contains("elasticsearch")
        || img.contains("kibana")
        || img.contains("fluentd")
    {
        return "monitoring";
    }
    if img.contains("cert-manager") || img.contains("certmanager") {
        return "infra";
    }
    "service"
}

fn chart_name_to_type_id(chart: &str) -> &'static str {
    let c = chart.to_lowercase();
    if c.contains("nginx") || c.contains("traefik") || c.contains("ingress") {
        return "gateway";
    }
    if c.contains("redis") {
        return "cache";
    }
    if c.contains("postgres") || c.contains("mysql") || c.contains("mongo") || c.contains("mariadb") {
        return "database";
    }
    if c.contains("kafka") || c.contains("rabbitmq") || c.contains("nats") || c.contains("redpanda") {
        return "queue";
    }
    if c.contains("prometheus") || c.contains("grafana") || c.contains("loki") || c.contains("kube-prometheus") {
        return "monitoring";
    }
    if c.contains("cert-manager") || c.contains("vault") || c.contains("external-secrets") {
        return "infra";
    }
    "service"
}

// ─── YAML helpers ─────────────────────────────────────────────────────────────

fn extract_yaml_field<'a>(content: &'a str, key: &str) -> Option<&'a str> {
    for line in content.lines() {
        if line.starts_with(' ') || line.starts_with('\t') {
            continue;
        }
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix(key) {
            if let Some(rest) = rest.trim().strip_prefix(':') {
                let value = rest.trim().trim_matches('"').trim_matches('\'');
                if !value.is_empty() {
                    return Some(value);
                }
            }
        }
    }
    None
}

fn extract_metadata_field<'a>(content: &'a str, key: &str) -> Option<&'a str> {
    let mut in_metadata = false;
    for line in content.lines() {
        if !line.starts_with(' ') && line.trim() == "metadata:" {
            in_metadata = true;
            continue;
        }
        if !in_metadata {
            continue;
        }
        if !line.is_empty() && !line.starts_with(' ') && !line.starts_with('\t') {
            break;
        }
        if line.starts_with("  ") && !line.starts_with("   ") {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix(key) {
                if let Some(rest) = rest.trim().strip_prefix(':') {
                    let value = rest.trim().trim_matches('"').trim_matches('\'');
                    if !value.is_empty() {
                        return Some(value);
                    }
                }
            }
        }
    }
    None
}

fn extract_images(content: &str) -> Vec<String> {
    content
        .lines()
        .filter_map(|line| {
            let t = line.trim();
            t.strip_prefix("image:").map(|rest| {
                rest.trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .to_string()
            })
        })
        .filter(|s| !s.is_empty() && !s.starts_with("{{"))
        .collect()
}

fn extract_replicas(content: &str) -> Option<u32> {
    content.lines().find_map(|line| {
        line.trim()
            .strip_prefix("replicas:")
            .and_then(|r| r.trim().parse().ok())
    })
}

// ─── Helm Chart.yaml parser ───────────────────────────────────────────────────

fn try_parse_helm_node(component_dir: &Path) -> Option<YamlNode> {
    let chart_path = component_dir.join("helm").join("Chart.yaml");
    if !chart_path.exists() {
        return None;
    }

    let chart_content = fs::read_to_string(&chart_path).ok()?;

    let mut dep_name = String::new();
    let mut dep_version = String::new();
    let mut dep_repo = String::new();
    let mut in_deps = false;
    let mut dep_started = false;

    for line in chart_content.lines() {
        let trimmed = line.trim();
        if trimmed == "dependencies:" {
            in_deps = true;
            continue;
        }
        if in_deps {
            if trimmed.starts_with("- name:") {
                dep_name = trimmed
                    .trim_start_matches("- name:")
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .to_string();
                dep_started = true;
            } else if dep_started && trimmed.starts_with("version:") {
                dep_version = trimmed
                    .trim_start_matches("version:")
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .to_string();
            } else if dep_started && trimmed.starts_with("repository:") {
                dep_repo = trimmed
                    .trim_start_matches("repository:")
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .to_string();
            }
        }
    }

    if dep_name.is_empty() {
        return None;
    }

    let release_name = component_dir.file_name()?.to_str()?.to_string();

    let ns_path = component_dir.join("namespace.yaml");
    let namespace = if ns_path.exists() {
        let ns_content = fs::read_to_string(&ns_path).unwrap_or_default();
        extract_metadata_field(&ns_content, "name")
            .unwrap_or("infra")
            .to_string()
    } else {
        format!("infra-{}", release_name)
    };

    let type_id = chart_name_to_type_id(&dep_name).to_string();
    let values_path = component_dir
        .join("helm")
        .join("values.yaml")
        .to_string_lossy()
        .to_string();
    let rendered_dir = component_dir
        .join("rendered")
        .to_string_lossy()
        .to_string();

    Some(YamlNode {
        id: format!("helm-{}", release_name),
        label: release_name.clone(),
        kind: "HelmRelease".to_string(),
        image: format!("helm:{}/{}", dep_name, dep_version),
        type_id,
        namespace: namespace.clone(),
        file_path: chart_path.to_string_lossy().to_string(),
        replicas: None,
        source: "helm".to_string(),
        helm: Some(HelmNodeMeta {
            release_name,
            namespace,
            chart_name: dep_name,
            chart_version: dep_version,
            repo: dep_repo,
            values_path,
            rendered_dir,
        }),
        x: 0.0,
        y: 0.0,
        group_x: None,
        group_y: None,
    })
}

// ─── Raw YAML parsing ─────────────────────────────────────────────────────────

fn parse_yaml_doc(doc: &str, path: &Path, idx: usize) -> Option<YamlNode> {
    let kind = extract_yaml_field(doc, "kind")?.to_string();
    let workloads = [
        "Deployment",
        "StatefulSet",
        "DaemonSet",
        "Job",
        "CronJob",
        "ReplicaSet",
        "Pod",
    ];
    if !workloads.contains(&kind.as_str()) {
        return None;
    }

    let name = extract_metadata_field(doc, "name")
        .unwrap_or("unknown")
        .to_string();
    let namespace = extract_metadata_field(doc, "namespace")
        .unwrap_or("default")
        .to_string();
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

    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("f");

    Some(YamlNode {
        id: format!(
            "{}-{}-{}",
            name.replace('/', "-").replace('.', "-"),
            stem,
            idx
        ),
        label: name,
        kind,
        image,
        type_id,
        namespace,
        file_path: path.to_string_lossy().to_string(),
        replicas,
        source: "raw".to_string(),
        helm: None,
        x: 0.0,
        y: 0.0,
        group_x: None,
        group_y: None,
    })
}

fn parse_yaml_file(path: &Path) -> Result<Vec<YamlNode>, String> {
    let content =
        fs::read_to_string(path).map_err(|e| format!("{}: {}", path.display(), e))?;
    Ok(content
        .split("\n---")
        .enumerate()
        .filter_map(|(i, doc)| parse_yaml_doc(doc.trim(), path, i))
        .collect())
}

fn scan_dir(dir: &Path, nodes: &mut Vec<YamlNode>, errors: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        errors.push(format!("Cannot read: {}", dir.display()));
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.starts_with('.')
                || name == "node_modules"
                || name == "vendor"
                || name == "charts"
                || name == "rendered"
            {
                continue;
            }

            if let Some(helm_node) = try_parse_helm_node(&path) {
                nodes.push(helm_node);
                continue;
            }

            scan_dir(&path, nodes, errors);
        } else if path.is_file() {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext == "yaml" || ext == "yml" {
                let in_rendered = path.components().any(|c| c.as_os_str() == "rendered");
                let in_helm_charts = path.components().any(|c| c.as_os_str() == "charts");
                if in_rendered || in_helm_charts {
                    continue;
                }
                match parse_yaml_file(&path) {
                    Ok(ns) => nodes.extend(ns),
                    Err(e) => errors.push(e),
                }
            }
        }
    }
}

// ─── Helm template rendering ──────────────────────────────────────────────────

fn split_rendered_manifests(raw: &str) -> Vec<(String, String)> {
    let kind_order = |kind: &str| match kind {
        "Namespace" => 0,
        "ServiceAccount" => 1,
        "ClusterRole" => 2,
        "ClusterRoleBinding" => 3,
        "Role" => 4,
        "RoleBinding" => 5,
        "ConfigMap" => 6,
        "Secret" => 7,
        "PersistentVolumeClaim" => 8,
        "Service" => 9,
        "Deployment" => 10,
        "StatefulSet" => 11,
        "DaemonSet" => 12,
        "Job" => 13,
        "CronJob" => 14,
        "Ingress" => 15,
        "IngressClass" => 16,
        "CustomResourceDefinition" => 17,
        _ => 50,
    };

    let mut docs: Vec<(u32, String, String)> = raw
        .split("\n---")
        .filter_map(|doc| {
            let doc = doc.trim();
            if doc.is_empty() {
                return None;
            }
            if doc.lines().all(|l| l.trim().is_empty() || l.trim().starts_with('#')) {
                return None;
            }

            let kind = doc
                .lines()
                .find(|l| {
                    let t = l.trim_start();
                    t.starts_with("kind:") && !l.starts_with(' ')
                })
                .and_then(|l| l.split(':').nth(1))
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|| "Unknown".to_string());

            let name = {
                let mut in_meta = false;
                let mut found = String::from("resource");
                for line in doc.lines() {
                    if line.trim() == "metadata:" && !line.starts_with(' ') {
                        in_meta = true;
                        continue;
                    }
                    if in_meta {
                        if !line.is_empty()
                            && !line.starts_with(' ')
                            && !line.starts_with('\t')
                        {
                            break;
                        }
                        if line.starts_with("  ") && !line.starts_with("   ") {
                            let t = line.trim();
                            if let Some(rest) = t.strip_prefix("name:") {
                                found = rest
                                    .trim()
                                    .trim_matches('"')
                                    .trim_matches('\'')
                                    .to_string();
                                break;
                            }
                        }
                    }
                }
                found
            };

            let order = kind_order(&kind);
            let safe_name = name.replace('/', "-").replace('.', "-");
            let filename = format!("{}-{}.yaml", kind.to_lowercase(), safe_name);
            Some((order, filename, format!("{}\n", doc)))
        })
        .collect();

    docs.sort_by_key(|(order, name, _)| (*order, name.clone()));

    docs.into_iter()
        .enumerate()
        .map(|(i, (_, name, content))| (format!("{:02}-{}", i, name), content))
        .collect()
}

// ─── Patch replicas in YAML file ──────────────────────────────────────────────

fn patch_replicas_in_file(
    file_path: &str,
    node_label: &str,
    new_replicas: u32,
) -> Result<(), String> {
    let content = fs::read_to_string(file_path)
        .map_err(|e| format!("Cannot read {}: {}", file_path, e))?;

    let docs: Vec<&str> = content.split("\n---").collect();
    let mut patched: Vec<String> = Vec::new();
    let mut found = false;

    for doc in &docs {
        let name = extract_metadata_field(doc, "name").unwrap_or("");
        if name == node_label && extract_replicas(doc).is_some() {
            let fixed = doc
                .lines()
                .map(|line| {
                    if line.trim().starts_with("replicas:") {
                        let indent: String =
                            line.chars().take_while(|c| c.is_whitespace()).collect();
                        format!("{}replicas: {}", indent, new_replicas)
                    } else {
                        line.to_string()
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            patched.push(fixed);
            found = true;
        } else {
            patched.push(doc.to_string());
        }
    }

    if !found {
        return Err(format!(
            "'{}' with replicas not found in {}",
            node_label, file_path
        ));
    }

    fs::write(file_path, patched.join("\n---"))
        .map_err(|e| format!("Cannot write {}: {}", file_path, e))
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
async fn open_folder_dialog(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .set_title("Select Kubernetes config folder")
        .blocking_pick_folder()
        .map(|p: tauri_plugin_dialog::FilePath| p.to_string())
}

#[tauri::command]
fn scan_yaml_files(folder_path: String) -> ScanResult {
    let path = Path::new(&folder_path);
    let mut nodes: Vec<YamlNode> = Vec::new();
    let mut errors = Vec::new();

    if !path.exists() || !path.is_dir() {
        errors.push(format!("Path does not exist: {}", folder_path));
        return ScanResult {
            nodes,
            project_path: folder_path,
            errors,
        };
    }

    scan_dir(path, &mut nodes, &mut errors);

    let priority = |kind: &str, source: &str| {
        if source == "helm" {
            return 0u32;
        }
        match kind {
            "StatefulSet" => 1,
            "Deployment" => 2,
            "DaemonSet" => 3,
            "ReplicaSet" => 4,
            "Job" => 5,
            "CronJob" => 6,
            "Pod" => 7,
            _ => 8,
        }
    };

    let mut seen: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    let mut deduped: Vec<YamlNode> = Vec::new();

    for node in nodes {
        let key = format!("{}::{}", node.label, node.namespace);
        if let Some(&existing_idx) = seen.get(&key) {
            if priority(&node.kind, &node.source)
                < priority(&deduped[existing_idx].kind, &deduped[existing_idx].source)
            {
                deduped[existing_idx] = node;
            }
        } else {
            seen.insert(key, deduped.len());
            deduped.push(node);
        }
    }

    for (i, node) in deduped.iter_mut().enumerate() {
        node.id = format!("{}-{}", node.id, i);
    }

    ScanResult {
        nodes: deduped,
        project_path: folder_path,
        errors,
    }
}

#[tauri::command]
fn read_yaml_file(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path)
        .map_err(|e| format!("Cannot read {}: {}", file_path, e))
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

#[tauri::command]
fn delete_field_files(file_paths: Vec<String>, namespace: String) -> DeleteResult {
    let mut result = DeleteResult {
        deleted_files: vec![],
        missing_files: vec![],
        file_errors: vec![],
        kubectl_output: None,
        kubectl_error: None,
    };

    let mut kubectl_out_lines: Vec<String> = vec![];
    let mut kubectl_err_lines: Vec<String> = vec![];

    for file_path in &file_paths {
        let p = Path::new(file_path);
        if p.exists() {
            match run_kubectl(&["delete", "-f", file_path, "--ignore-not-found=true"]) {
                Ok(out) => {
                    if !out.trim().is_empty() {
                        kubectl_out_lines.push(format!("✓ {} → {}", file_path, out.trim()));
                    }
                }
                Err(e) => {
                    kubectl_err_lines.push(format!("✗ {} → {}", file_path, e.trim()));
                }
            }
        }
    }

    if !kubectl_out_lines.is_empty() {
        result.kubectl_output = Some(kubectl_out_lines.join("\n"));
    }
    if !kubectl_err_lines.is_empty() {
        result.kubectl_error = Some(kubectl_err_lines.join("\n"));
    }

    for file_path in &file_paths {
        let p = Path::new(file_path);
        if !p.exists() {
            result.missing_files.push(file_path.clone());
            continue;
        }
        match fs::remove_file(p) {
            Ok(_) => {
                result.deleted_files.push(file_path.clone());
                if let Some(parent) = p.parent() {
                    if parent.is_dir() {
                        let is_empty = fs::read_dir(parent)
                            .map(|mut d| d.next().is_none())
                            .unwrap_or(false);
                        if is_empty {
                            let _ = fs::remove_dir(parent);
                        }
                    }
                }
            }
            Err(e) => {
                result.file_errors.push(format!("{}: {}", file_path, e));
            }
        }
    }

    let _ = namespace;
    result
}

#[tauri::command]
fn kubectl_delete_by_label(label: String, namespace: String) -> Result<String, String> {
    run_kubectl(&[
        "delete",
        "all",
        "-l",
        &format!("app={}", label),
        "-n",
        &namespace,
        "--ignore-not-found=true",
    ])
}

#[tauri::command]
fn get_cluster_status() -> ClusterStatus {
    if run_kubectl(&["version", "--client"]).is_err() {
        return ClusterStatus {
            fields: vec![],
            kubectl_available: false,
            error: Some("kubectl not found".to_string()),
        };
    }

    let pods_raw = match run_kubectl(&["get", "pods", "--all-namespaces", "--no-headers"]) {
        Ok(o) => o,
        Err(e) => {
            return ClusterStatus {
                fields: vec![],
                kubectl_available: true,
                error: Some(e),
            }
        }
    };

    let pods: Vec<PodInfo> = pods_raw
        .lines()
        .filter_map(|line| {
            let p: Vec<&str> = line.split_whitespace().collect();
            if p.len() < 5 {
                return None;
            }
            let (ready, total) = parse_ready(p[2]);
            Some(PodInfo {
                namespace: p[0].to_string(),
                name: p[1].to_string(),
                phase: p[3].to_string(),
                ready,
                total,
                restarts: p[4].parse().unwrap_or(0),
            })
        })
        .collect();

    let mut fields: Vec<FieldStatus> = Vec::new();

    for resource in &["deployments", "statefulsets"] {
        let raw = run_kubectl(&["get", resource, "--all-namespaces", "--no-headers"])
            .unwrap_or_default();
        for line in raw.lines() {
            let p: Vec<&str> = line.split_whitespace().collect();
            if p.len() < 4 {
                continue;
            }
            let ns = p[0].to_string();
            let name = p[1].to_string();

            let (desired, ready, available) =
                if *resource == "deployments" && p.len() >= 5 {
                    let (r, d) = parse_ready(p[2]);
                    let avail: u32 = p[4].parse().unwrap_or(r);
                    (d, r, avail)
                } else {
                    let (r, d) = parse_ready(p[2]);
                    (d, r, r)
                };

            let my_pods: Vec<PodInfo> = pods
                .iter()
                .filter(|pod| pod.namespace == ns && pod.name.starts_with(&name))
                .cloned()
                .collect();

            let status = compute_status(ready, desired).to_string();
            fields.push(FieldStatus {
                label: name,
                namespace: ns,
                desired,
                ready,
                available,
                status,
                pods: my_pods,
            });
        }
    }

    ClusterStatus {
        fields,
        kubectl_available: true,
        error: None,
    }
}

#[tauri::command]
fn apply_replicas(
    file_path: String,
    node_label: String,
    replicas: u32,
) -> Result<String, String> {
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
    run_kubectl(&[
        "logs",
        "-n",
        &namespace,
        &pod_name,
        &format!("--tail={}", tail),
    ])
}

#[tauri::command]
fn get_events(namespace: String) -> Result<String, String> {
    if namespace == "all" {
        run_kubectl(&[
            "get",
            "events",
            "--all-namespaces",
            "--sort-by=.lastTimestamp",
            "--no-headers",
        ])
    } else {
        run_kubectl(&[
            "get",
            "events",
            "-n",
            &namespace,
            "--sort-by=.lastTimestamp",
            "--no-headers",
        ])
    }
}

// ─── Helm commands ────────────────────────────────────────────────────────────

#[tauri::command]
fn helm_template(
    component_dir: String,
    release_name: String,
    namespace: String,
    values_file: Option<String>,
) -> HelmRenderResult {
    let dir = Path::new(&component_dir);
    let helm_dir = dir.join("helm");
    let rendered_dir = dir.join("rendered");

    if run_helm(&["version", "--short"], dir).is_err() {
        return HelmRenderResult {
            rendered_files: vec![],
            warnings: vec![],
            error: Some(
                "helm CLI not found — install helm 3 to render templates".to_string(),
            ),
        };
    }

    if let Err(e) = run_helm(&["dependency", "update", "."], &helm_dir) {
        return HelmRenderResult {
            rendered_files: vec![],
            warnings: vec![],
            error: Some(format!("helm dependency update failed: {}", e)),
        };
    }

    let values_path = values_file
        .unwrap_or_else(|| helm_dir.join("values.yaml").to_string_lossy().to_string());

    let raw = match run_helm(
        &[
            "template",
            &release_name,
            ".",
            "--namespace",
            &namespace,
            "--values",
            &values_path,
            "--include-crds",
        ],
        &helm_dir,
    ) {
        Ok(out) => out,
        Err(e) => {
            return HelmRenderResult {
                rendered_files: vec![],
                warnings: vec![],
                error: Some(format!("helm template failed: {}", e)),
            }
        }
    };

    if !rendered_dir.exists() {
        if let Err(e) = fs::create_dir_all(&rendered_dir) {
            return HelmRenderResult {
                rendered_files: vec![],
                warnings: vec![],
                error: Some(format!("Cannot create rendered/: {}", e)),
            };
        }
    } else if let Ok(entries) = fs::read_dir(&rendered_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.file_name().and_then(|n| n.to_str()) != Some(".gitkeep") {
                let _ = fs::remove_file(&p);
            }
        }
    }

    let manifests = split_rendered_manifests(&raw);
    let mut rendered_files = Vec::new();
    let mut warnings = Vec::new();

    for (filename, content) in &manifests {
        let out_path = rendered_dir.join(filename);
        match fs::write(&out_path, content) {
            Ok(_) => rendered_files.push(out_path.to_string_lossy().to_string()),
            Err(e) => warnings.push(format!("Failed to write {}: {}", filename, e)),
        }
    }

    HelmRenderResult {
        rendered_files,
        warnings,
        error: None,
    }
}

#[tauri::command]
fn helm_install(
    component_dir: String,
    release_name: String,
    namespace: String,
    values_file: Option<String>,
) -> Result<String, String> {
    let dir = Path::new(&component_dir);
    let helm_dir = dir.join("helm");

    run_helm(&["dependency", "update", "."], &helm_dir)?;

    let values_path = values_file
        .unwrap_or_else(|| helm_dir.join("values.yaml").to_string_lossy().to_string());

    let out = run_helm(
        &[
            "upgrade",
            "--install",
            &release_name,
            ".",
            "--namespace",
            &namespace,
            "--create-namespace",
            "--values",
            &values_path,
            "--wait",
            "--timeout",
            "5m",
        ],
        &helm_dir,
    )?;

    Ok(format!("✓ {}", out.trim()))
}

#[tauri::command]
fn helm_uninstall(release_name: String, namespace: String) -> Result<String, String> {
    run_helm(
        &[
            "uninstall",
            &release_name,
            "--namespace",
            &namespace,
            "--ignore-not-found",
        ],
        Path::new("."),
    )
}

#[tauri::command]
fn helm_available() -> bool {
    Command::new("helm")
        .arg("version")
        .arg("--short")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

// New async commands as requested

#[tauri::command]
fn helm_template_async(
    component_dir: String,
    release_name: String,
    namespace: String,
    values_file: Option<String>,
) -> Result<String, String> {
    std::thread::spawn(move || {
        // Reuse helm_template logic by calling run_helm and writing rendered files
        // This block should be a near-copy of helm_template, but errors are ignored here since this is fire-and-forget.
        let dir = std::path::Path::new(&component_dir);
        let helm_dir = dir.join("helm");
        let rendered_dir = dir.join("rendered");
        if run_helm(&["version", "--short"], dir).is_err() {
            return;
        }
        if run_helm(&["dependency", "update", "."], &helm_dir).is_err() {
            return;
        }
        let values_path = values_file
            .unwrap_or_else(|| helm_dir.join("values.yaml").to_string_lossy().to_string());
        let raw = match run_helm(
            &[
                "template",
                &release_name,
                ".",
                "--namespace",
                &namespace,
                "--values",
                &values_path,
                "--include-crds",
            ],
            &helm_dir,
        ) {
            Ok(out) => out,
            Err(_) => return,
        };
        if !rendered_dir.exists() {
            if std::fs::create_dir_all(&rendered_dir).is_err() { return; }
        } else if let Ok(entries) = std::fs::read_dir(&rendered_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.file_name().and_then(|n| n.to_str()) != Some(".gitkeep") {
                    let _ = std::fs::remove_file(&p);
                }
            }
        }
        let manifests = split_rendered_manifests(&raw);
        for (filename, content) in &manifests {
            let out_path = rendered_dir.join(filename);
            let _ = std::fs::write(&out_path, content);
        }
    });
    Ok("started".to_string())
}

#[tauri::command]
fn helm_install_async(
    component_dir: String,
    release_name: String,
    namespace: String,
    values_file: Option<String>,
) -> Result<String, String> {
    std::thread::spawn(move || {
        let dir = std::path::Path::new(&component_dir);
        let helm_dir = dir.join("helm");
        if run_helm(&["dependency", "update", "."], &helm_dir).is_err() {
            return;
        }
        let values_path = values_file
            .unwrap_or_else(|| helm_dir.join("values.yaml").to_string_lossy().to_string());
        let _ = run_helm(
            &[
                "upgrade",
                "--install",
                &release_name,
                ".",
                "--namespace",
                &namespace,
                "--create-namespace",
                "--values",
                &values_path,
            ],
            &helm_dir,
        );
    });
    Ok("started".to_string())
}

#[tauri::command]
fn kubectl_apply_async(path: String) -> Result<String, String> {
    std::thread::spawn(move || {
        let _ = run_kubectl(&["apply", "-f", &path]);
    });
    Ok("started".to_string())
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
            delete_field_files,
            kubectl_delete_by_label,
            get_cluster_status,
            apply_replicas,
            kubectl_apply,
            get_pod_logs,
            get_events,
            helm_template,
            helm_install,
            helm_uninstall,
            helm_available,
            helm_template_async,
            helm_install_async,
            kubectl_apply_async,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

