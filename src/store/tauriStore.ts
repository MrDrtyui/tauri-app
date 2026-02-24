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

// ─── Types (mirror Rust structs exactly) ─────────────────────────────────────

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
  x: number;
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

// ─── New pipeline types ───────────────────────────────────────────────────────

/** mirrors Rust EnvVar { key, value } */
export interface EnvVar {
  key: string;
  value: string;
}

/** mirrors Rust FieldConfig */
export interface FieldConfig {
  id: string;
  label: string;
  namespace: string;
  image: string;
  replicas: number;
  port: number;
  env: EnvVar[];
  project_path: string;
}

/** mirrors Rust HelmInfraConfig */
export interface HelmInfraConfig {
  repo_name: string;
  repo_url: string;
  chart_name: string;
  chart_version: string;
  /** path to values override file relative to project_path, or null for default */
  values_path?: string | null;
}

/** mirrors Rust InfraConfig */
export interface InfraConfig {
  id: string;
  label: string;
  /** "helm" | "raw" */
  source: "helm" | "raw";
  namespace?: string | null;
  helm?: HelmInfraConfig | null;
  raw_yaml_path?: string | null;
  project_path: string;
}

/** mirrors Rust GenerateResult */
export interface GenerateResult {
  generated_files: string[];
  namespace_created: boolean;
  namespace: string;
  warnings: string[];
  error: string | null;
}

/** mirrors Rust DeployResult */
export interface DeployResult {
  resource_id: string;
  namespace: string;
  /** "helm" | "raw" */
  source: string;
  stdout: string;
  stderr: string;
  success: boolean;
  /** Exact shell commands that were run — show in Logs panel */
  commands_run: string[];
}

/** mirrors Rust DiffResult */
export interface DiffResult {
  resource_id: string;
  diff: string;
  has_changes: boolean;
  error: string | null;
}

// ─── Tauri detection ──────────────────────────────────────────────────────────

const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ─── safeInvoke ──────────────────────────────────────────────────────────────

