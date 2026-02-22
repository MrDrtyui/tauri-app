/**
 * tauriStore.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin wrapper around `invoke` that:
 *   1. Calls real Tauri commands
 *   2. Falls back to sensible mock data only when NOT in Tauri context
 *      (dev browser preview).
 *
 * ALL panels / components should import from here instead of mockData.ts.
 */

import { invoke } from "@tauri-apps/api/core";

// ─── Types (mirror Rust structs) ──────────────────────────────────────────────

export interface HelmNodeMeta {
  release_name: string;
  namespace: string;
  chart_name: string;
  chart_version: string;
  repo: string;
  values_path: string;
  rendered_dir: string;
}

export interface YamlNode {
  id: string;
  label: string;
  kind: string;
  image: string;
  type_id: string;
  namespace: string;
  file_path: string;
  replicas: number | null;
  source: "raw" | "helm";
  helm?: HelmNodeMeta;
  /** Canvas X position (percent). Populated from .endfield or autoLayout. */
  x: number;
  /** Canvas Y position (percent). Populated from .endfield or autoLayout. */
  y: number;
  group_x?: number | null;
  group_y?: number | null;
}

export interface ScanResult {
  nodes: YamlNode[];
  project_path: string;
  errors: string[];
}

export interface PodInfo {
  name: string;
  namespace: string;
  phase: string;
  ready: number;
  total: number;
  restarts: number;
}

export interface FieldStatus {
  label: string;
  namespace: string;
  desired: number;
  ready: number;
  available: number;
  status: "green" | "yellow" | "red" | "gray";
  pods: PodInfo[];
}

export interface ClusterStatus {
  fields: FieldStatus[];
  kubectl_available: boolean;
  error: string | null;
}

export interface HelmRenderResult {
  rendered_files: string[];
  warnings: string[];
  error: string | null;
}

export interface FieldLayoutEntry {
  id: string;
  x: number;
  y: number;
  label: string;
}

export interface EndfieldLayout {
  version: number;
  project_path: string;
  fields: FieldLayoutEntry[];
}

// ─── Tauri detection ──────────────────────────────────────────────────────────

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ─── safeInvoke ──────────────────────────────────────────────────────────────

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    if (IS_TAURI) throw e; // real Tauri error — surface it
    // Browser dev fallback
    return devFallback<T>(cmd, args);
  }
}

function devFallback<T>(cmd: string, args?: Record<string, unknown>): T {
  console.warn(`[dev-fallback] ${cmd}`, args);
  switch (cmd) {
    case "open_folder_dialog":
      return "/home/user/infra" as T;
    case "scan_yaml_files":
      return DEV_SCAN_RESULT as T;
    case "read_yaml_file":
      return "# dev fallback\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: example\n" as T;
    case "get_cluster_status":
      return DEV_CLUSTER_STATUS as T;
    case "apply_replicas":
    case "kubectl_apply":
      return "✓ Applied (dev)" as T;
    case "save_yaml_file":
    case "delete_field_files":
    case "save_endfield_layout":
      return undefined as T;
    case "load_endfield_layout":
      throw new Error("No .endfield file found");
    case "helm_template":
      return { rendered_files: [], warnings: [], error: null } as T;
    case "helm_install":
      return "✓ helm upgrade --install succeeded (dev)" as T;
    case "helm_available":
      return false as T;
    default:
      throw new Error(`Unknown command: ${cmd}`);
  }
}

// ─── Dev fallback data ────────────────────────────────────────────────────────

