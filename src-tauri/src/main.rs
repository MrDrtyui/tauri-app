#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;

// ─── Core Domain Types ────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FieldConfig {
    /// Unique identifier, also used as the Kubernetes resource name
    pub id: String,
    /// Human-readable display name
    pub label: String,
    /// Target namespace. If empty — auto-created from project name + label
    pub namespace: String,
    /// Docker image, e.g. "myorg/api:latest"
    pub image: String,
    /// Number of replicas
    pub replicas: u32,
    /// Port the container listens on
    pub port: u32,
    /// Optional environment variables (key=value pairs)
    pub env: Vec<EnvVar>,
    /// Absolute path to the project root
    pub project_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EnvVar {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InfraConfig {
    /// Unique id / Helm release name
    pub id: String,
    pub label: String,
    /// "helm" | "raw"
    pub source: String,
    /// Optional namespace. Cluster-level infra may omit this.
    pub namespace: Option<String>,
    /// Helm-specific fields
    pub helm: Option<HelmInfraConfig>,
    /// Raw YAML path (relative to project_path/infra/)
    pub raw_yaml_path: Option<String>,
    pub project_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HelmInfraConfig {
    pub repo_name: String,
    pub repo_url: String,
    pub chart_name: String,
    pub chart_version: String,
    /// Path to values override file, relative to project_path
    pub values_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateResult {
    pub generated_files: Vec<String>,
    pub namespace_created: bool,
    pub namespace: String,
    pub warnings: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeployResult {
    pub resource_id: String,
    pub namespace: String,
    pub source: String, // "helm" | "raw"
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
    /// Shell commands that were actually executed
    pub commands_run: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiffResult {
    pub resource_id: String,
    pub diff: String,
    pub has_changes: bool,
    pub error: Option<String>,
}

// ─── Existing Types (unchanged) ───────────────────────────────────────────────

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

fn run_kubectl_output(args: &[&str]) -> (String, String, bool) {
    match Command::new("kubectl").args(args).output() {
        Ok(out) => (
            String::from_utf8_lossy(&out.stdout).to_string(),
            String::from_utf8_lossy(&out.stderr).to_string(),
            out.status.success(),
        ),
        Err(e) => (String::new(), format!("kubectl not found: {}", e), false),
    }
}

fn run_helm_output(args: &[&str], cwd: &Path) -> (String, String, bool) {
    match Command::new("helm").args(args).current_dir(cwd).output() {
        Ok(out) => (
            String::from_utf8_lossy(&out.stdout).to_string(),
            String::from_utf8_lossy(&out.stderr).to_string(),
            out.status.success(),
        ),
        Err(e) => (String::new(), format!("helm not found: {}", e), false),
    }
}

/// Ensure namespace exists in the cluster. Returns true if it had to be created.
fn ensure_namespace(namespace: &str) -> Result<bool, String> {
    // Check if namespace already exists
    let check = run_kubectl(&["get", "namespace", namespace]);
    if check.is_ok() {
        return Ok(false);
    }
    // Create it
    run_kubectl(&["create", "namespace", namespace])?;
    Ok(true)
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

    // Only workloads go into the graph/nodes list
    // Configs/Services/etc. are shown via the file tree (scan_project_files)
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

// ─── YAML code generators ─────────────────────────────────────────────────────

fn generate_deployment_yaml(cfg: &FieldConfig) -> String {
    let env_block = if cfg.env.is_empty() {
        String::new()
    } else {
        let vars: String = cfg.env.iter().map(|e| {
            format!("            - name: {}\n              value: \"{}\"\n", e.key, e.value)
        }).collect();
        format!("          env:\n{}\n", vars)
    };

    format!(
        r#"apiVersion: apps/v1
kind: Deployment
metadata:
  name: {name}
  namespace: {ns}
  labels:
    app: {name}
    managed-by: endfield
spec:
  replicas: {replicas}
  selector:
    matchLabels:
      app: {name}
  template:
    metadata:
      labels:
        app: {name}
    spec:
      containers:
        - name: {name}
          image: {image}
          ports:
            - containerPort: {port}
{env}          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
"#,
        name = cfg.id,
        ns = cfg.namespace,
        replicas = cfg.replicas,
        image = cfg.image,
        port = cfg.port,
        env = env_block,
    )
}

fn generate_service_yaml(cfg: &FieldConfig) -> String {
    format!(
        r#"apiVersion: v1
kind: Service
metadata:
  name: {name}
  namespace: {ns}
  labels:
    app: {name}
    managed-by: endfield
spec:
  selector:
    app: {name}
  ports:
    - protocol: TCP
      port: {port}
      targetPort: {port}
  type: ClusterIP
"#,
        name = cfg.id,
        ns = cfg.namespace,
        port = cfg.port,
    )
}

fn generate_configmap_yaml(cfg: &FieldConfig) -> String {
    format!(
        r#"apiVersion: v1
kind: ConfigMap
metadata:
  name: {name}-config
  namespace: {ns}
  labels:
    app: {name}
    managed-by: endfield
data:
  # Add your configuration here
  APP_PORT: "{port}"
"#,
        name = cfg.id,
        ns = cfg.namespace,
        port = cfg.port,
    )
}

fn generate_namespace_yaml(namespace: &str) -> String {
    format!(
        r#"apiVersion: v1
kind: Namespace
metadata:
  name: {ns}
  labels:
    managed-by: endfield
"#,
        ns = namespace,
    )
}

fn generate_helm_chart_yaml(cfg: &InfraConfig, helm: &HelmInfraConfig) -> String {
    format!(
        r#"apiVersion: v2
name: {id}
description: Endfield managed Helm release for {label}
type: application
version: 0.1.0
dependencies:
  - name: {chart}
    version: "{version}"
    repository: "{repo}"
"#,
        id = cfg.id,
        label = cfg.label,
        chart = helm.chart_name,
        version = helm.chart_version,
        repo = helm.repo_url,
    )
}

fn generate_helm_values_yaml(cfg: &InfraConfig, helm: &HelmInfraConfig) -> String {
    let chart = helm.chart_name.to_lowercase();
    if chart.contains("redis") {
        return r#"redis:
  architecture: standalone
  auth:
    enabled: false
  master:
    persistence:
      enabled: false
  replica:
    replicaCount: 0
    persistence:
      enabled: false
"#.to_string();
    }
    if chart.contains("kafka") {
        return r#"kafka:
  replicaCount: 1
  persistence:
    enabled: false
  kraft:
    enabled: true
  zookeeper:
    persistence:
      enabled: false
"#.to_string();
    }
    if chart.contains("postgres") || chart.contains("postgresql") {
        return r#"postgresql:
  primary:
    persistence:
      enabled: false
  auth:
    postgresPassword: "changeme"
    database: "app"
"#.to_string();
    }
    format!(
        r#"# Values for {chart} - {label}
# Generated by Endfield. Edit as needed.
{chart}:
  # replicaCount: 1
  # persistence:
  #   enabled: false
  #   size: 8Gi
"#,
        chart = helm.chart_name,
        label = cfg.label,
    )
}

fn generate_secret_yaml(cfg: &FieldConfig) -> Option<String> {
    let secret_keys = ["PASSWORD", "SECRET", "KEY", "TOKEN", "PASS"];
    let sensitive: Vec<&EnvVar> = cfg.env.iter()
        .filter(|e| secret_keys.iter().any(|k| e.key.to_uppercase().contains(k)))
        .collect();
    if sensitive.is_empty() {
        return None;
    }
    let data: String = sensitive.iter()
        .map(|e| format!("  {}: \"{}\"\n", e.key, e.value.replace('"', "\\\"")))
        .collect();
    Some(format!(
        r#"apiVersion: v1
kind: Secret
metadata:
  name: {name}-secret
  namespace: {ns}
  labels:
    app: {name}
    managed-by: endfield
type: Opaque
stringData:
{data}"#,
        name = cfg.id,
        ns = cfg.namespace,
        data = data,
    ))
}

fn generate_statefulset_yaml(cfg: &FieldConfig) -> String {
    let secret_keys = ["PASSWORD", "SECRET", "KEY", "TOKEN", "PASS"];
    let has_secret = cfg.env.iter()
        .any(|e| secret_keys.iter().any(|k| e.key.to_uppercase().contains(k)));
    let secret_name = format!("{}-secret", cfg.id);

    let env_block = if cfg.env.is_empty() {
        String::new()
    } else {
        let vars: String = cfg.env.iter().map(|e| {
            let is_sensitive = secret_keys.iter().any(|k| e.key.to_uppercase().contains(k));
            if is_sensitive && has_secret {
                format!(
                    "            - name: {key}\n              valueFrom:\n                secretKeyRef:\n                  name: {secret}\n                  key: {key}\n",
                    key = e.key, secret = secret_name,
                )
            } else {
                format!("            - name: {}\n              value: \"{}\"\n", e.key, e.value)
            }
        }).collect();
        format!("          env:\n{}\n", vars)
    };

    format!(
        r#"apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: {name}
  namespace: {ns}
  labels:
    app: {name}
    managed-by: endfield
spec:
  serviceName: {name}
  replicas: {replicas}
  selector:
    matchLabels:
      app: {name}
  template:
    metadata:
      labels:
        app: {name}
    spec:
      containers:
        - name: {name}
          image: {image}
          ports:
            - containerPort: {port}
{env}          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
          volumeMounts:
            - name: data
              mountPath: /var/lib/{name}
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 10Gi
"#,
        name = cfg.id,
        ns = cfg.namespace,
        replicas = cfg.replicas,
        image = cfg.image,
        port = cfg.port,
        env = env_block,
    )
}

fn is_stateful_image(image: &str) -> bool {
    let img = image.to_lowercase();
    let img = img.split(':').next().unwrap_or("").split('/').last().unwrap_or("");
    img.contains("postgres") || img.contains("mysql") || img.contains("mongo")
        || img.contains("mariadb") || img.contains("redis") || img.contains("kafka")
        || img.contains("redpanda") || img.contains("cassandra") || img.contains("clickhouse")
        || img.contains("rabbitmq") || img.contains("nats") || img.contains("elasticsearch")
}

// ─── Patch replicas ────────────────────────────────────────────────────────────

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

// ─── .endfield layout ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FieldLayoutEntry {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub label: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EndfieldLayout {
    pub version: u32,
    pub project_path: String,
    pub fields: Vec<FieldLayoutEntry>,
}

#[tauri::command]
fn save_endfield_layout(
    project_path: String,
    fields: Vec<FieldLayoutEntry>,
) -> Result<(), String> {
    let layout = EndfieldLayout {
        version: 1,
        project_path: project_path.clone(),
        fields,
    };
    let json = serde_json::to_string_pretty(&layout)
        .map_err(|e| format!("Serialize error: {}", e))?;
    let out_path = Path::new(&project_path).join(".endfield");
    fs::write(&out_path, json)
        .map_err(|e| format!("Cannot write .endfield: {}", e))
}

#[tauri::command]
fn load_endfield_layout(project_path: String) -> Result<EndfieldLayout, String> {
    let in_path = Path::new(&project_path).join(".endfield");
    if !in_path.exists() {
        return Err("No .endfield file found".to_string());
    }
    let content = fs::read_to_string(&in_path)
        .map_err(|e| format!("Cannot read .endfield: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Parse error: {}", e))
}

// ─── NEW: Generate Field ───────────────────────────────────────────────────────

/// Generate manifests for a new Field (app/service) and write them to disk.
/// Does NOT deploy — call deploy_resource() after reviewing.
///
/// Directory layout created:
///   <project_path>/apps/<field_id>/
///     namespace.yaml        (only if namespace is new)
///     deployment.yaml
///     service.yaml
///     configmap.yaml
#[tauri::command]
fn generate_field(mut config: FieldConfig) -> GenerateResult {
    let mut generated_files: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    // Auto-derive namespace if empty
    if config.namespace.is_empty() {
        let project_name = Path::new(&config.project_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("project");
        config.namespace = format!("{}-{}", project_name, config.id);
    }

    let field_dir = Path::new(&config.project_path)
        .join("apps")
        .join(&config.id);

    // Create directory
    if let Err(e) = fs::create_dir_all(&field_dir) {
        return GenerateResult {
            generated_files,
            namespace_created: false,
            namespace: config.namespace,
            warnings,
            error: Some(format!("Cannot create directory {}: {}", field_dir.display(), e)),
        };
    }

    // Write namespace.yaml
    let ns_path = field_dir.join("namespace.yaml");
    let ns_yaml = generate_namespace_yaml(&config.namespace);
    if let Err(e) = fs::write(&ns_path, &ns_yaml) {
        return GenerateResult {
            generated_files,
            namespace_created: false,
            namespace: config.namespace,
            warnings,
            error: Some(format!("Cannot write namespace.yaml: {}", e)),
        };
    }
    generated_files.push(ns_path.to_string_lossy().to_string());

    // Write secret.yaml if env has sensitive keys
    if let Some(secret_yaml) = generate_secret_yaml(&config) {
        let secret_path = field_dir.join(format!("{}-secret.yaml", config.id));
        if let Err(e) = fs::write(&secret_path, &secret_yaml) {
            warnings.push(format!("Cannot write secret.yaml: {}", e));
        } else {
            generated_files.push(secret_path.to_string_lossy().to_string());
        }
    }

    // StatefulSet for databases/caches/queues, Deployment for everything else
    let use_statefulset = is_stateful_image(&config.image);
    if use_statefulset {
        let ss_path = field_dir.join("statefulset.yaml");
        let ss_yaml = generate_statefulset_yaml(&config);
        if let Err(e) = fs::write(&ss_path, &ss_yaml) {
            warnings.push(format!("Cannot write statefulset.yaml: {}", e));
        } else {
            generated_files.push(ss_path.to_string_lossy().to_string());
        }
    } else {
        let deploy_path = field_dir.join("deployment.yaml");
        let deploy_yaml = generate_deployment_yaml(&config);
        if let Err(e) = fs::write(&deploy_path, &deploy_yaml) {
            warnings.push(format!("Cannot write deployment.yaml: {}", e));
        } else {
            generated_files.push(deploy_path.to_string_lossy().to_string());
        }
    }

    // Write service.yaml
    let svc_path = field_dir.join("service.yaml");
    let svc_yaml = generate_service_yaml(&config);
    if let Err(e) = fs::write(&svc_path, &svc_yaml) {
        warnings.push(format!("Cannot write service.yaml: {}", e));
    } else {
        generated_files.push(svc_path.to_string_lossy().to_string());
    }

    // ConfigMap only for stateless workloads
    if !use_statefulset {
        let cm_path = field_dir.join("configmap.yaml");
        let cm_yaml = generate_configmap_yaml(&config);
        if let Err(e) = fs::write(&cm_path, &cm_yaml) {
            warnings.push(format!("Cannot write configmap.yaml: {}", e));
        } else {
            generated_files.push(cm_path.to_string_lossy().to_string());
        }
    }

    GenerateResult {
        generated_files,
        namespace_created: true, // file was written; actual cluster create happens on deploy
        namespace: config.namespace,
        warnings,
        error: None,
    }
}

// ─── NEW: Generate Infra ──────────────────────────────────────────────────────

/// Generate manifests or Helm scaffold for an Infrastructure component.
///
/// For Helm:
///   <project_path>/infra/<infra_id>/
///     namespace.yaml
///     helm/Chart.yaml
///     helm/values.yaml
///     rendered/           (empty, populated on helm_template)
///
/// For Raw:
///   Files are expected to exist already — this command just validates structure.
#[tauri::command]
fn generate_infra(config: InfraConfig) -> GenerateResult {
    let mut generated_files: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    let namespace = config
        .namespace
        .clone()
        .unwrap_or_else(|| format!("infra-{}", config.id));

    let infra_dir = Path::new(&config.project_path)
        .join("infra")
        .join(&config.id);

    if let Err(e) = fs::create_dir_all(&infra_dir) {
        return GenerateResult {
            generated_files,
            namespace_created: false,
            namespace,
            warnings,
            error: Some(format!("Cannot create directory {}: {}", infra_dir.display(), e)),
        };
    }

    // Write namespace.yaml
    let ns_path = infra_dir.join("namespace.yaml");
    let ns_yaml = generate_namespace_yaml(&namespace);
    if let Err(e) = fs::write(&ns_path, &ns_yaml) {
        return GenerateResult {
            generated_files,
            namespace_created: false,
            namespace,
            warnings,
            error: Some(format!("Cannot write namespace.yaml: {}", e)),
        };
    }
    generated_files.push(ns_path.to_string_lossy().to_string());

    if config.source == "helm" {
        let helm = match &config.helm {
            Some(h) => h.clone(),
            None => {
                return GenerateResult {
                    generated_files,
                    namespace_created: false,
                    namespace,
                    warnings,
                    error: Some("source=helm but helm config is missing".to_string()),
                }
            }
        };

        let helm_dir = infra_dir.join("helm");
        if let Err(e) = fs::create_dir_all(&helm_dir) {
            return GenerateResult {
                generated_files,
                namespace_created: false,
                namespace,
                warnings,
                error: Some(format!("Cannot create helm/: {}", e)),
            };
        }

        // Write Chart.yaml
        let chart_path = helm_dir.join("Chart.yaml");
        let chart_yaml = generate_helm_chart_yaml(&config, &helm);
        if let Err(e) = fs::write(&chart_path, &chart_yaml) {
            warnings.push(format!("Cannot write Chart.yaml: {}", e));
        } else {
            generated_files.push(chart_path.to_string_lossy().to_string());
        }

        // Write values.yaml (only if no custom values_path provided)
        if helm.values_path.is_none() {
            let values_path = helm_dir.join("values.yaml");
            let values_yaml = generate_helm_values_yaml(&config, &helm);
            if let Err(e) = fs::write(&values_path, &values_yaml) {
                warnings.push(format!("Cannot write values.yaml: {}", e));
            } else {
                generated_files.push(values_path.to_string_lossy().to_string());
            }
        }

        // Create rendered/ placeholder
        let rendered_dir = infra_dir.join("rendered");
        if let Err(e) = fs::create_dir_all(&rendered_dir) {
            warnings.push(format!("Cannot create rendered/: {}", e));
        } else {
            // .gitkeep so the directory is tracked by git
            let gitkeep = rendered_dir.join(".gitkeep");
            let _ = fs::write(&gitkeep, "");
            generated_files.push(rendered_dir.to_string_lossy().to_string());
        }
    } else {
        // Raw YAML — validate that a yaml file exists
        if let Some(raw_path) = &config.raw_yaml_path {
            let full = Path::new(&config.project_path).join(raw_path);
            if !full.exists() {
                warnings.push(format!(
                    "Raw YAML path does not exist: {}",
                    full.display()
                ));
            }
        } else {
            warnings.push("source=raw but raw_yaml_path is not provided".to_string());
        }
    }

    GenerateResult {
        generated_files,
        namespace_created: true,
        namespace,
        warnings,
        error: None,
    }
}

// ─── NEW: Deploy Resource ─────────────────────────────────────────────────────

/// Deploy a resource to the cluster.
///
/// For source="helm":
///   1. helm repo add <repo_name> <repo_url>       (if repo_url is set)
///   2. helm dependency update <helm_dir>
///   3. helm template → write to rendered/
///   4. helm upgrade --install ...
///
/// For source="raw":
///   1. kubectl apply -f <dir>  (entire field/infra dir)
///
/// Namespace is always ensured before deploy.
#[tauri::command]
async fn deploy_resource(
    resource_id: String,
    source: String,
    resource_dir: String,
    namespace: String,
    helm_release: Option<String>,
    helm_repo_name: Option<String>,
    helm_repo_url: Option<String>,
    values_file: Option<String>,
) -> DeployResult {
    tauri::async_runtime::spawn_blocking(move || {
        deploy_resource_inner(resource_id, source, resource_dir, namespace,
            helm_release, helm_repo_name, helm_repo_url, values_file)
    }).await.unwrap_or_else(|e| DeployResult {
        resource_id: String::new(), namespace: String::new(),
        source: String::new(), stdout: String::new(),
        stderr: format!("spawn error: {}", e),
        success: false, commands_run: vec![],
    })
}

fn deploy_resource_inner(
    resource_id: String,
    source: String,
    resource_dir: String,
    namespace: String,
    helm_release: Option<String>,
    helm_repo_name: Option<String>,
    helm_repo_url: Option<String>,
    values_file: Option<String>,
) -> DeployResult {
    let mut commands_run: Vec<String> = Vec::new();
    let dir = Path::new(&resource_dir);

    // Ensure namespace exists in cluster
    match ensure_namespace(&namespace) {
        Ok(_created) => {
            commands_run.push(format!(
                "kubectl get namespace {} || kubectl create namespace {}",
                namespace, namespace
            ));
        }
        Err(e) => {
            return DeployResult {
                resource_id,
                namespace,
                source,
                stdout: String::new(),
                stderr: e.clone(),
                success: false,
                commands_run,
            };
        }
    }

    if source == "helm" {
        let helm_dir = dir.join("helm");
        let release = helm_release.unwrap_or_else(|| resource_id.clone());
        let values_path = values_file.unwrap_or_else(|| {
            helm_dir.join("values.yaml").to_string_lossy().to_string()
        });

        // Step 1: helm repo add (if repo_url provided)
        if let (Some(repo_name), Some(repo_url)) = (&helm_repo_name, &helm_repo_url) {
            let repo_add_cmd = format!("helm repo add {} {}", repo_name, repo_url);
            commands_run.push(repo_add_cmd);
            // Not fatal — repo might already exist
            let _ = run_helm(&["repo", "add", repo_name, repo_url], dir);
            let _ = run_helm(&["repo", "update"], dir);
            commands_run.push("helm repo update".to_string());
        }

        // Step 2: helm dependency update
        let dep_cmd = format!("helm dependency update {}", helm_dir.display());
        commands_run.push(dep_cmd);
        if let Err(e) = run_helm(&["dependency", "update", "."], &helm_dir) {
            return DeployResult {
                resource_id,
                namespace,
                source,
                stdout: String::new(),
                stderr: format!("helm dependency update failed: {}", e),
                success: false,
                commands_run,
            };
        }

        // Step 3: helm template → rendered/
        let template_cmd = format!(
            "helm template {} . --namespace {} --values {} --include-crds",
            release, namespace, values_path
        );
        commands_run.push(template_cmd);
        match run_helm(
            &[
                "template", &release, ".",
                "--namespace", &namespace,
                "--values", &values_path,
                "--include-crds",
            ],
            &helm_dir,
        ) {
            Ok(raw) => {
                let rendered_dir = dir.join("rendered");
                let _ = fs::create_dir_all(&rendered_dir);
                // Clear old rendered files
                if let Ok(entries) = fs::read_dir(&rendered_dir) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if p.file_name().and_then(|n| n.to_str()) != Some(".gitkeep") {
                            let _ = fs::remove_file(&p);
                        }
                    }
                }
                for (filename, content) in split_rendered_manifests(&raw) {
                    let _ = fs::write(rendered_dir.join(&filename), content);
                }
            }
            Err(e) => {
                // Non-fatal — warn but continue to install
                eprintln!("helm template warning: {}", e);
            }
        }

        // Step 4: helm upgrade --install (no --wait — returns immediately, cluster deploys async)
        let install_cmd = format!(
            "helm upgrade --install {} . --namespace {} --create-namespace --values {} --atomic=false",
            release, namespace, values_path
        );
        commands_run.push(install_cmd);
        let (stdout, stderr, success) = run_helm_output(
            &[
                "upgrade", "--install", &release, ".",
                "--namespace", &namespace,
                "--create-namespace",
                "--values", &values_path,
                "--atomic=false",
            ],
            &helm_dir,
        );

        DeployResult {
            resource_id,
            namespace,
            source,
            stdout,
            stderr,
            success,
            commands_run,
        }
    } else {
        // Raw YAML — apply entire directory
        let apply_cmd = format!("kubectl apply -f {} --recursive", dir.display());
        commands_run.push(apply_cmd);
        let dir_str = dir.to_string_lossy().to_string();
        let (stdout, stderr, success) = run_kubectl_output(&[
            "apply", "-f", &dir_str, "--recursive",
        ]);

        DeployResult {
            resource_id,
            namespace,
            source,
            stdout,
            stderr,
            success,
            commands_run,
        }
    }
}

// ─── NEW: Delete Resource ─────────────────────────────────────────────────────

/// Remove a resource from the cluster.
/// For helm — runs helm uninstall.
/// For raw — runs kubectl delete -f <dir>.
/// Does NOT remove files from disk.
#[tauri::command]
async fn remove_resource(
    resource_id: String,
    source: String,
    resource_dir: String,
    namespace: String,
    helm_release: Option<String>,
) -> DeployResult {
    tauri::async_runtime::spawn_blocking(move || {
        remove_resource_inner(resource_id, source, resource_dir, namespace, helm_release)
    }).await.unwrap_or_else(|e| DeployResult {
        resource_id: String::new(), namespace: String::new(),
        source: String::new(), stdout: String::new(),
        stderr: format!("spawn error: {}", e),
        success: false, commands_run: vec![],
    })
}

fn remove_resource_inner(
    resource_id: String,
    source: String,
    resource_dir: String,
    namespace: String,
    helm_release: Option<String>,
) -> DeployResult {
    let dir = Path::new(&resource_dir);
    let mut commands_run: Vec<String> = Vec::new();

    if source == "helm" {
        let release = helm_release.unwrap_or_else(|| resource_id.clone());
        let cmd = format!(
            "helm uninstall {} --namespace {} --ignore-not-found",
            release, namespace
        );
        commands_run.push(cmd);
        let (stdout, stderr, success) = run_helm_output(
            &["uninstall", &release, "--namespace", &namespace, "--ignore-not-found"],
            dir,
        );
        DeployResult { resource_id, namespace, source, stdout, stderr, success, commands_run }
    } else {
        let dir_str = dir.to_string_lossy().to_string();
        let cmd = format!("kubectl delete -f {} --recursive --ignore-not-found=true", dir_str);
        commands_run.push(cmd);
        let (stdout, stderr, success) = run_kubectl_output(&[
            "delete", "-f", &dir_str, "--recursive", "--ignore-not-found=true",
        ]);
        DeployResult { resource_id, namespace, source, stdout, stderr, success, commands_run }
    }
}

// ─── NEW: Diff Resource ───────────────────────────────────────────────────────

/// Show what would change if we applied the local YAML vs the live cluster state.
/// Uses `kubectl diff -f <dir>` which requires a cluster connection.
/// For Helm, diffs using `helm diff upgrade` (requires helm-diff plugin).
#[tauri::command]
fn diff_resource(
    resource_id: String,
    source: String,
    resource_dir: String,
    namespace: String,
    helm_release: Option<String>,
    values_file: Option<String>,
) -> DiffResult {
    let dir = Path::new(&resource_dir);

    if source == "helm" {
        let helm_dir = dir.join("helm");
        let release = helm_release.unwrap_or_else(|| resource_id.clone());
        let values_path = values_file.unwrap_or_else(|| {
            helm_dir.join("values.yaml").to_string_lossy().to_string()
        });

        // Try helm diff upgrade (requires helm-diff plugin)
        let (stdout, stderr, success) = run_helm_output(
            &[
                "diff", "upgrade", &release, ".",
                "--namespace", &namespace,
                "--values", &values_path,
                "--allow-unreleased",
            ],
            &helm_dir,
        );

        if success || !stdout.is_empty() {
            return DiffResult {
                resource_id,
                diff: stdout,
                has_changes: true,
                error: None,
            };
        }

        // Fallback: diff using rendered/ directory
        let rendered_dir = dir.join("rendered");
        if rendered_dir.exists() {
            let rendered_str = rendered_dir.to_string_lossy().to_string();
            let (diff_out, diff_err, _) = run_kubectl_output(&[
                "diff", "-f", &rendered_str,
            ]);
            return DiffResult {
                resource_id,
                has_changes: !diff_out.is_empty(),
                diff: if diff_out.is_empty() { diff_err } else { diff_out },
                error: if stderr.is_empty() { None } else { Some(stderr) },
            };
        }

        DiffResult {
            resource_id,
            diff: String::new(),
            has_changes: false,
            error: Some(format!("helm diff failed and no rendered/ dir: {}", stderr)),
        }
    } else {
        let dir_str = dir.to_string_lossy().to_string();
        let (stdout, stderr, _exit) = run_kubectl_output(&[
            "diff", "-f", &dir_str, "--recursive",
        ]);
        // kubectl diff exits 1 when there ARE differences — that's not an error
        let has_changes = !stdout.is_empty();
        let error = if !has_changes && !stderr.is_empty() {
            Some(stderr)
        } else {
            None
        };
        DiffResult {
            resource_id,
            diff: stdout,
            has_changes,
            error,
        }
    }
}

// ─── NEW: Get Logs ────────────────────────────────────────────────────────────

/// Get logs for a field. Tries to find a running pod by label app=<field_id>
/// and returns recent logs.
#[tauri::command]
fn get_field_logs(
    field_id: String,
    namespace: String,
    tail: u32,
    previous: bool,
) -> Result<String, String> {
    // List pods matching label
    let pods_raw = run_kubectl(&[
        "get", "pods",
        "-n", &namespace,
        "-l", &format!("app={}", field_id),
        "--no-headers",
        "-o", "custom-columns=NAME:.metadata.name,STATUS:.status.phase",
    ])?;

    let pod_name = pods_raw
        .lines()
        .find_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 && parts[1] == "Running" {
                Some(parts[0].to_string())
            } else if parts.len() >= 1 {
                Some(parts[0].to_string()) // fallback: first pod
            } else {
                None
            }
        })
        .ok_or_else(|| format!("No pods found for app={} in {}", field_id, namespace))?;

    let tail_str = tail.to_string();
    let tail_arg = format!("--tail={}", tail_str);
    let mut args = vec![
        "logs", "-n", &namespace, &pod_name,
        &tail_arg,
    ];
    if previous {
        args.push("--previous");
    }

    run_kubectl(&args)
}

// ─── Scan all project files (for Explorer file tree) ─────────────────────────

/// Returns all .yaml/.yml file paths under a directory recursively,
/// without any kind filtering — used by the Explorer file tree.
fn scan_all_yaml_paths(dir: &Path, result: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.starts_with('.') || name == "node_modules" || name == "vendor" {
            continue;
        }
        if path.is_dir() {
            scan_all_yaml_paths(&path, result);
        } else if path.is_file() {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext == "yaml" || ext == "yml" {
                result.push(path.to_string_lossy().to_string());
            }
        }
    }
}

#[tauri::command]
fn scan_project_files(folder_path: String) -> Vec<String> {
    let mut files = Vec::new();
    scan_all_yaml_paths(Path::new(&folder_path), &mut files);
    files
}



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
        // For workloads: deduplicate by label+namespace (prefer StatefulSet over Deployment etc.)
        // For configs/services/etc.: use kind+label+namespace so they always show separately
        let workload_kinds = ["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job", "CronJob", "Pod"];
        let key = if workload_kinds.contains(&node.kind.as_str()) {
            format!("{}::{}", node.label, node.namespace)
        } else {
            format!("{}::{}::{}", node.kind, node.label, node.namespace)
        };

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
        if !p.exists() {
            result.missing_files.push(file_path.clone());
            continue;
        }

        // Step 1: kubectl delete from cluster
        // Directories (helm component dirs or raw dirs) need --recursive
        let kubectl_args: Vec<&str> = if p.is_dir() {
            vec!["delete", "-f", file_path, "--recursive", "--ignore-not-found=true"]
        } else {
            vec!["delete", "-f", file_path, "--ignore-not-found=true"]
        };

        match run_kubectl(&kubectl_args) {
            Ok(out) => {
                if !out.trim().is_empty() {
                    kubectl_out_lines.push(format!("✓ {} → {}", file_path, out.trim()));
                }
            }
            Err(e) => {
                kubectl_err_lines.push(format!("✗ {} → {}", file_path, e.trim()));
            }
        }

        // Step 2: Delete from disk — handle both files and directories
        let remove_result = if p.is_dir() {
            fs::remove_dir_all(p)
        } else {
            fs::remove_file(p)
        };

        match remove_result {
            Ok(_) => {
                result.deleted_files.push(file_path.clone());
                // For single files: clean up empty parent dir
                if p.is_file() {
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
            }
            Err(e) => {
                result.file_errors.push(format!("{}: {}", file_path, e));
            }
        }
    }

    if !kubectl_out_lines.is_empty() {
        result.kubectl_output = Some(kubectl_out_lines.join("\n"));
    }
    if !kubectl_err_lines.is_empty() {
        result.kubectl_error = Some(kubectl_err_lines.join("\n"));
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
            "--atomic=false",
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

#[tauri::command]
fn helm_template_async(
    component_dir: String,
    release_name: String,
    namespace: String,
    values_file: Option<String>,
) -> Result<String, String> {
    std::thread::spawn(move || {
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
            .unwrap_or_else(|| helm_dir.join(  "values.yaml").to_string_lossy().to_string());
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

// ─── Deploy Image ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Clone)]
pub struct DeployEnvVar {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct DeployPort {
    #[serde(rename = "containerPort")]
    pub container_port: u16,
    pub name: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct DeployResources {
    #[serde(rename = "cpuRequest")]
    pub cpu_request: Option<String>,
    #[serde(rename = "memRequest")]
    pub mem_request: Option<String>,
    #[serde(rename = "cpuLimit")]
    pub cpu_limit: Option<String>,
    #[serde(rename = "memLimit")]
    pub mem_limit: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DeployImageRequest {
    pub namespace: String,
    pub name: String,
    pub image: String,
    pub replicas: u32,
    pub env: Vec<DeployEnvVar>,
    #[serde(rename = "secretEnv")]
    pub secret_env: Vec<DeployEnvVar>,
    pub ports: Vec<DeployPort>,
    #[serde(rename = "serviceType", default = "default_service_type")]
    pub service_type: String,
    pub resources: Option<DeployResources>,
    #[serde(rename = "imagePullSecret")]
    pub image_pull_secret: Option<String>,
    #[serde(rename = "createNamespace", default)]
    pub create_namespace: bool,
}

fn default_service_type() -> String { "ClusterIP".to_string() }

#[derive(Debug, Serialize)]
pub struct DeployImageManifests {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secret: Option<String>,
    pub deployment: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DeployImageResult {
    pub success: bool,
    #[serde(rename = "deploymentName")]
    pub deployment_name: String,
    #[serde(rename = "secretName")]
    pub secret_name: Option<String>,
    #[serde(rename = "serviceName")]
    pub service_name: Option<String>,
    pub namespace: String,
    pub stdout: String,
    pub stderr: String,
    pub error: Option<String>,
    pub manifests: DeployImageManifests,
}

// ── Manifest generators ────────────────────────────────────────────────────────

fn gen_image_namespace(ns: &str) -> String {
    format!(
"apiVersion: v1
kind: Namespace
metadata:
  name: {ns}
  labels:
    app.kubernetes.io/managed-by: endfield
    endfield/type: image-deploy
"
    )
}

fn gen_image_secret(name: &str, ns: &str, vars: &[DeployEnvVar]) -> String {
    let secret_name = format!("{}-secrets", name);
    let data: String = vars.iter()
        .map(|e| format!("  {}: \"{}\"\n", e.key, e.value.replace('"', "\\\"")))
        .collect();
    format!(
"apiVersion: v1
kind: Secret
metadata:
  name: {secret_name}
  namespace: {ns}
  labels:
    app.kubernetes.io/name: {name}
    app.kubernetes.io/managed-by: endfield
    endfield/type: image-deploy
    endfield/namespace: {ns}
type: Opaque
stringData:
{data}"
    )
}

fn gen_image_deployment(req: &DeployImageRequest) -> String {
    let name = &req.name;
    let ns = &req.namespace;
    let secret_name = format!("{}-secrets", name);

    // ports block
    let ports_yaml = if req.ports.is_empty() {
        String::new()
    } else {
        let lines: String = req.ports.iter().map(|p| {
            let name_line = match &p.name {
                Some(n) if !n.is_empty() => format!("              name: {}\n", n),
                _ => String::new(),
            };
            format!("            - containerPort: {}\n{}", p.container_port, name_line)
        }).collect();
        format!("          ports:\n{}", lines)
    };

    // plain env
    let plain_env: String = req.env.iter().map(|e| {
        format!("            - name: {}\n              value: \"{}\"\n", e.key, e.value.replace('"', "\\\""))
    }).collect();

    // secret env via secretKeyRef
    let secret_env: String = req.secret_env.iter().map(|e| {
        format!(
"            - name: {key}
              valueFrom:
                secretKeyRef:
                  name: {secret_name}
                  key: {key}
",
            key = e.key,
            secret_name = secret_name,
        )
    }).collect();

    let env_block = if plain_env.is_empty() && secret_env.is_empty() {
        String::new()
    } else {
        format!("          env:\n{}{}", plain_env, secret_env)
    };

    // resources block
    let resources_block = match &req.resources {
        Some(r) => {
            let cpu_req = r.cpu_request.as_deref().unwrap_or("100m");
            let mem_req = r.mem_request.as_deref().unwrap_or("128Mi");
            let cpu_lim = r.cpu_limit.as_deref().unwrap_or("500m");
            let mem_lim = r.mem_limit.as_deref().unwrap_or("512Mi");
            format!(
"          resources:
            requests:
              cpu: \"{cpu_req}\"
              memory: \"{mem_req}\"
            limits:
              cpu: \"{cpu_lim}\"
              memory: \"{mem_lim}\"
"
            )
        }
        None => String::new(),
    };

    // imagePullSecrets block
    let pull_secrets_block = match &req.image_pull_secret {
        Some(s) if !s.is_empty() => format!(
"      imagePullSecrets:
        - name: {s}
"
        ),
        _ => String::new(),
    };

    format!(
"apiVersion: apps/v1
kind: Deployment
metadata:
  name: {name}
  namespace: {ns}
  labels:
    app.kubernetes.io/name: {name}
    app.kubernetes.io/managed-by: endfield
    endfield/type: image-deploy
    endfield/namespace: {ns}
spec:
  replicas: {replicas}
  selector:
    matchLabels:
      app.kubernetes.io/name: {name}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: {name}
        app.kubernetes.io/managed-by: endfield
    spec:
{pull_secrets_block}      containers:
        - name: {name}
          image: {image}
{ports_yaml}{env_block}{resources_block}",
        name = name,
        ns = ns,
        replicas = req.replicas,
        image = req.image,
        pull_secrets_block = pull_secrets_block,
        ports_yaml = ports_yaml,
        env_block = env_block,
        resources_block = resources_block,
    )
}

fn gen_image_service(name: &str, ns: &str, ports: &[DeployPort], service_type: &str) -> String {
    let port_lines: String = ports.iter().map(|p| {
        let name_line = match &p.name {
            Some(n) if !n.is_empty() => format!("      name: {}\n    ", n),
            _ => String::new(),
        };
        format!(
"    - {}port: {port}
      targetPort: {port}
      protocol: TCP
",
            name_line,
            port = p.container_port,
        )
    }).collect();

    format!(
"apiVersion: v1
kind: Service
metadata:
  name: {name}
  namespace: {ns}
  labels:
    app.kubernetes.io/name: {name}
    app.kubernetes.io/managed-by: endfield
    endfield/type: image-deploy
    endfield/namespace: {ns}
spec:
  selector:
    app.kubernetes.io/name: {name}
  type: {service_type}
  ports:
{port_lines}"
    )
}

/// Deploy a custom Docker image to Kubernetes.
/// Generates manifests in-memory and applies them via kubectl apply --server-side.
/// Idempotent: re-running updates image/env/replicas.
#[tauri::command]
async fn deploy_image(request: DeployImageRequest) -> DeployImageResult {
    tauri::async_runtime::spawn_blocking(move || {
        deploy_image_inner(request)
    }).await.unwrap_or_else(|e| DeployImageResult {
        success: false,
        deployment_name: String::new(),
        secret_name: None,
        service_name: None,
        namespace: String::new(),
        stdout: String::new(),
        stderr: format!("spawn error: {}", e),
        error: Some(format!("spawn error: {}", e)),
        manifests: DeployImageManifests {
            namespace: None,
            secret: None,
            deployment: String::new(),
            service: None,
        },
    })
}

fn deploy_image_inner(req: DeployImageRequest) -> DeployImageResult {
    let name = req.name.clone();
    let ns = req.namespace.clone();
    let has_secret = !req.secret_env.is_empty();
    let has_service = !req.ports.is_empty();
    let secret_name = if has_secret { Some(format!("{}-secrets", name)) } else { None };
    let service_name = if has_service { Some(name.clone()) } else { None };

    // Build manifests
    let ns_manifest = if req.create_namespace {
        Some(gen_image_namespace(&ns))
    } else {
        None
    };
    let secret_manifest = if has_secret {
        Some(gen_image_secret(&name, &ns, &req.secret_env))
    } else {
        None
    };
    let deploy_manifest = gen_image_deployment(&req);
    let service_manifest = if has_service {
        Some(gen_image_service(&name, &ns, &req.ports, &req.service_type))
    } else {
        None
    };

    // Apply order: Namespace → Secret → Deployment → Service
    let mut all_stdout = Vec::<String>::new();
    let mut all_stderr = Vec::<String>::new();
    let mut overall_success = true;

    // Ensure namespace
    if req.create_namespace {
        let yaml = ns_manifest.as_deref().unwrap();
        match kubectl_apply_manifest(yaml, &ns) {
            Ok(out) => all_stdout.push(out),
            Err(e) => { all_stderr.push(e.clone()); overall_success = false; }
        }
    } else {
        // Just ensure it exists (non-fatal)
        let _ = ensure_namespace(&ns);
    }

    if !overall_success {
        return DeployImageResult {
            success: false,
            deployment_name: name,
            secret_name,
            service_name,
            namespace: ns,
            stdout: all_stdout.join("\n"),
            stderr: all_stderr.join("\n"),
            error: Some(all_stderr.join("\n")),
            manifests: DeployImageManifests {
                namespace: ns_manifest,
                secret: secret_manifest,
                deployment: deploy_manifest,
                service: service_manifest,
            },
        };
    }

    // Apply Secret
    if let Some(ref yaml) = secret_manifest {
        match kubectl_apply_manifest(yaml, &ns) {
            Ok(out) => all_stdout.push(out),
            Err(e) => { all_stderr.push(e); overall_success = false; }
        }
    }

    // Apply Deployment
    match kubectl_apply_manifest(&deploy_manifest, &ns) {
        Ok(out) => all_stdout.push(out),
        Err(e) => { all_stderr.push(e); overall_success = false; }
    }

    // Apply Service
    if let Some(ref yaml) = service_manifest {
        match kubectl_apply_manifest(yaml, &ns) {
            Ok(out) => all_stdout.push(out),
            Err(e) => { all_stderr.push(e); overall_success = false; }
        }
    }

    let err = if overall_success { None } else { Some(all_stderr.join("\n")) };

    DeployImageResult {
        success: overall_success,
        deployment_name: name,
        secret_name,
        service_name,
        namespace: ns,
        stdout: all_stdout.join("\n"),
        stderr: all_stderr.join("\n"),
        error: err,
        manifests: DeployImageManifests {
            namespace: ns_manifest,
            secret: secret_manifest,
            deployment: deploy_manifest,
            service: service_manifest,
        },
    }
}

/// Apply a YAML string via kubectl apply --server-side (stdin).
fn kubectl_apply_manifest(yaml: &str, _namespace: &str) -> Result<String, String> {
    use std::io::Write;
    let mut child = Command::new("kubectl")
        .args(["apply", "--server-side", "--field-manager=endfield", "-f", "-"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("kubectl not found: {}", e))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin.write_all(yaml.as_bytes())
            .map_err(|e| format!("stdin write error: {}", e))?;
    }

    let output = child.wait_with_output()
        .map_err(|e| format!("kubectl wait error: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

// ─── Ingress Nginx Types ──────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IngressNginxStatus {
    pub ingress_class_name: String,
    pub controller_service_name: String,
    pub endpoint: Option<String>,
    pub ready: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IngressRoute {
    pub route_id: String,
    pub field_id: String,
    pub target_namespace: String,
    pub target_service: String,
    pub target_port_number: Option<u32>,
    pub target_port_name: Option<String>,
    pub host: Option<String>,
    pub path: String,
    pub path_type: String,
    pub tls_secret: Option<String>,
    pub tls_hosts: Option<Vec<String>>,
    pub annotations: Option<Vec<(String, String)>>,
    pub ingress_class_name: String,
    pub ingress_name: String,
    pub ingress_namespace: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IngressRouteResult {
    pub route_id: String,
    pub ingress_name: String,
    pub namespace: String,
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiscoveredRoute {
    pub route_id: String,
    pub field_id: String,
    pub ingress_name: String,
    pub ingress_namespace: String,
    pub host: Option<String>,
    pub path: String,
    pub path_type: String,
    pub target_service: String,
    pub target_namespace: String,
    pub target_port_number: Option<u32>,
    pub target_port_name: Option<String>,
    pub ingress_class_name: String,
    pub tls_secret: Option<String>,
    pub address: Option<String>,
}

// ─── Ingress Nginx Commands ───────────────────────────────────────────────────

#[tauri::command]
fn detect_ingress_nginx(namespace: String, release_name: String) -> IngressNginxStatus {
    let ingress_class = run_kubectl(&[
        "get", "ingressclass",
        "-l", &format!("app.kubernetes.io/instance={}", release_name),
        "-o", "jsonpath={.items[0].metadata.name}",
    ])
    .unwrap_or_else(|_| "nginx".to_string());
    let ingress_class = if ingress_class.is_empty() { "nginx".to_string() } else { ingress_class };

    let svc_name = run_kubectl(&[
        "get", "service", "-n", &namespace,
        "-l", &format!("app.kubernetes.io/instance={}", release_name),
        "-o", "jsonpath={.items[0].metadata.name}",
    ])
    .unwrap_or_default();

    let endpoint = if !svc_name.is_empty() {
        let lb = run_kubectl(&[
            "get", "service", &svc_name, "-n", &namespace,
            "-o", "jsonpath={.status.loadBalancer.ingress[0].ip}",
        ]).ok().filter(|s| !s.is_empty());
        if lb.is_some() { lb } else {
            run_kubectl(&[
                "get", "service", &svc_name, "-n", &namespace,
                "-o", "jsonpath={.status.loadBalancer.ingress[0].hostname}",
            ]).ok().filter(|s| !s.is_empty())
        }
    } else { None };

    IngressNginxStatus {
        ingress_class_name: ingress_class,
        controller_service_name: svc_name.clone(),
        endpoint,
        ready: !svc_name.is_empty(),
    }
}

fn generate_ingress_yaml(route: &IngressRoute) -> String {
    let port_spec = if let Some(n) = route.target_port_number {
        format!("number: {}", n)
    } else if let Some(name) = &route.target_port_name {
        format!("name: {}", name)
    } else {
        "number: 80".to_string()
    };

    let host_rules = if let Some(host) = &route.host {
        format!(
"  rules:\n    - host: {host}\n      http:\n        paths:\n          - path: {path}\n            pathType: {pt}\n            backend:\n              service:\n                name: {svc}\n                port:\n                  {port}\n",
            host=host, path=route.path, pt=route.path_type,
            svc=route.target_service, port=port_spec)
    } else {
        format!(
"  rules:\n    - http:\n        paths:\n          - path: {path}\n            pathType: {pt}\n            backend:\n              service:\n                name: {svc}\n                port:\n                  {port}\n",
            path=route.path, pt=route.path_type,
            svc=route.target_service, port=port_spec)
    };

    let tls_block = match (&route.tls_secret, &route.tls_hosts) {
        (Some(secret), Some(hosts)) if !hosts.is_empty() => {
            let hl: String = hosts.iter().map(|h| format!("        - {}\n", h)).collect();
            format!("  tls:\n    - hosts:\n{}      secretName: {}\n", hl, secret)
        }
        _ => String::new(),
    };

    let mut ann = format!(
        "    app.kubernetes.io/managed-by: endfield\n    endfield.io/fieldId: {}\n    endfield.io/routeId: {}\n",
        route.field_id, route.route_id
    );
    if let Some(anns) = &route.annotations {
        for (k, v) in anns { ann.push_str(&format!("    {}: {}\n", k, v)); }
    }

    format!(
"apiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata:\n  name: {name}\n  namespace: {ns}\n  labels:\n    app.kubernetes.io/managed-by: endfield\n    endfield.io/fieldId: {fid}\n    endfield.io/routeId: {rid}\n  annotations:\n{ann}spec:\n  ingressClassName: {class}\n{tls}{rules}",
        name=route.ingress_name, ns=route.ingress_namespace,
        fid=route.field_id, rid=route.route_id, ann=ann,
        class=route.ingress_class_name, tls=tls_block, rules=host_rules)
}

#[tauri::command]
async fn apply_ingress_route(route: IngressRoute) -> IngressRouteResult {
    tauri::async_runtime::spawn_blocking(move || {
        let yaml = generate_ingress_yaml(&route);
        let _ = ensure_namespace(&route.ingress_namespace);
        match kubectl_apply_manifest(&yaml, &route.ingress_namespace) {
            Ok(out) => IngressRouteResult {
                route_id: route.route_id, ingress_name: route.ingress_name,
                namespace: route.ingress_namespace, stdout: out,
                stderr: String::new(), success: true,
            },
            Err(e) => IngressRouteResult {
                route_id: route.route_id, ingress_name: route.ingress_name,
                namespace: route.ingress_namespace, stdout: String::new(),
                stderr: e, success: false,
            },
        }
    }).await.unwrap_or_else(|e| IngressRouteResult {
        route_id: String::new(), ingress_name: String::new(),
        namespace: String::new(), stdout: String::new(),
        stderr: format!("spawn error: {}", e), success: false,
    })
}

#[tauri::command]
fn get_ingress_route_yaml(route: IngressRoute) -> String {
    generate_ingress_yaml(&route)
}

#[tauri::command]
fn delete_ingress_route(ingress_name: String, namespace: String) -> Result<String, String> {
    run_kubectl(&["delete", "ingress", &ingress_name, "-n", &namespace, "--ignore-not-found=true"])
}

#[tauri::command]
fn discover_ingress_routes() -> Vec<DiscoveredRoute> {
    let items_raw = match run_kubectl(&[
        "get", "ingress", "--all-namespaces",
        "-l", "app.kubernetes.io/managed-by=endfield",
        "--no-headers", "-o",
        "custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name,CLASS:.spec.ingressClassName",
    ]) {
        Ok(o) => o,
        Err(_) => return vec![],
    };

    let mut routes = Vec::new();
    for line in items_raw.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 { continue; }
        let ns = parts[0];
        let name = parts[1];
        let class = parts.get(2).copied().unwrap_or("nginx");

        let field_id = run_kubectl(&["get", "ingress", name, "-n", ns,
            "-o", "jsonpath={.metadata.annotations.endfield\\.io/fieldId}"])
            .unwrap_or_default();
        let route_id = run_kubectl(&["get", "ingress", name, "-n", ns,
            "-o", "jsonpath={.metadata.annotations.endfield\\.io/routeId}"])
            .unwrap_or_default();
        if field_id.is_empty() || route_id.is_empty() { continue; }

        let path = run_kubectl(&["get", "ingress", name, "-n", ns,
            "-o", "jsonpath={.spec.rules[0].http.paths[0].path}"])
            .unwrap_or_else(|_| "/".to_string());
        let path_type = run_kubectl(&["get", "ingress", name, "-n", ns,
            "-o", "jsonpath={.spec.rules[0].http.paths[0].pathType}"])
            .unwrap_or_else(|_| "Prefix".to_string());
        let host = run_kubectl(&["get", "ingress", name, "-n", ns,
            "-o", "jsonpath={.spec.rules[0].host}"])
            .ok().filter(|s| !s.is_empty());
        let svc = run_kubectl(&["get", "ingress", name, "-n", ns,
            "-o", "jsonpath={.spec.rules[0].http.paths[0].backend.service.name}"])
            .unwrap_or_default();
        let port_num: Option<u32> = run_kubectl(&["get", "ingress", name, "-n", ns,
            "-o", "jsonpath={.spec.rules[0].http.paths[0].backend.service.port.number}"])
            .ok().and_then(|s| s.parse().ok());
        let port_name = run_kubectl(&["get", "ingress", name, "-n", ns,
            "-o", "jsonpath={.spec.rules[0].http.paths[0].backend.service.port.name}"])
            .ok().filter(|s| !s.is_empty());
        let tls_secret = run_kubectl(&["get", "ingress", name, "-n", ns,
            "-o", "jsonpath={.spec.tls[0].secretName}"])
            .ok().filter(|s| !s.is_empty());
        let address = run_kubectl(&["get", "ingress", name, "-n", ns,
            "-o", "jsonpath={.status.loadBalancer.ingress[0].ip}"])
            .ok().filter(|s| !s.is_empty());

        routes.push(DiscoveredRoute {
            route_id, field_id, ingress_name: name.to_string(),
            ingress_namespace: ns.to_string(), host,
            path: if path.is_empty() { "/".to_string() } else { path },
            path_type: if path_type.is_empty() { "Prefix".to_string() } else { path_type },
            target_service: svc, target_namespace: ns.to_string(),
            target_port_number: port_num, target_port_name: port_name,
            ingress_class_name: class.to_string(), tls_secret, address,
        });
    }
    routes
}

#[tauri::command]
fn list_services_in_namespace(namespace: String) -> Vec<(String, Vec<String>)> {
    let raw = run_kubectl(&[
        "get", "services", "-n", &namespace, "--no-headers",
        "-o", "custom-columns=NAME:.metadata.name,PORTS:.spec.ports[*].port",
    ]).unwrap_or_default();
    raw.lines().filter_map(|line| {
        let mut parts = line.splitn(2, char::is_whitespace);
        let name = parts.next()?.trim().to_string();
        if name.is_empty() || name == "<none>" { return None; }
        let ports_str = parts.next().unwrap_or("").trim();
        let ports: Vec<String> = if ports_str == "<none>" { vec![] } else {
            ports_str.split(',').map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect()
        };
        Some((name, ports))
    }).collect()
}

#[tauri::command]
fn list_namespaces() -> Vec<String> {
    run_kubectl(&["get", "namespaces", "--no-headers",
        "-o", "custom-columns=NAME:.metadata.name"])
        .unwrap_or_default()
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

// ─── File Watcher ─────────────────────────────────────────────────────────────

/// Payload emitted to the frontend when a YAML file changes.
#[derive(Debug, Clone, Serialize)]
pub struct FileChangedPayload {
    pub path: String,
    pub kind: String, // "modify" | "create" | "remove"
}

/// Global watcher handle — lives for the duration of a project session.
/// Stored in Tauri managed state so Tauri drops it when the app exits.
pub struct WatcherState(pub Mutex<Option<RecommendedWatcher>>);

/// Start watching `project_path` recursively.
/// Fires `yaml-file-changed` events on the Tauri window whenever a .yaml/.yml
/// file is created, modified, or removed.
///
/// Calling this again with a different path replaces the previous watcher.
/// Debounce: multiple events for the same file within 300 ms are collapsed.
#[tauri::command]
fn watch_project(
    app: tauri::AppHandle,
    state: tauri::State<WatcherState>,
    project_path: String,
) -> Result<(), String> {
    let watch_path = PathBuf::from(&project_path);
    if !watch_path.exists() {
        return Err(format!("Path does not exist: {}", project_path));
    }

    // Debounce state: last event time per path
    let debounce: Arc<Mutex<std::collections::HashMap<PathBuf, Instant>>> =
        Arc::new(Mutex::new(std::collections::HashMap::new()));

    let app_handle = app.clone();
    let debounce_clone = debounce.clone();

    let watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        let event = match res {
            Ok(e) => e,
            Err(_) => return,
        };

        // Only care about yaml/yml files
        for path in &event.paths {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext != "yaml" && ext != "yml" {
                continue;
            }
            // Skip rendered/ and charts/ — those are generated, not user-edited
            let skip = path.components().any(|c| {
                let s = c.as_os_str().to_str().unwrap_or("");
                s == "rendered" || s == "charts" || s == ".git"
            });
            if skip {
                continue;
            }

            // Debounce: drop duplicate events within 300ms
            let now = Instant::now();
            {
                let mut map = debounce_clone.lock().unwrap();
                if let Some(last) = map.get(path) {
                    if now.duration_since(*last) < Duration::from_millis(300) {
                        continue;
                    }
                }
                map.insert(path.clone(), now);
            }

            let kind = match event.kind {
                EventKind::Create(_) => "create",
                EventKind::Remove(_) => "remove",
                _ => "modify",
            };

            let payload = FileChangedPayload {
                path: path.to_string_lossy().to_string(),
                kind: kind.to_string(),
            };

            let _ = app_handle.emit("yaml-file-changed", payload);
        }
    })
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    // Configure and start watching
    let mut watcher = watcher;
    watcher
        .watch(&watch_path, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch {}: {}", project_path, e))?;

    // Store, replacing any previous watcher (drop closes old one)
    let mut guard = state.0.lock().unwrap();
    *guard = Some(watcher);

    Ok(())
}

/// Stop the current file watcher, if any.
#[tauri::command]
fn unwatch_project(state: tauri::State<WatcherState>) {
    let mut guard = state.0.lock().unwrap();
    *guard = None; // Drop the watcher — this unregisters OS-level watches
}

// ─── Main ──────────────────────────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            // Project / file IO
            open_folder_dialog,
            scan_yaml_files,
            scan_project_files,
            read_yaml_file,
            save_yaml_file,
            // Generation (new)
            generate_field,
            generate_infra,
            // Deploy / delete (new)
            deploy_resource,
            remove_resource,
            diff_resource,
            get_field_logs,
            // Cluster state
            get_cluster_status,
            // kubectl helpers
            delete_field_files,
            kubectl_delete_by_label,
            apply_replicas,
            kubectl_apply,
            kubectl_apply_async,
            get_pod_logs,
            get_events,
            // Helm
            helm_template,
            helm_template_async,
            helm_install,
            helm_install_async,
            helm_uninstall,
            helm_available,
            // Layout
            save_endfield_layout,
            load_endfield_layout,
            // Deploy Image
            deploy_image,
            // File watcher
            watch_project,
            unwatch_project,
            // Ingress Nginx
            detect_ingress_nginx,
            apply_ingress_route,
            get_ingress_route_yaml,
            delete_ingress_route,
            discover_ingress_routes,
            list_services_in_namespace,
            list_namespaces,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