async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    if (IS_TAURI) throw e;
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
    case "scan_project_files":
      return [] as T;
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
    // ── New commands ──
    case "generate_field":
      return {
        generated_files: [
          "apps/field/deployment.yaml",
          "apps/field/service.yaml",
          "apps/field/configmap.yaml",
        ],
        namespace_created: true,
        namespace:
          (args as { config?: FieldConfig })?.config?.namespace ?? "default",
        warnings: [],
        error: null,
      } as T;
    case "generate_infra":
      return {
        generated_files: [
          "infra/component/namespace.yaml",
          "infra/component/helm/Chart.yaml",
          "infra/component/helm/values.yaml",
        ],
        namespace_created: true,
        namespace:
          (args as { config?: InfraConfig })?.config?.namespace ??
          "infra-component",
        warnings: [],
        error: null,
      } as T;
    case "deploy_resource":
      return {
        resource_id:
          (args as Record<string, string>)?.resource_id ?? "resource",
        namespace: (args as Record<string, string>)?.namespace ?? "default",
        source: (args as Record<string, string>)?.source ?? "raw",
        stdout: "deployment.apps/resource configured (dev)",
        stderr: "",
        success: true,
        commands_run: [
          "kubectl get namespace default || kubectl create namespace default",
          "helm repo add bitnami https://charts.bitnami.com/bitnami",
          "helm repo update",
          "helm dependency update ./helm",
          "helm template resource . --namespace default --values ./helm/values.yaml --include-crds",
          "helm upgrade --install resource . --namespace default --create-namespace --values ./helm/values.yaml --atomic=false",
        ],
      } as T;
    case "remove_resource":
      return {
        resource_id:
          (args as Record<string, string>)?.resource_id ?? "resource",
        namespace: (args as Record<string, string>)?.namespace ?? "default",
        source: (args as Record<string, string>)?.source ?? "raw",
        stdout: "deployment.apps/resource deleted (dev)",
        stderr: "",
        success: true,
        commands_run: [
          "kubectl delete -f apps/resource/ --recursive --ignore-not-found=true",
        ],
      } as T;
    case "diff_resource":
      return {
        resource_id:
          (args as Record<string, string>)?.resource_id ?? "resource",
        diff: "",
        has_changes: false,
        error: null,
      } as T;
    case "get_field_logs":
      return "# dev fallback logs\nINFO server started on :8080" as T;
    case "deploy_image": {
      const req = (args as { request: DeployImageRequest }).request;
      const n = req.name;
      const ns = req.namespace;
      const secretName = req.secretEnv?.length ? `${n}-secrets` : null;
      const serviceName = req.ports?.length ? n : null;
      return {
        success: true,
        deploymentName: n,
        secretName,
        serviceName,
        namespace: ns,
        stdout: `[dev] deployment.apps/${n} configured\n${serviceName ? `service/${n} configured` : ""}`,
        stderr: "",
        error: null,
        manifests: {
          namespace: req.createNamespace
            ? `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${ns}\n`
            : undefined,
          secret: secretName
            ? `apiVersion: v1\nkind: Secret\nmetadata:\n  name: ${secretName}\n  namespace: ${ns}\ntype: Opaque\nstringData:\n` +
              req.secretEnv.map((e) => `  ${e.key}: "${e.value}"`).join("\n") +
              "\n"
            : undefined,
          deployment: `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${n}\n  namespace: ${ns}\n  labels:\n    app.kubernetes.io/name: ${n}\n    app.kubernetes.io/managed-by: endfield\n    endfield/type: image-deploy\nspec:\n  replicas: ${req.replicas}\n  selector:\n    matchLabels:\n      app.kubernetes.io/name: ${n}\n  template:\n    metadata:\n      labels:\n        app.kubernetes.io/name: ${n}\n    spec:\n      containers:\n        - name: ${n}\n          image: ${req.image}\n`,
          service: serviceName
            ? `apiVersion: v1\nkind: Service\nmetadata:\n  name: ${n}\n  namespace: ${ns}\nspec:\n  selector:\n    app.kubernetes.io/name: ${n}\n  type: ${req.serviceType}\n`
            : undefined,
        },
      } as T;
    }
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
      x: 8,
      y: 40,
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
      x: 32,
      y: 15,
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
      x: 32,
      y: 50,
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
      x: 32,
      y: 80,
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
      x: 60,
      y: 15,
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
      x: 60,
      y: 45,
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
      x: 60,
      y: 72,
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
      x: 84,
      y: 40,
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
    {
      label: "ingress-nginx",
      namespace: "infra-ingress-nginx",
      desired: 1,
      ready: 1,
      available: 1,
      status: "green",
      pods: [],
    },
    {
      label: "auth-service",
      namespace: "myapp",
      desired: 3,
      ready: 2,
      available: 2,
      status: "yellow",
      pods: [],
    },
    {
      label: "api-gateway",
      namespace: "myapp",
      desired: 2,
      ready: 2,
      available: 2,
      status: "green",
      pods: [],
    },
    {
      label: "frontend",
      namespace: "myapp",
      desired: 2,
      ready: 2,
      available: 2,
      status: "green",
      pods: [],
    },
    {
      label: "redis",
      namespace: "infra-redis",
      desired: 1,
      ready: 1,
      available: 1,
      status: "green",
      pods: [],
    },
    {
      label: "postgres-db",
      namespace: "myapp",
      desired: 1,
      ready: 1,
      available: 1,
      status: "green",
      pods: [],
    },
    {
      label: "kafka-broker",
      namespace: "myapp",
      desired: 3,
      ready: 3,
      available: 3,
      status: "green",
      pods: [],
    },
    {
      label: "kube-prometheus-stack",
      namespace: "infra-monitoring",
      desired: 1,
      ready: 1,
      available: 1,
      status: "green",
      pods: [],
    },
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

// ─── Public API — existing commands ──────────────────────────────────────────

export async function openFolderDialog(): Promise<string | null> {
  return safeInvoke<string | null>("open_folder_dialog");
}

export async function scanYamlFiles(folderPath: string): Promise<ScanResult> {
  return safeInvoke<ScanResult>("scan_yaml_files", { folderPath });
}

export async function readYamlFile(filePath: string): Promise<string> {
  return safeInvoke<string>("read_yaml_file", { filePath });
}