const DEV_SCAN_RESULT: ScanResult = {
  project_path: "/home/user/infra",
  errors: [],
  nodes: [
    {
      id: "nginx-0",
      label: "ingress-nginx",
      kind: "HelmRelease",
      image: "helm:ingress-nginx/4.10.1",
      type_id: "gateway",
      namespace: "infra-ingress-nginx",
      file_path: "/home/user/infra/infra/ingress-nginx/helm/Chart.yaml",
      replicas: null,
      x: 8, y: 40,
      source: "helm",
      helm: {
        release_name: "ingress-nginx",
        namespace: "infra-ingress-nginx",
        chart_name: "ingress-nginx",
        chart_version: "4.10.1",
        repo: "https://kubernetes.github.io/ingress-nginx",
        values_path: "/home/user/infra/infra/ingress-nginx/helm/values.yaml",
        rendered_dir: "/home/user/infra/infra/ingress-nginx/rendered",
      },
    },
    {
      id: "auth-1",
      label: "auth-service",
      kind: "Deployment",
      image: "myapp/auth:v1.2.0",
      type_id: "service",
      namespace: "myapp",
      file_path: "/home/user/infra/apps/auth-deployment.yaml",
      replicas: 3,
      x: 32, y: 15,
      source: "raw",
    },
    {
      id: "api-2",
      label: "api-gateway",
      kind: "Deployment",
      image: "myapp/api:v2.1.0",
      type_id: "service",
      namespace: "myapp",
      file_path: "/home/user/infra/apps/api-deployment.yaml",
      replicas: 2,
      x: 32, y: 50,
      source: "raw",
    },
    {
      id: "frontend-3",
      label: "frontend",
      kind: "Deployment",
      image: "myapp/frontend:v1.0.0",
      type_id: "service",
      namespace: "myapp",
      file_path: "/home/user/infra/apps/frontend-deployment.yaml",
      replicas: 2,
      x: 32, y: 80,
      source: "raw",
    },
    {
      id: "redis-4",
      label: "redis",
      kind: "HelmRelease",
      image: "helm:redis/19.5.5",
      type_id: "cache",
      namespace: "infra-redis",
      file_path: "/home/user/infra/infra/redis/helm/Chart.yaml",
      replicas: null,
      x: 60, y: 15,
      source: "helm",
      helm: {
        release_name: "redis",
        namespace: "infra-redis",
        chart_name: "redis",
        chart_version: "19.5.5",
        repo: "https://charts.bitnami.com/bitnami",
        values_path: "/home/user/infra/infra/redis/helm/values.yaml",
        rendered_dir: "/home/user/infra/infra/redis/rendered",
      },
    },
    {
      id: "postgres-5",
      label: "postgres-db",
      kind: "StatefulSet",
      image: "postgres:16-alpine",
      type_id: "database",
      namespace: "myapp",
      file_path: "/home/user/infra/databases/postgres-statefulset.yaml",
      replicas: 1,
      x: 60, y: 45,
      source: "raw",
    },
    {
      id: "kafka-6",
      label: "kafka-broker",
      kind: "StatefulSet",
      image: "confluentinc/cp-kafka:7.6.0",
      type_id: "queue",
      namespace: "myapp",
      file_path: "/home/user/infra/messaging/kafka-statefulset.yaml",
      replicas: 3,
      x: 60, y: 72,
      source: "raw",
    },
    {
      id: "monitoring-7",
      label: "kube-prometheus-stack",
      kind: "HelmRelease",
      image: "helm:kube-prometheus-stack/58.0.0",
      type_id: "monitoring",
      namespace: "infra-monitoring",
      file_path: "/home/user/infra/infra/monitoring/helm/Chart.yaml",
      replicas: null,
      x: 84, y: 40,
      source: "helm",
      helm: {
        release_name: "kube-prometheus-stack",
        namespace: "infra-monitoring",
        chart_name: "kube-prometheus-stack",
        chart_version: "58.0.0",
        repo: "https://prometheus-community.github.io/helm-charts",
        values_path: "/home/user/infra/infra/monitoring/helm/values.yaml",
        rendered_dir: "/home/user/infra/infra/monitoring/rendered",
      },
    },
  ],
};

const DEV_CLUSTER_STATUS: ClusterStatus = {
  kubectl_available: true,
  error: null,
  fields: [
    { label: "ingress-nginx",         namespace: "infra-ingress-nginx", desired: 1, ready: 1, available: 1, status: "green",  pods: [] },
    { label: "auth-service",          namespace: "myapp",               desired: 3, ready: 2, available: 2, status: "yellow", pods: [] },
    { label: "api-gateway",           namespace: "myapp",               desired: 2, ready: 2, available: 2, status: "green",  pods: [] },
    { label: "frontend",              namespace: "myapp",               desired: 2, ready: 2, available: 2, status: "green",  pods: [] },
    { label: "redis",                 namespace: "infra-redis",          desired: 1, ready: 1, available: 1, status: "green",  pods: [] },
    { label: "postgres-db",           namespace: "myapp",               desired: 1, ready: 1, available: 1, status: "green",  pods: [] },
    { label: "kafka-broker",          namespace: "myapp",               desired: 3, ready: 3, available: 3, status: "green",  pods: [] },
    { label: "kube-prometheus-stack", namespace: "infra-monitoring",    desired: 1, ready: 1, available: 1, status: "green",  pods: [] },
  ],
};

// ─── Auto-layout helper ───────────────────────────────────────────────────────