export async function scanProjectFiles(folderPath: string): Promise<string[]> {
  return safeInvoke<string[]>("scan_project_files", { folderPath });
}

export async function saveYamlFile(
  filePath: string,
  content: string,
): Promise<void> {
  return safeInvoke("save_yaml_file", { filePath, content });
}

export async function getClusterStatus(): Promise<ClusterStatus> {
  return safeInvoke<ClusterStatus>("get_cluster_status");
}

export async function applyReplicas(
  filePath: string,
  nodeLabel: string,
  replicas: number,
): Promise<string> {
  return safeInvoke<string>("apply_replicas", {
    filePath,
    nodeLabel,
    replicas,
  });
}

export async function kubectlApply(path: string): Promise<string> {
  return safeInvoke<string>("kubectl_apply", { path });
}

export async function kubectlApplyAsync(path: string): Promise<void> {
  return safeInvoke("kubectl_apply_async", { path });
}

export async function deleteFieldFiles(
  filePaths: string[],
  namespace: string,
): Promise<void> {
  return safeInvoke("delete_field_files", { filePaths, namespace });
}

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

export async function helmInstall(
  componentDir: string,
  releaseName: string,
  namespace: string,
  valuesFile?: string,
): Promise<string> {
  return safeInvoke<string>("helm_install", {
    componentDir,
    releaseName,
    namespace,
    valuesFile,
  });
}

export async function helmUninstall(
  releaseName: string,
  namespace: string,
): Promise<string> {
  return safeInvoke<string>("helm_uninstall", { releaseName, namespace });
}

export async function helmAvailable(): Promise<boolean> {
  return safeInvoke<boolean>("helm_available");
}

export async function getPodLogs(
  namespace: string,
  podName: string,
  tail: number,
): Promise<string> {
  return safeInvoke<string>("get_pod_logs", { namespace, podName, tail });
}

export async function getEvents(namespace: string): Promise<string> {
  return safeInvoke<string>("get_events", { namespace });
}

// ─── .endfield layout ────────────────────────────────────────────────────────

export async function saveEndfieldLayout(
  projectPath: string,
  fields: FieldLayoutEntry[],
): Promise<void> {
  await safeInvoke("save_endfield_layout", { projectPath, fields });
}

export async function loadEndfieldLayout(
  projectPath: string,
): Promise<EndfieldLayout | null> {
  try {
    return await safeInvoke<EndfieldLayout>("load_endfield_layout", {
      projectPath,
    });
  } catch {
    return null;
  }
}

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
  return autoLayout(placed);
}

// ─── Public API — NEW pipeline commands ──────────────────────────────────────

/**
 * Generate YAML manifests for a Field workload.
 * Writes: apps/<id>/namespace.yaml, deployment.yaml, service.yaml, configmap.yaml
 * Does NOT deploy. Returns list of created files.
 */
export async function generateField(
  config: FieldConfig,
): Promise<GenerateResult> {
  return safeInvoke<GenerateResult>("generate_field", { config });
}

/**
 * Generate Helm scaffold or validate Raw YAML structure for an Infra component.
 * For Helm: writes infra/<id>/namespace.yaml, helm/Chart.yaml, helm/values.yaml, rendered/.gitkeep
 * For Raw: validates raw_yaml_path exists.
 * Does NOT deploy.
 */
export async function generateInfra(
  config: InfraConfig,
): Promise<GenerateResult> {
  return safeInvoke<GenerateResult>("generate_infra", { config });
}

/**
 * Deploy a resource to the cluster.
 *
 * For source="helm":
 *   1. helm repo add <repo_name> <repo_url>
 *   2. helm repo update
 *   3. helm dependency update
 *   4. helm template → rendered/
 *   5. helm upgrade --install
 *
 * For source="raw":
 *   kubectl apply -f <resource_dir> --recursive
 *
 * IMPORTANT: This Tauri command is async on the Rust side — it won't freeze the UI.
 * Namespace is always ensured before deploy.
 * Returns exact commands that were run.
 */
export async function deployResource(
  resourceId: string,
  source: "helm" | "raw",
  resourceDir: string,
  namespace: string,
  opts?: {
    helmRelease?: string;
    helmRepoName?: string;
    helmRepoUrl?: string;
    valuesFile?: string;
  },
): Promise<DeployResult> {
  return safeInvoke<DeployResult>("deploy_resource", {
    resourceId,
    source,
    resourceDir,
    namespace,
    helmRelease: opts?.helmRelease ?? null,
    helmRepoName: opts?.helmRepoName ?? null,
    helmRepoUrl: opts?.helmRepoUrl ?? null,
    valuesFile: opts?.valuesFile ?? null,
  });
}

/**
 * Remove a resource from the cluster.
 * For helm: helm uninstall. For raw: kubectl delete -f.
 * Does NOT remove files from disk.
 */
export async function removeResource(
  resourceId: string,
  source: "helm" | "raw",
  resourceDir: string,
  namespace: string,
  helmRelease?: string,
): Promise<DeployResult> {
  return safeInvoke<DeployResult>("remove_resource", {
    resourceId,
    source,
    resourceDir,
    namespace,
    helmRelease: helmRelease ?? null,
  });
}

/**
 * Show what would change if local YAML were applied.
 * For raw: kubectl diff -f <dir>.
 * For helm: helm diff upgrade (requires helm-diff plugin), falls back to kubectl diff on rendered/.
 */
export async function diffResource(
  resourceId: string,
  source: "helm" | "raw",
  resourceDir: string,
  namespace: string,
  opts?: { helmRelease?: string; valuesFile?: string },
): Promise<DiffResult> {
  return safeInvoke<DiffResult>("diff_resource", {
    resourceId,
    source,
    resourceDir,
    namespace,
    helmRelease: opts?.helmRelease ?? null,
    valuesFile: opts?.valuesFile ?? null,
  });
}

/**
 * Get logs for a field. Finds a running pod by label app=<fieldId>.
 */
export async function getFieldLogs(
  fieldId: string,
  namespace: string,
  tail = 100,
  previous = false,
): Promise<string> {
  return safeInvoke<string>("get_field_logs", {
    fieldId,
    namespace,
    tail,
    previous,
  });
}

// ─── Deploy Image types ───────────────────────────────────────────────────────

export interface EnvVarPlain {
  key: string;
  value: string;
}

export interface EnvVarSecret {
  key: string;
  value: string;
}

export interface PortMapping {
  containerPort: number;
  name?: string;
}

export interface ResourceRequirements {
  cpuRequest?: string;
  memRequest?: string;
  cpuLimit?: string;
  memLimit?: string;
}

export interface DeployImageRequest {
  namespace: string;
  name: string;
  image: string;
  replicas: number;
  env: EnvVarPlain[];
  secretEnv: EnvVarSecret[];
  ports: PortMapping[];
  serviceType: "ClusterIP" | "NodePort" | "LoadBalancer";
  resources?: ResourceRequirements;
  imagePullSecret?: string;
  createNamespace: boolean;
}

export interface DeployImageResult {
  success: boolean;
  deploymentName: string;
  secretName: string | null;
  serviceName: string | null;
  namespace: string;
  stdout: string;
  stderr: string;
  error: string | null;
  manifests: {
    namespace?: string;
    secret?: string;
    deployment: string;
    service?: string;
  };
}

/**
 * Generate manifests and deploy a custom Docker image to the cluster.
 * Creates: Namespace (optional), Secret (if secretEnv), Deployment, Service (if ports).
 * Idempotent: re-deploy updates image/env/replicas.
 */
export async function deployImage(
  request: DeployImageRequest,
): Promise<DeployImageResult> {
  return safeInvoke<DeployImageResult>("deploy_image", { request });
}

// ─── File Watcher ─────────────────────────────────────────────────────────────

export interface FileChangedPayload {
  path: string;
  kind: "modify" | "create" | "remove";
}

/**
 * Start watching project_path for YAML file changes.
 * The backend emits `yaml-file-changed` events on any .yaml/.yml mutation.
 * Call this once when a project is opened; call unwatchProject on close.
 */
export async function watchProject(projectPath: string): Promise<void> {
  return safeInvoke("watch_project", { projectPath });
}

/**
 * Stop the current file watcher. Safe to call even if no watcher is active.
 */
export async function unwatchProject(): Promise<void> {
  return safeInvoke("unwatch_project");
}