export function autoLayout(nodes: YamlNode[]): YamlNode[] {
  const cols = 5;
  const xStep = 18;
  const yStep = 18;
  const xStart = 5;
  const yStart = 8;
  return nodes.map((n, i) => ({
    ...n,
    x: n.x || xStart + (i % cols) * xStep,
    y: n.y || yStart + Math.floor(i / cols) * yStep,
  }));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Open a folder picker dialog → returns selected path or null */
export async function openFolderDialog(): Promise<string | null> {
  const result = await safeInvoke<string | null>("open_folder_dialog");
  return result;
}

/** Scan a folder for Kubernetes YAML / Helm nodes */
export async function scanYamlFiles(folderPath: string): Promise<ScanResult> {
  return safeInvoke<ScanResult>("scan_yaml_files", { folderPath });
}

/** Read a file from disk */
export async function readYamlFile(filePath: string): Promise<string> {
  return safeInvoke<string>("read_yaml_file", { filePath });
}

/** Write a file to disk */
export async function saveYamlFile(filePath: string, content: string): Promise<void> {
  return safeInvoke("save_yaml_file", { filePath, content });
}

/** Get live cluster status via kubectl */
export async function getClusterStatus(): Promise<ClusterStatus> {
  return safeInvoke<ClusterStatus>("get_cluster_status");
}

/** Patch replicas in YAML + kubectl apply */
export async function applyReplicas(
  filePath: string,
  nodeLabel: string,
  replicas: number,
): Promise<string> {
  return safeInvoke<string>("apply_replicas", { filePath, nodeLabel, replicas });
}

/** kubectl apply a single file */
export async function kubectlApply(path: string): Promise<string> {
  return safeInvoke<string>("kubectl_apply", { path });
}

/** kubectl apply async (fire-and-forget) */
export async function kubectlApplyAsync(path: string): Promise<void> {
  return safeInvoke("kubectl_apply_async", { path });
}

/** Delete field YAML files + kubectl delete */
export async function deleteFieldFiles(
  filePaths: string[],
  namespace: string,
): Promise<void> {
  return safeInvoke("delete_field_files", { filePaths, namespace });
}

/** Render Helm chart templates into rendered/ */
export async function helmTemplate(
  componentDir: string,
  releaseName: string,
  namespace: string,
  valuesFile?: string,
): Promise<HelmRenderResult> {
  return safeInvoke<HelmRenderResult>("helm_template", {
    componentDir,
    releaseName,
    namespace,
    valuesFile,
  });
}

/** helm upgrade --install */
export async function helmInstall(
  componentDir: string,
  releaseName: string,
  namespace: string,
  valuesFile?: string,
): Promise<string> {
  return safeInvoke<string>("helm_install", { componentDir, releaseName, namespace, valuesFile });
}

/** helm uninstall */
export async function helmUninstall(
  releaseName: string,
  namespace: string,
): Promise<string> {
  return safeInvoke<string>("helm_uninstall", { releaseName, namespace });
}

/** Check helm CLI availability */
export async function helmAvailable(): Promise<boolean> {
  return safeInvoke<boolean>("helm_available");
}

/** Get pod logs */
export async function getPodLogs(
  namespace: string,
  podName: string,
  tail: number,
): Promise<string> {
  return safeInvoke<string>("get_pod_logs", { namespace, podName, tail });
}

/** Get cluster events */
export async function getEvents(namespace: string): Promise<string> {
  return safeInvoke<string>("get_events", { namespace });
}

// ─── .endfield layout ────────────────────────────────────────────────────────

/**
 * Save field positions to `<projectPath>/.endfield`.
 * Called automatically after every drag-drop in GraphPanel.
 */
export async function saveEndfieldLayout(
  projectPath: string,
  fields: FieldLayoutEntry[],
): Promise<void> {
  await safeInvoke("save_endfield_layout", { projectPath, fields });
}

/**
 * Load field positions from `<projectPath>/.endfield`.
 * Returns null if the file doesn't exist yet.
 */
export async function loadEndfieldLayout(
  projectPath: string,
): Promise<EndfieldLayout | null> {
  try {
    return await safeInvoke<EndfieldLayout>("load_endfield_layout", { projectPath });
  } catch {
    return null;
  }
}

/** Apply saved layout positions onto scanned nodes */
export function applyLayoutToNodes(
  nodes: YamlNode[],
  layout: EndfieldLayout | null,
): YamlNode[] {
  if (!layout) return autoLayout(nodes);
  const posMap = new Map<string, { x: number; y: number }>(
    layout.fields.map((f) => [f.label, { x: f.x, y: f.y }]),
  );
  const placed = nodes.map((n) => {
    const pos = posMap.get(n.label);
    return pos ? { ...n, x: pos.x, y: pos.y } : n;
  });
  // Nodes without saved positions still get auto-layout
  return autoLayout(placed);
}
