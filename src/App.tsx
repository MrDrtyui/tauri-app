import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

// ─── Types ────────────────────────────────────────────────────────────────────

interface YamlNode {
  id: string;
  label: string;
  kind: string;
  image: string;
  type_id: string;
  typeId: string;
  namespace: string;
  file_path: string;
  filePath: string;
  replicas: number | null;
  x: number;
  y: number;
}

interface PodInfo {
  name: string;
  namespace: string;
  phase: string;
  ready: number;
  total: number;
  restarts: number;
}

interface FieldStatus {
  label: string;
  namespace: string;
  desired: number;
  ready: number;
  available: number;
  status: "green" | "yellow" | "red" | "gray";
  pods: PodInfo[];
}

interface ClusterStatus {
  fields: FieldStatus[];
  kubectl_available: boolean;
  error: string | null;
}

interface ScanResult {
  nodes: YamlNode[];
  project_path: string;
  errors: string[];
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  nodeId: string | null;
  label: string;
  kind: string;
  namespace: string;
}

// ─── Field Preset Definitions ─────────────────────────────────────────────────

interface FieldEnvVar {
  key: string;
  value: string;
}

interface FieldPreset {
  typeId: string;
  image: string;
  defaultPort: number;
  kind: "Deployment" | "StatefulSet";
  replicas: number;
  description: string;
  folder: string;
  generateConfigMap?: boolean;
  generateService?: boolean;
  storageSize?: string;
  envVars: FieldEnvVar[];
}

const FIELD_PRESETS: Record<string, FieldPreset> = {
  postgres: {
    typeId: "database",
    image: "postgres:16-alpine",
    defaultPort: 5432,
    kind: "StatefulSet",
    replicas: 1,
    description: "PostgreSQL — relational database",
    folder: "databases",
    generateConfigMap: true,
    generateService: true,
    storageSize: "10Gi",
    envVars: [
      { key: "POSTGRES_DB", value: "appdb" },
      { key: "POSTGRES_USER", value: "postgres" },
      { key: "POSTGRES_PASSWORD", value: "changeme" },
    ],
  },
  mongodb: {
    typeId: "database",
    image: "mongo:7",
    defaultPort: 27017,
    kind: "StatefulSet",
    replicas: 1,
    description: "MongoDB — document database",
    folder: "databases",
    generateService: true,
    storageSize: "10Gi",
    envVars: [
      { key: "MONGO_INITDB_ROOT_USERNAME", value: "root" },
      { key: "MONGO_INITDB_ROOT_PASSWORD", value: "changeme" },
      { key: "MONGO_INITDB_DATABASE", value: "appdb" },
    ],
  },
  redis: {
    typeId: "cache",
    image: "redis:7-alpine",
    defaultPort: 6379,
    kind: "StatefulSet",
    replicas: 1,
    description: "Redis — in-memory cache & broker",
    folder: "cache",
    generateService: true,
    storageSize: "2Gi",
    envVars: [],
  },
  kafka: {
    typeId: "queue",
    image: "confluentinc/cp-kafka:7.6.0",
    defaultPort: 9092,
    kind: "StatefulSet",
    replicas: 1,
    description: "Apache Kafka — event streaming",
    folder: "messaging",
    generateConfigMap: true,
    generateService: true,
    storageSize: "20Gi",
    envVars: [
      { key: "KAFKA_BROKER_ID", value: "1" },
      { key: "KAFKA_ZOOKEEPER_CONNECT", value: "zookeeper:2181" },
      { key: "KAFKA_ADVERTISED_LISTENERS", value: "PLAINTEXT://kafka:9092" },
      { key: "KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR", value: "1" },
      { key: "KAFKA_AUTO_CREATE_TOPICS_ENABLE", value: "true" },
    ],
  },
  redpanda: {
    typeId: "queue",
    image: "redpandadata/redpanda:v23.3.11",
    defaultPort: 9092,
    kind: "StatefulSet",
    replicas: 1,
    description: "Redpanda — Kafka-compatible (no ZooKeeper)",
    folder: "messaging",
    generateService: true,
    storageSize: "20Gi",
    envVars: [],
  },
  nginx: {
    typeId: "gateway",
    image: "nginx:1.25-alpine",
    defaultPort: 80,
    kind: "Deployment",
    replicas: 2,
    description: "Nginx — web server & reverse proxy",
    folder: "ingress",
    generateConfigMap: true,
    generateService: true,
    envVars: [],
  },
  "ingress-nginx": {
    typeId: "gateway",
    image: "registry.k8s.io/ingress-nginx/controller:v1.9.6",
    defaultPort: 80,
    kind: "Deployment",
    replicas: 1,
    description: "Nginx Ingress Controller — routes HTTP/S to services",
    folder: "ingress",
    generateService: true,
    envVars: [],
  },
  grafana: {
    typeId: "monitoring",
    image: "grafana/grafana:10.3.1",
    defaultPort: 3000,
    kind: "Deployment",
    replicas: 1,
    description: "Grafana — metrics dashboards",
    folder: "monitoring",
    generateService: true,
    storageSize: "5Gi",
    envVars: [
      { key: "GF_SECURITY_ADMIN_PASSWORD", value: "admin" },
      { key: "GF_USERS_ALLOW_SIGN_UP", value: "false" },
    ],
  },
  prometheus: {
    typeId: "monitoring",
    image: "prom/prometheus:v2.49.1",
    defaultPort: 9090,
    kind: "Deployment",
    replicas: 1,
    description: "Prometheus — metrics & alerting",
    folder: "monitoring",
    generateConfigMap: true,
    generateService: true,
    storageSize: "10Gi",
    envVars: [],
  },
  custom: {
    typeId: "service",
    image: "",
    defaultPort: 8080,
    kind: "Deployment",
    replicas: 1,
    description: "Custom microservice",
    folder: "services",
    generateService: true,
    envVars: [
      { key: "PORT", value: "8080" },
      { key: "NODE_ENV", value: "production" },
    ],
  },
};

// ─── YAML Config Generator ────────────────────────────────────────────────────

function generateConfigs(
  name: string,
  preset: FieldPreset,
  namespace: string,
  port: number,
  envVars: FieldEnvVar[],
): Record<string, string> {
  const files: Record<string, string> = {};
  const n = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const f = preset.folder;

  // Namespace
  files[`namespace.yaml`] =
    `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${namespace}\n  labels:\n    managed-by: endfield\n`;

  // ConfigMap
  if (preset.generateConfigMap && envVars.length > 0) {
    const data = envVars.map((e) => `  ${e.key}: "${e.value}"`).join("\n");
    files[`${f}/${n}-configmap.yaml`] =
      `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${n}-config\n  namespace: ${namespace}\n  labels:\n    app: ${n}\n    managed-by: endfield\ndata:\n${data}\n`;
  }

  // Env section
  const envSection =
    envVars.length > 0
      ? `\n        env:\n` +
        envVars
          .map((e) =>
            preset.generateConfigMap
              ? `          - name: ${e.key}\n            valueFrom:\n              configMapKeyRef:\n                name: ${n}-config\n                key: ${e.key}`
              : `          - name: ${e.key}\n            value: "${e.value}"`,
          )
          .join("\n")
      : "";

  const volumeSection = preset.storageSize
    ? `\n      volumeMounts:\n        - name: data\n          mountPath: /data\n  volumeClaimTemplates:\n    - metadata:\n        name: data\n      spec:\n        accessModes: ["ReadWriteOnce"]\n        resources:\n          requests:\n            storage: ${preset.storageSize}`
    : "";

  // Workload
  if (preset.kind === "StatefulSet") {
    files[`${f}/${n}-statefulset.yaml`] =
      `apiVersion: apps/v1\nkind: StatefulSet\nmetadata:\n  name: ${n}\n  namespace: ${namespace}\n  labels:\n    app: ${n}\n    managed-by: endfield\nspec:\n  serviceName: ${n}\n  replicas: ${preset.replicas}\n  selector:\n    matchLabels:\n      app: ${n}\n  template:\n    metadata:\n      labels:\n        app: ${n}\n    spec:\n      containers:\n        - name: ${n}\n          image: ${preset.image}\n          ports:\n            - containerPort: ${port}\n              name: main${envSection}\n          resources:\n            requests:\n              memory: "128Mi"\n              cpu: "100m"\n            limits:\n              memory: "512Mi"\n              cpu: "500m"${volumeSection}\n`;
  } else {
    files[`${f}/${n}-deployment.yaml`] =
      `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${n}\n  namespace: ${namespace}\n  labels:\n    app: ${n}\n    managed-by: endfield\nspec:\n  replicas: ${preset.replicas}\n  selector:\n    matchLabels:\n      app: ${n}\n  template:\n    metadata:\n      labels:\n        app: ${n}\n    spec:\n      containers:\n        - name: ${n}\n          image: ${preset.image}\n          ports:\n            - containerPort: ${port}${envSection}\n          resources:\n            requests:\n              memory: "64Mi"\n              cpu: "50m"\n            limits:\n              memory: "256Mi"\n              cpu: "250m"\n`;
  }

  // Service
  if (preset.generateService) {
    const svcType = name === "ingress-nginx" ? "LoadBalancer" : "ClusterIP";
    files[`${f}/${n}-service.yaml`] =
      `apiVersion: v1\nkind: Service\nmetadata:\n  name: ${n}\n  namespace: ${namespace}\n  labels:\n    app: ${n}\n    managed-by: endfield\nspec:\n  type: ${svcType}\n  selector:\n    app: ${n}\n  ports:\n    - name: main\n      port: ${port}\n      targetPort: ${port}\n      protocol: TCP\n`;
  }

  return files;
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_SCAN_RESULT: ScanResult = {
  project_path: "/home/user/infra",
  errors: [],
  nodes: [
    {
      id: "nginx-0",
      label: "nginx",
      kind: "Deployment",
      image: "nginx:latest",
      type_id: "gateway",
      typeId: "gateway",
      namespace: "myapp",
      file_path: "/infra/ingress/nginx-deployment.yaml",
      filePath: "/infra/ingress/nginx-deployment.yaml",
      replicas: 2,
      x: 0,
      y: 0,
    },
    {
      id: "auth-1",
      label: "auth-service",
      kind: "Deployment",
      image: "myapp/auth:v1.2",
      type_id: "service",
      typeId: "service",
      namespace: "myapp",
      file_path: "/infra/services/auth-deployment.yaml",
      filePath: "/infra/services/auth-deployment.yaml",
      replicas: 3,
      x: 0,
      y: 0,
    },
    {
      id: "payment-2",
      label: "payment-svc",
      kind: "Deployment",
      image: "myapp/payment:v2.0",
      type_id: "service",
      typeId: "service",
      namespace: "myapp",
      file_path: "/infra/services/payment-deployment.yaml",
      filePath: "/infra/services/payment-deployment.yaml",
      replicas: 3,
      x: 0,
      y: 0,
    },
    {
      id: "redis-3",
      label: "redis-cache",
      kind: "StatefulSet",
      image: "redis:7-alpine",
      type_id: "cache",
      typeId: "cache",
      namespace: "myapp",
      file_path: "/infra/cache/redis-statefulset.yaml",
      filePath: "/infra/cache/redis-statefulset.yaml",
      replicas: 1,
      x: 0,
      y: 0,
    },
    {
      id: "kafka-4",
      label: "kafka-broker",
      kind: "StatefulSet",
      image: "confluentinc/cp-kafka:7.4",
      type_id: "queue",
      typeId: "queue",
      namespace: "myapp",
      file_path: "/infra/messaging/kafka-statefulset.yaml",
      filePath: "/infra/messaging/kafka-statefulset.yaml",
      replicas: 3,
      x: 0,
      y: 0,
    },
    {
      id: "postgres-5",
      label: "postgres-db",
      kind: "StatefulSet",
      image: "postgres:15",
      type_id: "database",
      typeId: "database",
      namespace: "myapp",
      file_path: "/infra/databases/postgres-statefulset.yaml",
      filePath: "/infra/databases/postgres-statefulset.yaml",
      replicas: 1,
      x: 0,
      y: 0,
    },
  ],
};

// ─── Safe invoke ──────────────────────────────────────────────────────────────

async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    console.warn(`[mock] invoke("${cmd}") fallback:`, e);
    if (cmd === "open_folder_dialog") return "/home/user/infra" as T;
    if (cmd === "scan_yaml_files") return MOCK_SCAN_RESULT as T;
    if (cmd === "read_yaml_file")
      return "# mock yaml\napiVersion: apps/v1\nkind: Deployment\n" as T;
    if (cmd === "get_cluster_status")
      return {
        fields: [
          {
            label: "nginx",
            namespace: "myapp",
            desired: 2,
            ready: 2,
            available: 2,
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
            label: "payment-svc",
            namespace: "myapp",
            desired: 3,
            ready: 0,
            available: 0,
            status: "red",
            pods: [],
          },
          {
            label: "redis-cache",
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
            label: "postgres-db",
            namespace: "myapp",
            desired: 1,
            ready: 1,
            available: 1,
            status: "green",
            pods: [],
          },
        ],
        kubectl_available: true,
        error: null,
      } as T;
    if (cmd === "apply_replicas") return "✓ Applied (mock)" as T;
    if (cmd === "save_yaml_file") return undefined as T;
    if (cmd === "kubectl_apply") return "✓ Applied (mock)" as T;
    throw e;
  }
}

// ─── Node type presets ────────────────────────────────────────────────────────

const NODE_TYPES: Record<
  string,
  {
    label: string;
    bg: string;
    border: string;
    color: string;
    shadow: string;
    accent: string;
    icon: string;
  }
> = {
  gateway: {
    label: "Gateway",
    bg: "linear-gradient(135deg, #0f2847 0%, #1a3a6b 100%)",
    border: "rgba(96,165,250,0.6)",
    color: "#bfdbfe",
    shadow: "rgba(59,130,246,0.4)",
    accent: "#3b82f6",
    icon: "⬡",
  },
  service: {
    label: "Service",
    bg: "linear-gradient(135deg, #052e1c 0%, #0d4a2e 100%)",
    border: "rgba(52,211,153,0.6)",
    color: "#6ee7b7",
    shadow: "rgba(16,185,129,0.35)",
    accent: "#10b981",
    icon: "◈",
  },
  database: {
    label: "Database",
    bg: "linear-gradient(135deg, #0a1f3d 0%, #112d58 100%)",
    border: "rgba(59,130,246,0.55)",
    color: "#93c5fd",
    shadow: "rgba(37,99,235,0.4)",
    accent: "#2563eb",
    icon: "◫",
  },
  cache: {
    label: "Cache",
    bg: "linear-gradient(135deg, #2d1000 0%, #4a1f00 100%)",
    border: "rgba(251,146,60,0.6)",
    color: "#fed7aa",
    shadow: "rgba(234,88,12,0.4)",
    accent: "#ea580c",
    icon: "⚡",
  },
  queue: {
    label: "Queue",
    bg: "linear-gradient(135deg, #2d0000 0%, #4a0a0a 100%)",
    border: "rgba(239,68,68,0.6)",
    color: "#fca5a5",
    shadow: "rgba(220,38,38,0.4)",
    accent: "#dc2626",
    icon: "⊛",
  },
  monitoring: {
    label: "Monitoring",
    bg: "linear-gradient(135deg, #12003d 0%, #1e0a5e 100%)",
    border: "rgba(167,139,250,0.6)",
    color: "#ddd6fe",
    shadow: "rgba(124,58,237,0.4)",
    accent: "#7c3aed",
    icon: "◎",
  },
  config: {
    label: "Config",
    bg: "linear-gradient(135deg, #1f1a00 0%, #332c00 100%)",
    border: "rgba(234,179,8,0.55)",
    color: "#fef08a",
    shadow: "rgba(202,138,4,0.35)",
    accent: "#ca8a04",
    icon: "≡",
  },
  custom: {
    label: "Custom",
    bg: "linear-gradient(135deg, #0f1117 0%, #1a1d27 100%)",
    border: "rgba(100,116,139,0.5)",
    color: "#cbd5e1",
    shadow: "rgba(71,85,105,0.35)",
    accent: "#475569",
    icon: "◇",
  },
};

function getType(typeId: string) {
  return NODE_TYPES[typeId] || NODE_TYPES.custom;
}

// ─── Traffic Light ────────────────────────────────────────────────────────────

const STATUS_COLORS = {
  green: {
    outer: "rgba(34,197,94,0.25)",
    inner: "#22c55e",
    glow: "rgba(34,197,94,0.8)",
  },
  yellow: {
    outer: "rgba(234,179,8,0.25)",
    inner: "#eab308",
    glow: "rgba(234,179,8,0.8)",
  },
  red: {
    outer: "rgba(239,68,68,0.25)",
    inner: "#ef4444",
    glow: "rgba(239,68,68,0.8)",
  },
  gray: { outer: "rgba(100,116,139,0.2)", inner: "#475569", glow: "none" },
};

function TrafficLight({
  status,
  size = 10,
}: {
  status: string;
  size?: number;
}) {
  const s =
    STATUS_COLORS[status as keyof typeof STATUS_COLORS] || STATUS_COLORS.gray;
  return (
    <div
      style={{
        width: size + 6,
        height: size + 6,
        borderRadius: "50%",
        background: s.outer,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: s.inner,
          boxShadow:
            status === "gray"
              ? "none"
              : `0 0 ${size * 0.8}px ${s.glow}, 0 0 ${size * 1.5}px ${s.glow}`,
          animation:
            status === "green"
              ? "pulse-green 2s ease-in-out infinite"
              : status === "red"
                ? "pulse-red 1s ease-in-out infinite"
                : "none",
        }}
      />
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeNode(node: Partial<YamlNode>): YamlNode {
  return {
    ...node,
    id: node.id || "",
    label: node.label || "",
    kind: node.kind || "",
    image: node.image || "",
    namespace: node.namespace || "default",
    replicas: node.replicas ?? null,
    x: node.x ?? 0,
    y: node.y ?? 0,
    typeId: node.typeId || (node as any).type_id || "service",
    type_id: (node as any).type_id || node.typeId || "service",
    filePath: node.filePath || (node as any).file_path || "",
    file_path: (node as any).file_path || node.filePath || "",
  } as YamlNode;
}

function autoLayout(nodes: Partial<YamlNode>[]): YamlNode[] {
  const cols = 4,
    xStep = 22,
    yStep = 18,
    xStart = 5,
    yStart = 8;
  return nodes.map((n, i) => ({
    ...normalizeNode(n),
    x: xStart + (i % cols) * xStep,
    y: yStart + Math.floor(i / cols) * yStep,
  }));
}

// ─── Project Selector ─────────────────────────────────────────────────────────

function ProjectSelector({
  onProjectLoaded,
}: {
  onProjectLoaded: (r: ScanResult) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recentPaths = ["~/projects/myapp/infra", "~/work/k8s-configs"];

  const load = async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const folderPath =
        path ?? (await safeInvoke<string>("open_folder_dialog"));
      if (!folderPath) {
        setLoading(false);
        return;
      }
      const result = await safeInvoke<ScanResult>("scan_yaml_files", {
        folderPath,
      });
      onProjectLoaded(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        background: "#0a1628",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "monospace",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(59,130,246,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.04) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "30%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: "40vw",
          height: "40vw",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(59,130,246,0.07) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "2vw",
          width: "32vw",
          minWidth: 340,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.8vw" }}>
          <div
            style={{
              width: "3vw",
              height: "3vw",
              minWidth: 36,
              minHeight: 36,
              borderRadius: "0.6vw",
              background: "linear-gradient(135deg, #60a5fa, #2563eb)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 20px rgba(59,130,246,0.5)",
            }}
          >
            <svg
              style={{ width: "55%", height: "55%" }}
              viewBox="0 0 24 24"
              fill="none"
            >
              <rect
                x="3"
                y="3"
                width="8"
                height="8"
                rx="1.5"
                fill="white"
                opacity="0.9"
              />
              <rect
                x="13"
                y="3"
                width="8"
                height="8"
                rx="1.5"
                fill="white"
                opacity="0.6"
              />
              <rect
                x="3"
                y="13"
                width="8"
                height="8"
                rx="1.5"
                fill="white"
                opacity="0.6"
              />
              <rect
                x="13"
                y="13"
                width="8"
                height="8"
                rx="1.5"
                fill="white"
                opacity="0.3"
              />
            </svg>
          </div>
          <span
            style={{
              fontSize: "1.8vw",
              fontWeight: "bold",
              color: "white",
              letterSpacing: "0.05em",
            }}
          >
            Endfield
          </span>
        </div>
        <p
          style={{
            color: "rgba(255,255,255,0.35)",
            fontSize: "0.85vw",
            textAlign: "center",
            margin: 0,
            lineHeight: 1.6,
          }}
        >
          Kubernetes infrastructure visualizer
          <br />
          for developers
        </p>
        <button
          onClick={() => load()}
          disabled={loading}
          style={{
            width: "100%",
            padding: "1.1vw 0",
            background: loading
              ? "rgba(37,99,235,0.4)"
              : "linear-gradient(135deg, #3b82f6, #2563eb)",
            border: "1px solid rgba(96,165,250,0.3)",
            borderRadius: "0.7vw",
            color: "white",
            fontSize: "0.95vw",
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
            boxShadow: "0 0 24px rgba(59,130,246,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.6vw",
            fontFamily: "monospace",
            transition: "all 0.15s",
          }}
        >
          {loading ? (
            <>
              <div
                style={{
                  width: "0.9vw",
                  height: "0.9vw",
                  borderRadius: "50%",
                  border: "2px solid rgba(255,255,255,0.3)",
                  borderTopColor: "white",
                  animation: "spin 0.8s linear infinite",
                }}
              />
              Scanning...
            </>
          ) : (
            <>
              <span style={{ fontSize: "1.1vw" }}>⊞</span>Open config folder
            </>
          )}
        </button>
        <div style={{ width: "100%" }}>
          <div
            style={{
              color: "rgba(255,255,255,0.25)",
              fontSize: "0.7vw",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom: "0.6vw",
            }}
          >
            Recent
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.35vw" }}
          >
            {recentPaths.map((p) => (
              <div
                key={p}
                onClick={() => load(p)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.6vw",
                  padding: "0.55vw 0.8vw",
                  borderRadius: "0.5vw",
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.03)",
                  cursor: "pointer",
                  transition: "all 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(59,130,246,0.08)";
                  e.currentTarget.style.borderColor = "rgba(96,165,250,0.3)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                }}
              >
                <span
                  style={{ fontSize: "0.8vw", color: "rgba(255,255,255,0.3)" }}
                >
                  ⊙
                </span>
                <span
                  style={{
                    fontSize: "0.78vw",
                    color: "rgba(255,255,255,0.5)",
                    fontFamily: "monospace",
                  }}
                >
                  {p}
                </span>
              </div>
            ))}
          </div>
        </div>
        {error && (
          <div
            style={{
              width: "100%",
              padding: "0.7vw 0.9vw",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: "0.5vw",
              color: "#fca5a5",
              fontSize: "0.75vw",
            }}
          >
            ⚠ {error}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Scan Toast ───────────────────────────────────────────────────────────────

function ScanToast({
  result,
  onDismiss,
}: {
  result: ScanResult;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, []);
  const hasErrors = result.errors.length > 0;
  return (
    <div
      style={{
        position: "fixed",
        bottom: "2vw",
        right: "2vw",
        zIndex: 2000,
        background: hasErrors ? "rgba(120,40,10,0.9)" : "rgba(10,40,20,0.9)",
        border: `1px solid ${hasErrors ? "rgba(251,146,60,0.4)" : "rgba(52,211,153,0.4)"}`,
        borderRadius: "0.7vw",
        padding: "0.8vw 1.2vw",
        color: hasErrors ? "#fdba74" : "#6ee7b7",
        fontSize: "0.8vw",
        backdropFilter: "blur(16px)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        display: "flex",
        flexDirection: "column",
        gap: "0.3vw",
        animation: "ctxIn 0.2s ease both",
        maxWidth: "24vw",
      }}
    >
      <span style={{ fontWeight: 600 }}>
        {hasErrors ? "⚠" : "✓"} Loaded {result.nodes.length} fields
      </span>
      <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.7vw" }}>
        {result.project_path}
      </span>
      {hasErrors && (
        <span style={{ fontSize: "0.7vw" }}>
          {result.errors.length} parse errors
        </span>
      )}
    </div>
  );
}

// ─── Add Field Modal ──────────────────────────────────────────────────────────

function AddFieldModal({
  onClose,
  onAdd,
  projectNamespace,
  projectPath,
}: {
  onClose: () => void;
  onAdd: (node: YamlNode) => void;
  projectNamespace: string;
  projectPath: string;
}) {
  const [step, setStep] = useState<"pick" | "configure">("pick");
  const [selectedPreset, setSelectedPreset] = useState("postgres");
  const [name, setName] = useState("");
  const [port, setPort] = useState(5432);
  const [envVars, setEnvVars] = useState<FieldEnvVar[]>([]);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const preset = FIELD_PRESETS[selectedPreset];
  const t = getType(preset.typeId);

  const selectPreset = (key: string) => {
    setSelectedPreset(key);
    const p = FIELD_PRESETS[key];
    setName(key);
    setPort(p.defaultPort);
    setEnvVars(p.envVars.map((e) => ({ ...e })));
    setStep("configure");
    setTimeout(() => nameRef.current?.focus(), 60);
  };

  const previewFiles = Object.keys(
    generateConfigs(
      name || selectedPreset,
      preset,
      projectNamespace,
      port,
      envVars,
    ),
  );

  const handleCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    setResult(null);

    const safeName = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-");

    const files = generateConfigs(
      safeName,
      preset,
      projectNamespace,
      port,
      envVars,
    );
    const errors: string[] = [];

    // Сохраняем все файлы последовательно
    for (const [rel, content] of Object.entries(files)) {
      const fullPath = `${projectPath}/${rel}`;
      try {
        await safeInvoke("save_yaml_file", {
          filePath: fullPath, // camelCase — Tauri v2 конвертирует в file_path для Rust
          content,
        });
      } catch (e) {
        errors.push(`Save failed: ${rel}: ${e}`);
      }
    }

    if (errors.length > 0) {
      setResult(`⚠ Save failed: ${errors[0]}`);
      setCreating(false);
      return;
    }

    // Деплоим: сначала namespace, потом остальное
    try {
      const nsPath = `${projectPath}/namespace.yaml`;
      await safeInvoke("kubectl_apply", { path: nsPath });

      for (const rel of Object.keys(files)) {
        if (rel === "namespace.yaml") continue;
        const fullPath = `${projectPath}/${rel}`;
        await safeInvoke("kubectl_apply", { path: fullPath });
      }
      setResult("✓ Created & deployed");
    } catch (e) {
      setResult(`⚠ Files saved, kubectl failed: ${String(e).slice(0, 60)}`);
    }

    const mainFile =
      Object.keys(files).find(
        (f) => f.includes("statefulset") || f.includes("deployment"),
      ) || Object.keys(files)[0];

    onAdd({
      id: `${safeName}-${Date.now()}`,
      label: safeName,
      kind: preset.kind,
      image: preset.image,
      type_id: preset.typeId,
      typeId: preset.typeId,
      namespace: projectNamespace,
      file_path: `${projectPath}/${mainFile}`,
      filePath: `${projectPath}/${mainFile}`,
      replicas: preset.replicas,
      x: 30 + Math.random() * 30,
      y: 30 + Math.random() * 30,
    });

    setCreating(false);
    setTimeout(onClose, 1500);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(6,12,22,0.75)",
          backdropFilter: "blur(10px)",
        }}
      />
      <div
        style={{
          position: "relative",
          width: step === "pick" ? "54vw" : "36vw",
          maxHeight: "88vh",
          borderRadius: "1.2vw",
          background: "rgba(11,18,34,0.98)",
          border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
          display: "flex",
          flexDirection: "column",
          animation: "modalIn 0.22s cubic-bezier(0.34,1.45,0.64,1) both",
          fontFamily: "monospace",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "0.9vw 1.3vw",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.7vw" }}>
            {step === "configure" && (
              <button
                onClick={() => setStep("pick")}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "0.4vw",
                  color: "rgba(255,255,255,0.45)",
                  fontSize: "0.72vw",
                  padding: "0.2vw 0.6vw",
                  cursor: "pointer",
                  fontFamily: "monospace",
                }}
              >
                ‹ back
              </button>
            )}
            <span
              style={{ color: "white", fontWeight: 600, fontSize: "0.95vw" }}
            >
              {step === "pick" ? "Add Field" : `Configure · ${selectedPreset}`}
            </span>
            <span
              style={{
                color: "rgba(255,255,255,0.2)",
                fontSize: "0.65vw",
                padding: "0.1vw 0.5vw",
                borderRadius: "0.3vw",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              ns: {projectNamespace}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.07)",
              border: "none",
              borderRadius: "50%",
              width: "1.5vw",
              height: "1.5vw",
              minWidth: 20,
              minHeight: 20,
              color: "rgba(255,255,255,0.45)",
              cursor: "pointer",
              fontSize: "0.7vw",
            }}
          >
            ✕
          </button>
        </div>

        {/* STEP 1 — Pick */}
        {step === "pick" && (
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "1vw 1.3vw",
              minHeight: 0,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "0.5vw",
              }}
            >
              {Object.entries(FIELD_PRESETS).map(([key, p]) => {
                const tt = getType(p.typeId);
                return (
                  <div
                    key={key}
                    onClick={() => selectPreset(key)}
                    style={{
                      padding: "0.85vw 1vw",
                      borderRadius: "0.6vw",
                      border: "1.5px solid rgba(255,255,255,0.07)",
                      background: "rgba(255,255,255,0.02)",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.35vw",
                      transition: "all 0.12s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = tt.bg;
                      e.currentTarget.style.borderColor = tt.border.replace(
                        "0.6)",
                        "0.5)",
                      );
                      e.currentTarget.style.boxShadow = `0 0 16px ${tt.shadow}`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background =
                        "rgba(255,255,255,0.02)";
                      e.currentTarget.style.borderColor =
                        "rgba(255,255,255,0.07)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.4vw",
                        }}
                      >
                        <span style={{ fontSize: "1vw" }}>{tt.icon}</span>
                        <span
                          style={{
                            color: "white",
                            fontWeight: 600,
                            fontSize: "0.82vw",
                          }}
                        >
                          {key}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: "0.58vw",
                          color: tt.accent,
                          padding: "0.1vw 0.4vw",
                          borderRadius: "0.25vw",
                          background: `${tt.accent}18`,
                          border: `1px solid ${tt.accent}33`,
                        }}
                      >
                        {tt.label}
                      </span>
                    </div>
                    <div
                      style={{
                        color: "rgba(255,255,255,0.3)",
                        fontSize: "0.63vw",
                        lineHeight: 1.4,
                      }}
                    >
                      {p.description}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4vw",
                        marginTop: "0.1vw",
                      }}
                    >
                      <span
                        style={{
                          color: "rgba(255,255,255,0.18)",
                          fontSize: "0.58vw",
                          fontFamily: "monospace",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flex: 1,
                        }}
                      >
                        {p.image || "custom"}
                      </span>
                      <span
                        style={{
                          color: tt.accent,
                          fontSize: "0.6vw",
                          flexShrink: 0,
                        }}
                      >
                        :{p.defaultPort}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 2 — Configure */}
        {step === "configure" && (
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "1vw 1.3vw",
              display: "flex",
              flexDirection: "column",
              gap: "0.85vw",
              minHeight: 0,
            }}
          >
            {/* Preview */}
            <div
              style={{
                padding: "0.65vw 0.9vw",
                background: t.bg,
                border: `1px solid ${t.border}`,
                borderRadius: "0.5vw",
                boxShadow: `0 0 14px ${t.shadow}`,
                display: "flex",
                alignItems: "center",
                gap: "0.6vw",
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: "1.1vw" }}>{t.icon}</span>
              <div>
                <div
                  style={{
                    color: t.color,
                    fontWeight: 600,
                    fontSize: "0.82vw",
                  }}
                >
                  {preset.description}
                </div>
                <div
                  style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.62vw" }}
                >
                  {preset.kind} · {preset.folder}/ · :{port}
                </div>
              </div>
            </div>

            {/* Name */}
            <div>
              <label
                style={{
                  display: "block",
                  color: "rgba(255,255,255,0.3)",
                  fontSize: "0.62vw",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginBottom: "0.3vw",
                }}
              >
                Name
              </label>
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") onClose();
                }}
                placeholder={selectedPreset}
                style={{
                  width: "100%",
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "0.45vw",
                  color: "white",
                  fontSize: "0.82vw",
                  padding: "0.55vw 0.7vw",
                  outline: "none",
                  fontFamily: "monospace",
                }}
                onFocus={(e) =>
                  (e.target.style.borderColor = "rgba(96,165,250,0.6)")
                }
                onBlur={(e) =>
                  (e.target.style.borderColor = "rgba(255,255,255,0.1)")
                }
              />
            </div>

            {/* Port */}
            <div>
              <label
                style={{
                  display: "block",
                  color: "rgba(255,255,255,0.3)",
                  fontSize: "0.62vw",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginBottom: "0.3vw",
                }}
              >
                Port{" "}
                <span
                  style={{
                    color: "rgba(255,255,255,0.15)",
                    textTransform: "none",
                  }}
                >
                  (default: {FIELD_PRESETS[selectedPreset].defaultPort})
                </span>
              </label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                style={{
                  width: "100%",
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "0.45vw",
                  color: t.color,
                  fontSize: "0.82vw",
                  padding: "0.55vw 0.7vw",
                  outline: "none",
                  fontFamily: "monospace",
                }}
                onFocus={(e) => (e.target.style.borderColor = t.border)}
                onBlur={(e) =>
                  (e.target.style.borderColor = "rgba(255,255,255,0.1)")
                }
              />
            </div>

            {/* Env vars */}
            {envVars.length > 0 && (
              <div>
                <label
                  style={{
                    display: "block",
                    color: "rgba(255,255,255,0.3)",
                    fontSize: "0.62vw",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    marginBottom: "0.3vw",
                  }}
                >
                  Environment
                </label>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.28vw",
                  }}
                >
                  {envVars.map((env, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        gap: "0.35vw",
                        alignItems: "center",
                      }}
                    >
                      <input
                        value={env.key}
                        onChange={(e) => {
                          const nv = [...envVars];
                          nv[i] = { ...nv[i], key: e.target.value };
                          setEnvVars(nv);
                        }}
                        style={{
                          flex: "0 0 44%",
                          background: "rgba(255,255,255,0.03)",
                          border: "1px solid rgba(255,255,255,0.07)",
                          borderRadius: "0.3vw",
                          color: "rgba(255,255,255,0.45)",
                          fontSize: "0.68vw",
                          padding: "0.38vw 0.55vw",
                          outline: "none",
                          fontFamily: "monospace",
                        }}
                      />
                      <span
                        style={{
                          color: "rgba(255,255,255,0.18)",
                          fontSize: "0.7vw",
                        }}
                      >
                        :
                      </span>
                      <input
                        value={env.value}
                        onChange={(e) => {
                          const nv = [...envVars];
                          nv[i] = { ...nv[i], value: e.target.value };
                          setEnvVars(nv);
                        }}
                        style={{
                          flex: 1,
                          background: "rgba(255,255,255,0.06)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: "0.3vw",
                          color: "white",
                          fontSize: "0.68vw",
                          padding: "0.38vw 0.55vw",
                          outline: "none",
                          fontFamily: "monospace",
                        }}
                        onFocus={(e) => (e.target.style.borderColor = t.border)}
                        onBlur={(e) =>
                          (e.target.style.borderColor = "rgba(255,255,255,0.1)")
                        }
                      />
                      <button
                        onClick={() =>
                          setEnvVars(envVars.filter((_, j) => j !== i))
                        }
                        style={{
                          background: "none",
                          border: "none",
                          color: "rgba(239,68,68,0.4)",
                          cursor: "pointer",
                          fontSize: "0.72vw",
                          flexShrink: 0,
                          padding: "0 0.2vw",
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() =>
                    setEnvVars([...envVars, { key: "", value: "" }])
                  }
                  style={{
                    marginTop: "0.35vw",
                    background: "none",
                    border: "1px dashed rgba(255,255,255,0.1)",
                    borderRadius: "0.3vw",
                    color: "rgba(255,255,255,0.25)",
                    fontSize: "0.65vw",
                    padding: "0.28vw 0.6vw",
                    cursor: "pointer",
                    fontFamily: "monospace",
                  }}
                >
                  + add variable
                </button>
              </div>
            )}

            {/* Files preview */}
            <div>
              <label
                style={{
                  display: "block",
                  color: "rgba(255,255,255,0.3)",
                  fontSize: "0.62vw",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginBottom: "0.3vw",
                }}
              >
                Will create
              </label>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.18vw",
                }}
              >
                {previewFiles.map((f) => (
                  <div
                    key={f}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.35vw",
                    }}
                  >
                    <span style={{ color: t.accent, fontSize: "0.6vw" }}>
                      ◦
                    </span>
                    <span
                      style={{
                        color: "rgba(255,255,255,0.28)",
                        fontSize: "0.63vw",
                        fontFamily: "monospace",
                      }}
                    >
                      {f}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Buttons */}
            <div
              style={{
                display: "flex",
                gap: "0.5vw",
                flexShrink: 0,
                paddingBottom: "0.2vw",
              }}
            >
              <button
                onClick={onClose}
                style={{
                  flex: 1,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "0.5vw",
                  color: "rgba(255,255,255,0.4)",
                  fontSize: "0.78vw",
                  padding: "0.6vw 0",
                  cursor: "pointer",
                  fontFamily: "monospace",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !!result}
                style={{
                  flex: 2.5,
                  background: result
                    ? result.startsWith("✓")
                      ? "rgba(16,185,129,0.25)"
                      : "rgba(234,88,12,0.25)"
                    : creating
                      ? "rgba(37,99,235,0.4)"
                      : `linear-gradient(135deg, ${t.accent}bb, ${t.accent})`,
                  border: `1px solid ${t.border}`,
                  borderRadius: "0.5vw",
                  color: result?.startsWith("✓")
                    ? "#6ee7b7"
                    : result
                      ? "#fdba74"
                      : "white",
                  fontSize: "0.78vw",
                  fontWeight: 600,
                  padding: "0.6vw 0",
                  cursor: creating ? "not-allowed" : "pointer",
                  fontFamily: "monospace",
                  transition: "all 0.15s",
                }}
              >
                {creating ? "Creating..." : result || "Create & Deploy →"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Namespace Switcher ───────────────────────────────────────────────────────

function NamespaceSwitcher({
  namespaces,
  active,
  onChange,
}: {
  namespaces: string[];
  active: string;
  onChange: (ns: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (namespaces.length <= 1)
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.4vw",
          padding: "0.25vw 0.7vw",
          borderRadius: "0.4vw",
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.04)",
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.2)", fontSize: "0.62vw" }}>
          ns
        </span>
        <span
          style={{
            color: "rgba(255,255,255,0.45)",
            fontSize: "0.72vw",
            fontFamily: "monospace",
          }}
        >
          {active}
        </span>
      </div>
    );

  return (
    <div style={{ position: "relative" }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.4vw",
          padding: "0.25vw 0.7vw",
          borderRadius: "0.4vw",
          border: `1px solid ${open ? "rgba(96,165,250,0.4)" : "rgba(255,255,255,0.08)"}`,
          background: open ? "rgba(59,130,246,0.08)" : "rgba(255,255,255,0.04)",
          cursor: "pointer",
          transition: "all 0.12s",
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.2)", fontSize: "0.62vw" }}>
          ns
        </span>
        <span
          style={{
            color: "#93c5fd",
            fontSize: "0.72vw",
            fontFamily: "monospace",
          }}
        >
          {active}
        </span>
        <span
          style={{
            color: "rgba(255,255,255,0.2)",
            fontSize: "0.55vw",
            marginLeft: "0.1vw",
          }}
        >
          ▾
        </span>
      </div>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 100 }}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 0.3vw)",
              left: 0,
              zIndex: 101,
              minWidth: "100%",
              background: "rgba(13,20,38,0.97)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "0.55vw",
              padding: "0.3vw",
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              animation: "ctxIn 0.15s ease both",
              backdropFilter: "blur(20px)",
              fontFamily: "monospace",
            }}
          >
            {namespaces.map((ns) => (
              <div
                key={ns}
                onClick={() => {
                  onChange(ns);
                  setOpen(false);
                }}
                style={{
                  padding: "0.4vw 0.7vw",
                  borderRadius: "0.35vw",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.45vw",
                  background:
                    ns === active ? "rgba(59,130,246,0.12)" : "transparent",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (ns !== active)
                    e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                }}
                onMouseLeave={(e) => {
                  if (ns !== active)
                    e.currentTarget.style.background = "transparent";
                }}
              >
                <span
                  style={{
                    color: ns === active ? "#60a5fa" : "transparent",
                    fontSize: "0.55vw",
                  }}
                >
                  ●
                </span>
                <span
                  style={{
                    color: ns === active ? "#93c5fd" : "rgba(255,255,255,0.55)",
                    fontSize: "0.72vw",
                  }}
                >
                  {ns}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Field Configuration Panel ────────────────────────────────────────────────

function FieldConfigPanel({
  node,
  fieldStatus,
  onApplyReplicas,
}: {
  node: YamlNode | null;
  fieldStatus: FieldStatus | null;
  onApplyReplicas: (node: YamlNode, replicas: number) => Promise<void>;
}) {
  const [replicaValue, setReplicaValue] = useState(1);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<string | null>(null);

  useEffect(() => {
    if (node?.replicas != null) setReplicaValue(node.replicas);
    setApplyResult(null);
  }, [node?.id]);

  const handleApply = async () => {
    if (!node) return;
    setApplying(true);
    setApplyResult(null);
    try {
      await onApplyReplicas(node, replicaValue);
      setApplyResult("✓ Applied");
    } catch (e) {
      setApplyResult(`✗ ${String(e)}`);
    } finally {
      setApplying(false);
      setTimeout(() => setApplyResult(null), 3000);
    }
  };

  if (!node)
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: "0.5vw",
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.12)", fontSize: "1.5vw" }}>
          ◇
        </span>
        <span style={{ color: "rgba(255,255,255,0.18)", fontSize: "0.72vw" }}>
          Select a field
        </span>
      </div>
    );

  const t = getType(node.typeId);
  const hasReplicas = node.replicas != null;
  const sc = fieldStatus
    ? STATUS_COLORS[fieldStatus.status as keyof typeof STATUS_COLORS]
    : STATUS_COLORS.gray;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.75vw",
        flex: 1,
        overflowY: "auto",
        minHeight: 0,
        paddingRight: "0.3vw",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.6vw",
          padding: "0.6vw 0.8vw",
          background: t.bg,
          border: `1px solid ${t.border}`,
          borderRadius: "0.5vw",
          boxShadow: `0 0 12px ${t.shadow}`,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: "1vw" }}>{t.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              color: t.color,
              fontWeight: 600,
              fontSize: "0.85vw",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {node.label}
          </div>
          <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.63vw" }}>
            {node.kind} · {node.namespace}
          </div>
        </div>
        {fieldStatus && <TrafficLight status={fieldStatus.status} size={9} />}
      </div>

      {/* Live stats */}
      {fieldStatus && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "0.4vw",
            flexShrink: 0,
          }}
        >
          {[
            { label: "Desired", value: fieldStatus.desired },
            { label: "Ready", value: fieldStatus.ready },
            { label: "Available", value: fieldStatus.available },
          ].map(({ label, value }) => (
            <div
              key={label}
              style={{
                background: "rgba(255,255,255,0.04)",
                borderRadius: "0.4vw",
                padding: "0.5vw",
                textAlign: "center",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div
                style={{
                  color: "rgba(255,255,255,0.3)",
                  fontSize: "0.58vw",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: "0.2vw",
                }}
              >
                {label}
              </div>
              <div
                style={{ color: sc.inner, fontSize: "1.1vw", fontWeight: 700 }}
              >
                {value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Replicas */}
      {hasReplicas && (
        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            borderRadius: "0.5vw",
            padding: "0.75vw",
            border: "1px solid rgba(255,255,255,0.06)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "0.55vw",
            }}
          >
            <span
              style={{
                color: "rgba(255,255,255,0.4)",
                fontSize: "0.68vw",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Replicas
            </span>
            <span
              style={{ color: "#60a5fa", fontSize: "1vw", fontWeight: 700 }}
            >
              {replicaValue}
            </span>
          </div>
          <div
            style={{
              position: "relative",
              height: "0.35vw",
              background: "rgba(51,65,85,0.6)",
              borderRadius: 999,
              marginBottom: "0.5vw",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                height: "100%",
                width: `${((replicaValue - 1) / 9) * 100}%`,
                borderRadius: 999,
                background: "linear-gradient(to right, #60a5fa, #3b82f6)",
              }}
            />
            <input
              type="range"
              min={1}
              max={10}
              value={replicaValue}
              onChange={(e) => setReplicaValue(Number(e.target.value))}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                opacity: 0,
                cursor: "pointer",
                margin: 0,
                padding: 0,
                height: "100%",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: `${((replicaValue - 1) / 9) * 100}%`,
                transform: "translate(-50%,-50%)",
                width: "1vw",
                height: "1vw",
                borderRadius: "50%",
                background: "white",
                border: "2px solid #60a5fa",
                boxShadow: "0 0 8px rgba(59,130,246,0.8)",
                pointerEvents: "none",
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span
              style={{ color: "rgba(255,255,255,0.18)", fontSize: "0.58vw" }}
            >
              1
            </span>
            <span
              style={{ color: "rgba(255,255,255,0.18)", fontSize: "0.58vw" }}
            >
              10
            </span>
          </div>
        </div>
      )}

      {/* Image */}
      {node.image && (
        <div
          style={{
            padding: "0.45vw 0.7vw",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "0.4vw",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              color: "rgba(255,255,255,0.22)",
              fontSize: "0.58vw",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: "0.18vw",
            }}
          >
            Image
          </div>
          <div
            style={{
              color: "#93c5fd",
              fontSize: "0.7vw",
              fontFamily: "monospace",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {node.image}
          </div>
        </div>
      )}

      {/* File */}
      {(node.filePath || node.file_path) && (
        <div
          style={{
            padding: "0.45vw 0.7vw",
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.05)",
            borderRadius: "0.4vw",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              color: "rgba(255,255,255,0.18)",
              fontSize: "0.58vw",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: "0.18vw",
            }}
          >
            File
          </div>
          <div
            style={{
              color: "rgba(255,255,255,0.3)",
              fontSize: "0.63vw",
              fontFamily: "monospace",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {(node.filePath || node.file_path).split("/").slice(-3).join("/")}
          </div>
        </div>
      )}

      {/* Pods */}
      {fieldStatus && fieldStatus.pods.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.28vw",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              color: "rgba(255,255,255,0.22)",
              fontSize: "0.58vw",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Pods
          </div>
          {fieldStatus.pods.map((pod) => (
            <div
              key={pod.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.45vw",
                padding: "0.32vw 0.55vw",
                background: "rgba(255,255,255,0.03)",
                borderRadius: "0.35vw",
                border: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <TrafficLight
                status={
                  pod.phase === "Running"
                    ? "green"
                    : pod.phase === "Pending"
                      ? "yellow"
                      : "red"
                }
                size={6}
              />
              <span
                style={{
                  color: "rgba(255,255,255,0.45)",
                  fontSize: "0.63vw",
                  fontFamily: "monospace",
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {pod.name}
              </span>
              <span
                style={{ color: "rgba(255,255,255,0.22)", fontSize: "0.58vw" }}
              >
                {pod.ready}/{pod.total}
              </span>
              {pod.restarts > 0 && (
                <span style={{ color: "#f87171", fontSize: "0.58vw" }}>
                  ↺{pod.restarts}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Apply */}
      {hasReplicas && (
        <button
          onClick={handleApply}
          disabled={applying}
          style={{
            marginTop: "0.4vw",
            width: "100%",
            background: applying
              ? "rgba(37,99,235,0.4)"
              : "linear-gradient(135deg, #1e3a5f, #1e40af)",
            border: "1px solid rgba(59,130,246,0.4)",
            borderRadius: "0.4vw",
            color: applyResult?.startsWith("✓")
              ? "#6ee7b7"
              : applyResult?.startsWith("✗")
                ? "#fca5a5"
                : "#bfdbfe",
            fontSize: "0.82vw",
            padding: "0.65vw 0",
            cursor: applying ? "not-allowed" : "pointer",
            boxShadow: "0 0 12px rgba(59,130,246,0.15)",
            fontFamily: "monospace",
            fontWeight: 600,
            transition: "all 0.15s",
            flexShrink: 0,
          }}
        >
          {applying ? "Applying..." : applyResult || "Apply to cluster →"}
        </button>
      )}
    </div>
  );
}

// ─── Context Menu ─────────────────────────────────────────────────────────────

function ContextMenu({
  menu,
  onClose,
  onDelete,
  onRename,
  onOpenFile,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onOpenFile: (id: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(menu.label);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);
  if (!menu.visible) return null;

  const items = [
    {
      id: "rename",
      icon: "✎",
      label: "Rename",
      color: "#e2e8f0",
      action: () => setRenaming(true),
    },
    {
      id: "openfile",
      icon: "◫",
      label: "Open YAML",
      color: "#93c5fd",
      action: () => {
        onOpenFile(menu.nodeId!);
        onClose();
      },
    },
    { id: "sep" },
    {
      id: "delete",
      icon: "⌫",
      label: "Delete",
      color: "#f87171",
      action: () => {
        onDelete(menu.nodeId!);
        onClose();
      },
    },
  ];

  return (
    <>
      <div
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
        style={{ position: "fixed", inset: 0, zIndex: 998 }}
      />
      <div
        style={{
          position: "fixed",
          left: menu.x,
          top: menu.y,
          zIndex: 999,
          minWidth: "13vw",
          borderRadius: "0.9vw",
          padding: "0.4vw",
          background: "rgba(20,28,46,0.78)",
          backdropFilter: "blur(28px)",
          border: "1px solid rgba(255,255,255,0.13)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.55)",
          animation: "ctxIn 0.15s cubic-bezier(0.34,1.4,0.64,1) both",
          transformOrigin: "top left",
          fontFamily: "monospace",
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          style={{
            padding: "0.4vw 0.8vw 0.5vw",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            marginBottom: "0.3vw",
          }}
        >
          {renaming ? (
            <input
              ref={inputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onRename(menu.nodeId!, newName);
                  onClose();
                }
                if (e.key === "Escape") setRenaming(false);
              }}
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(96,165,250,0.5)",
                borderRadius: "0.35vw",
                color: "white",
                fontSize: "0.78vw",
                padding: "0.25vw 0.5vw",
                outline: "none",
              }}
            />
          ) : (
            <div>
              <div
                style={{
                  color: "rgba(255,255,255,0.55)",
                  fontSize: "0.75vw",
                  fontWeight: 600,
                }}
              >
                {menu.label}
              </div>
              {menu.kind && (
                <div
                  style={{
                    color: "rgba(255,255,255,0.25)",
                    fontSize: "0.65vw",
                    marginTop: "0.1vw",
                  }}
                >
                  {menu.kind} · {menu.namespace}
                </div>
              )}
            </div>
          )}
        </div>
        {items.map((item) => {
          if (item.id === "sep")
            return (
              <div
                key="sep"
                style={{
                  height: "1px",
                  background: "rgba(255,255,255,0.07)",
                  margin: "0.3vw 0.4vw",
                }}
              />
            );
          return (
            <div
              key={item.id}
              onMouseEnter={() => setHovered(item.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={item.action}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6vw",
                padding: "0.45vw 0.8vw",
                borderRadius: "0.55vw",
                cursor: "pointer",
                background:
                  hovered === item.id
                    ? item.id === "delete"
                      ? "rgba(239,68,68,0.18)"
                      : "rgba(255,255,255,0.09)"
                    : "transparent",
                transition: "background 0.1s",
              }}
            >
              <span
                style={{
                  fontSize: "0.95vw",
                  color:
                    hovered === item.id ? item.color! : "rgba(255,255,255,0.4)",
                  width: "1.1vw",
                  textAlign: "center",
                }}
              >
                {item.icon}
              </span>
              <span
                style={{
                  fontSize: "0.8vw",
                  color:
                    hovered === item.id
                      ? item.color!
                      : "rgba(255,255,255,0.82)",
                  fontWeight: item.id === "delete" ? 500 : 400,
                }}
              >
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── YAML Modal ───────────────────────────────────────────────────────────────

function YamlModal({ node, onClose }: { node: YamlNode; onClose: () => void }) {
  const [content, setContent] = useState("Loading...");
  useEffect(() => {
    const path = node.filePath || node.file_path;
    if (!path) {
      setContent("# No file path");
      return;
    }
    safeInvoke<string>("read_yaml_file", { filePath: path })
      .then(setContent)
      .catch((e) => setContent(`Error: ${e}`));
  }, [node.filePath]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(6,12,22,0.7)",
          backdropFilter: "blur(8px)",
        }}
      />
      <div
        style={{
          position: "relative",
          width: "42vw",
          maxHeight: "75vh",
          borderRadius: "1vw",
          background: "rgba(13,22,40,0.95)",
          border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
          display: "flex",
          flexDirection: "column",
          animation: "modalIn 0.2s cubic-bezier(0.34,1.45,0.64,1) both",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "0.8vw 1.2vw",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div>
            <span
              style={{ color: "white", fontWeight: 600, fontSize: "0.9vw" }}
            >
              {node.label}
            </span>
            <span
              style={{
                color: "rgba(255,255,255,0.3)",
                fontSize: "0.72vw",
                marginLeft: "0.6vw",
              }}
            >
              {node.filePath || node.file_path}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "none",
              borderRadius: "50%",
              width: "1.5vw",
              height: "1.5vw",
              minWidth: 20,
              minHeight: 20,
              color: "rgba(255,255,255,0.5)",
              cursor: "pointer",
              fontSize: "0.75vw",
            }}
          >
            ✕
          </button>
        </div>
        <pre
          style={{
            flex: 1,
            overflowY: "auto",
            margin: 0,
            padding: "1vw 1.2vw",
            color: "#93c5fd",
            fontSize: "0.75vw",
            lineHeight: 1.7,
            fontFamily: "monospace",
            background: "transparent",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {content}
        </pre>
      </div>
    </div>
  );
}

// ─── Draggable Node ───────────────────────────────────────────────────────────

function DraggableNode({
  node,
  fieldStatus,
  onDragStart,
  isDragging,
  onContextMenu,
  isSelected,
  onClick,
}: {
  node: YamlNode;
  fieldStatus: FieldStatus | null;
  onDragStart: (e: React.MouseEvent, id: string) => void;
  isDragging: boolean;
  onContextMenu: (e: React.MouseEvent, node: YamlNode) => void;
  isSelected: boolean;
  onClick: (node: YamlNode) => void;
}) {
  const t = getType(node.typeId);
  const status = fieldStatus?.status || "gray";
  return (
    <div
      onMouseDown={(e) => {
        if (e.button === 0) onDragStart(e, node.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, node);
      }}
      onClick={() => onClick(node)}
      style={{
        position: "absolute",
        left: `${node.x}%`,
        top: `${node.y}%`,
        cursor: isDragging ? "grabbing" : "grab",
        userSelect: "none",
        zIndex: isDragging ? 100 : isSelected ? 10 : 1,
      }}
    >
      <div
        style={{
          background: t.bg,
          border: `1px solid ${isSelected ? t.border.replace("0.6)", "1)") : t.border}`,
          borderRadius: "0.4vw",
          padding: "0.6vw 1vw",
          color: t.color,
          fontSize: "0.82vw",
          fontWeight: 600,
          boxShadow: isDragging
            ? `0 0 24px ${t.shadow}, 0 8px 24px rgba(0,0,0,0.4)`
            : isSelected
              ? `0 0 20px ${t.shadow}, 0 0 0 1.5px ${t.accent}`
              : `0 0 12px ${t.shadow}`,
          whiteSpace: "nowrap",
          display: "flex",
          alignItems: "center",
          gap: "0.5vw",
          transform: isDragging ? "scale(1.05)" : "scale(1)",
          transition: isDragging ? "transform 0.05s" : "transform 0.12s",
        }}
      >
        <TrafficLight status={status} size={8} />
        <span style={{ fontSize: "0.85vw", opacity: 0.8 }}>{t.icon}</span>
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.05vw" }}
        >
          <span>{node.label}</span>
          {node.kind && (
            <span style={{ fontSize: "0.6vw", opacity: 0.45, fontWeight: 400 }}>
              {node.kind}
              {node.replicas
                ? ` ×${fieldStatus ? fieldStatus.ready : node.replicas}`
                : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState<"selector" | "dashboard">("selector");
  const [project, setProject] = useState<ScanResult | null>(null);
  const [nodes, setNodes] = useState<YamlNode[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<YamlNode | null>(null);
  const [clusterStatus, setClusterStatus] = useState<ClusterStatus | null>(
    null,
  );
  const [activeNamespace, setActiveNamespace] = useState("default");
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    nodeId: null,
    label: "",
    kind: "",
    namespace: "",
  });
  const [showAddModal, setShowAddModal] = useState(false);
  const [yamlModal, setYamlModal] = useState<YamlNode | null>(null);
  const [scanToast, setScanToast] = useState<ScanResult | null>(null);
  const dragState = useRef<{
    id: string;
    offsetXpct: number;
    offsetYpct: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const allNamespaces = Array.from(
    new Set(nodes.map((n) => n.namespace).filter(Boolean)),
  );
  const visibleNodes = nodes.filter(
    (n) => !n.namespace || n.namespace === activeNamespace,
  );

  const fetchClusterStatus = useCallback(async () => {
    try {
      const s = await safeInvoke<ClusterStatus>("get_cluster_status");
      setClusterStatus(s);
    } catch {}
  }, []);

  useEffect(() => {
    if (screen === "dashboard") {
      fetchClusterStatus();
      pollingRef.current = setInterval(fetchClusterStatus, 5000);
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [screen, fetchClusterStatus]);

  const getFieldStatus = useCallback(
    (node: YamlNode): FieldStatus | null => {
      if (!clusterStatus) return null;
      return (
        clusterStatus.fields.find(
          (f) =>
            f.label === node.label &&
            (f.namespace === node.namespace || f.namespace === "default"),
        ) || null
      );
    },
    [clusterStatus],
  );

  const handleProjectLoaded = useCallback((result: ScanResult) => {
    setNodes(autoLayout(result.nodes));
    setProject(result);
    setScanToast(result);
    const projectName = result.project_path.split("/").pop() || "default";
    const found = Array.from(
      new Set(result.nodes.map((n) => n.namespace).filter(Boolean)),
    );
    setActiveNamespace(
      found.find((ns) => ns === projectName) || found[0] || projectName,
    );
    setScreen("dashboard");
  }, []);

  const handleDragStart = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nr = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragState.current = {
      id,
      offsetXpct: ((e.clientX - nr.left) / rect.width) * 100,
      offsetYpct: ((e.clientY - nr.top) / rect.height) * 100,
    };
    setDraggingId(id);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const { id, offsetXpct, offsetYpct } = dragState.current;
    const newX = Math.max(
      0,
      Math.min(((e.clientX - rect.left) / rect.width) * 100 - offsetXpct, 88),
    );
    const newY = Math.max(
      0,
      Math.min(((e.clientY - rect.top) / rect.height) * 100 - offsetYpct, 90),
    );
    setNodes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, x: newX, y: newY } : n)),
    );
  }, []);

  const handleMouseUp = useCallback(() => {
    dragState.current = null;
    setDraggingId(null);
  }, []);
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, node: YamlNode) => {
      e.preventDefault();
      setContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        nodeId: node.id,
        label: node.label,
        kind: node.kind || "",
        namespace: node.namespace || "",
      });
    },
    [],
  );
  const handleDelete = useCallback(
    (id: string) => setNodes((prev) => prev.filter((n) => n.id !== id)),
    [],
  );
  const handleRename = useCallback(
    (id: string, label: string) =>
      setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, label } : n))),
    [],
  );
  const handleOpenFile = useCallback(
    (id: string) => {
      const node = nodes.find((n) => n.id === id);
      if (node?.filePath || node?.file_path)
        setYamlModal({ ...node, filePath: node.filePath || node.file_path });
    },
    [nodes],
  );
  const handleAddField = useCallback((node: YamlNode) => {
    setNodes((prev) => [...prev, node]);
  }, []);
  const handleNodeClick = useCallback((node: YamlNode) => {
    setSelectedNode((prev) => (prev?.id === node.id ? null : node));
  }, []);

  const handleApplyReplicas = useCallback(
    async (node: YamlNode, replicas: number) => {
      const filePath = node.filePath || node.file_path;
      if (!filePath) throw new Error("No file path");
      await safeInvoke("apply_replicas", {
        filePath,
        nodeLabel: node.label,
        replicas,
      });
      setNodes((prev) =>
        prev.map((n) => (n.id === node.id ? { ...n, replicas } : n)),
      );
      setSelectedNode((prev) =>
        prev?.id === node.id ? { ...prev, replicas } : prev,
      );
      setTimeout(fetchClusterStatus, 1000);
    },
    [fetchClusterStatus],
  );

  if (screen === "selector")
    return (
      <>
        <ProjectSelector onProjectLoaded={handleProjectLoaded} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes ctxIn{from{opacity:0;transform:scale(0.88)}to{opacity:1;transform:scale(1)}}*{box-sizing:border-box}`}</style>
      </>
    );

  const projectName = project?.project_path?.split("/").pop() || "Project";
  const selectedFieldStatus = selectedNode
    ? getFieldStatus(selectedNode)
    : null;
  const overallStatus = (() => {
    if (!clusterStatus?.kubectl_available) return "gray";
    const ff = clusterStatus.fields;
    if (!ff.length) return "gray";
    if (ff.every((f) => f.status === "green")) return "green";
    if (ff.some((f) => f.status === "red")) return "red";
    return "yellow";
  })();

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        background: "#0a1628",
        display: "flex",
        flexDirection: "column",
        gap: "0.5vw",
        padding: "0.8vw",
        fontFamily: "monospace",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* HEADER */}
      <div
        style={{
          position: "relative",
          borderRadius: "0.5vw",
          padding: "0.5vw 1vw",
          border: "1px solid rgba(255,255,255,0.1)",
          background: "linear-gradient(to bottom, #1b263b, #0f172a)",
          boxShadow: "0 0 40px rgba(0,0,0,0.8)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "0.5vw",
            background:
              "radial-gradient(circle at top, rgba(59,130,246,0.1), transparent 60%)",
          }}
        />
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1vw",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.6vw",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: "2.2vw",
                height: "2.2vw",
                borderRadius: "0.4vw",
                background: "linear-gradient(135deg, #60a5fa, #2563eb)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 12px rgba(59,130,246,0.6)",
              }}
            >
              <svg
                style={{ width: "55%", height: "55%" }}
                viewBox="0 0 24 24"
                fill="none"
              >
                <rect
                  x="3"
                  y="3"
                  width="8"
                  height="8"
                  rx="1.5"
                  fill="white"
                  opacity="0.9"
                />
                <rect
                  x="13"
                  y="3"
                  width="8"
                  height="8"
                  rx="1.5"
                  fill="white"
                  opacity="0.6"
                />
                <rect
                  x="3"
                  y="13"
                  width="8"
                  height="8"
                  rx="1.5"
                  fill="white"
                  opacity="0.6"
                />
                <rect
                  x="13"
                  y="13"
                  width="8"
                  height="8"
                  rx="1.5"
                  fill="white"
                  opacity="0.3"
                />
              </svg>
            </div>
            <span
              style={{
                fontWeight: "bold",
                fontSize: "1.4vw",
                color: "white",
                letterSpacing: "0.05em",
              }}
            >
              Endfield
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4vw",
              fontSize: "0.85vw",
            }}
          >
            <span
              onClick={() => setScreen("selector")}
              style={{
                color: "#94a3b8",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) =>
                ((e.target as HTMLElement).style.color = "#e2e8f0")
              }
              onMouseLeave={(e) =>
                ((e.target as HTMLElement).style.color = "#94a3b8")
              }
            >
              ‹ Projects
            </span>
            <span style={{ color: "#475569", padding: "0 0.2vw" }}>/</span>
            <span
              style={{
                color: "#cbd5e1",
                padding: "0.2vw 0.6vw",
                borderRadius: "0.3vw",
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.05)",
                whiteSpace: "nowrap",
              }}
            >
              {projectName}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.8vw",
              flexShrink: 0,
            }}
          >
            <NamespaceSwitcher
              namespaces={
                allNamespaces.length > 0 ? allNamespaces : [activeNamespace]
              }
              active={activeNamespace}
              onChange={setActiveNamespace}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4vw",
                padding: "0.25vw 0.7vw",
                borderRadius: "0.4vw",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.04)",
              }}
            >
              <TrafficLight status={overallStatus} size={7} />
              <span
                style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.7vw" }}
              >
                {clusterStatus?.kubectl_available === false
                  ? "kubectl unavailable"
                  : `${clusterStatus?.fields.filter((f) => f.status === "green").length || 0}/${clusterStatus?.fields.length || 0} healthy`}
              </span>
            </div>
            <span
              style={{ fontSize: "0.72vw", color: "rgba(255,255,255,0.2)" }}
            >
              {visibleNodes.length} fields
            </span>
            <button
              onClick={() => setScreen("selector")}
              style={{
                background: "none",
                border: "none",
                color: "#64748b",
                cursor: "pointer",
                fontSize: "1vw",
              }}
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      {/* GRID */}
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "3fr 1fr",
          gridTemplateRows: "1fr 2fr",
          gap: "0.5vw",
          minHeight: 0,
        }}
      >
        {/* CANVAS */}
        <div
          style={{
            gridColumn: "1",
            gridRow: "1 / 3",
            borderRadius: "0.5vw",
            border: "1px solid rgba(255,255,255,0.1)",
            background: "#0d1b2e",
            overflow: "hidden",
            position: "relative",
            boxShadow: "inset 0 0 60px rgba(0,0,0,0.4)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "linear-gradient(rgba(59,130,246,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.06) 1px, transparent 1px)",
              backgroundSize: "3% 3%",
            }}
          />
          <div
            style={{
              position: "relative",
              zIndex: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.8vw 1.5vw",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                color: "white",
                fontWeight: 600,
                fontSize: "0.95vw",
                letterSpacing: "0.05em",
              }}
            >
              Microservice Dashboard
            </span>
            <div
              style={{
                display: "flex",
                gap: "0.8vw",
                alignItems: "center",
                fontSize: "0.72vw",
              }}
            >
              {clusterStatus && !clusterStatus.error && (
                <span style={{ color: "rgba(255,255,255,0.2)" }}>
                  live sync ●
                </span>
              )}
              {clusterStatus?.error && (
                <span style={{ color: "#f87171" }}>
                  ⚠ {clusterStatus.error}
                </span>
              )}
            </div>
          </div>
          <div
            ref={containerRef}
            style={{ flex: 1, position: "relative", overflow: "hidden" }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setSelectedNode(null);
            }}
          >
            {visibleNodes.map((node) => (
              <DraggableNode
                key={node.id}
                node={node}
                fieldStatus={getFieldStatus(node)}
                onDragStart={handleDragStart}
                isDragging={draggingId === node.id}
                onContextMenu={handleContextMenu}
                isSelected={selectedNode?.id === node.id}
                onClick={handleNodeClick}
              />
            ))}
            <div
              style={{
                position: "absolute",
                bottom: "3%",
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 2,
              }}
            >
              <div
                onClick={() => setShowAddModal(true)}
                style={{
                  border: "1px dashed rgba(96,165,250,0.35)",
                  borderRadius: "0.4vw",
                  padding: "0.5vw 1.5vw",
                  color: "#64748b",
                  fontSize: "0.75vw",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  background: "rgba(0,0,0,0.2)",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4vw",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "rgba(96,165,250,0.7)";
                  e.currentTarget.style.color = "#93c5fd";
                  e.currentTarget.style.background = "rgba(59,130,246,0.08)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "rgba(96,165,250,0.35)";
                  e.currentTarget.style.color = "#64748b";
                  e.currentTarget.style.background = "rgba(0,0,0,0.2)";
                }}
              >
                <span style={{ fontSize: "0.9vw" }}>⊕</span> New Field +
              </div>
            </div>
          </div>
        </div>

        {/* FIELD CONFIG */}
        <div
          style={{
            gridColumn: "2",
            gridRow: "1",
            borderRadius: "0.5vw",
            border: "1px solid rgba(255,255,255,0.1)",
            background: "#0d1b2e",
            padding: "1vw 1.2vw",
            boxShadow: "inset 0 0 30px rgba(0,0,0,0.3)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minHeight: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "0.8vw",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                color: "white",
                fontWeight: 600,
                fontSize: "0.9vw",
                letterSpacing: "0.05em",
              }}
            >
              Field Configuration
            </span>
            {selectedNode && (
              <button
                onClick={() => setSelectedNode(null)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#64748b",
                  cursor: "pointer",
                  fontSize: "0.8vw",
                }}
              >
                ✕
              </button>
            )}
          </div>
          <FieldConfigPanel
            node={selectedNode}
            fieldStatus={selectedFieldStatus}
            onApplyReplicas={handleApplyReplicas}
          />
        </div>

        {/* AI ASSISTANT */}
        <div
          style={{
            gridColumn: "2",
            gridRow: "2",
            borderRadius: "0.5vw",
            border: "1px solid rgba(255,255,255,0.1)",
            background: "#0d1b2e",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "inset 0 0 30px rgba(0,0,0,0.3)",
            minHeight: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.8vw 1.2vw",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                color: "white",
                fontWeight: 600,
                fontSize: "1vw",
                letterSpacing: "0.05em",
              }}
            >
              AI Assistant
            </span>
            <div style={{ display: "flex", gap: "0.3vw" }}>
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: "0.4vw",
                    height: "0.4vw",
                    borderRadius: "50%",
                    background: "#475569",
                  }}
                />
              ))}
            </div>
          </div>
          <div
            style={{
              flex: 1,
              padding: "0.8vw 1vw",
              display: "flex",
              flexDirection: "column",
              gap: "0.7vw",
              overflowY: "auto",
              minHeight: 0,
            }}
          >
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <div
                style={{
                  background: "rgba(37,99,235,0.2)",
                  border: "1px solid rgba(59,130,246,0.3)",
                  borderRadius: "0.5vw",
                  borderTopRightRadius: "0.1vw",
                  padding: "0.5vw 0.8vw",
                  color: "#bfdbfe",
                  fontSize: "0.8vw",
                  maxWidth: "85%",
                }}
              >
                Deploy postgres to myapp namespace
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: "0.5vw",
                alignItems: "flex-start",
              }}
            >
              <div
                style={{
                  width: "1.6vw",
                  height: "1.6vw",
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #475569, #1e293b)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  fontSize: "0.7vw",
                  color: "#94a3b8",
                }}
              >
                ✦
              </div>
              <div
                style={{
                  background: "rgba(30,41,59,0.6)",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: "0.5vw",
                  borderTopLeftRadius: "0.1vw",
                  padding: "0.5vw 0.8vw",
                  color: "#e2e8f0",
                  fontSize: "0.8vw",
                  maxWidth: "85%",
                }}
              >
                Creating StatefulSet, Service and ConfigMap for postgres in
                namespace myapp...
              </div>
            </div>
          </div>
          <div
            style={{
              padding: "0.7vw 1vw",
              borderTop: "1px solid rgba(255,255,255,0.05)",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", gap: "0.5vw" }}>
              <input
                style={{
                  flex: 1,
                  background: "rgba(30,41,59,0.6)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "0.4vw",
                  padding: "0.5vw 0.7vw",
                  color: "#e2e8f0",
                  fontSize: "0.8vw",
                  outline: "none",
                  minWidth: 0,
                  fontFamily: "monospace",
                }}
                placeholder="Ask me anything..."
              />
              <button
                style={{
                  background: "#2563eb",
                  border: "none",
                  borderRadius: "0.4vw",
                  color: "white",
                  fontSize: "0.8vw",
                  padding: "0 1vw",
                  cursor: "pointer",
                  boxShadow: "0 0 12px rgba(59,130,246,0.3)",
                  flexShrink: 0,
                  fontWeight: 600,
                  fontFamily: "monospace",
                }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>

      <ContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu((m) => ({ ...m, visible: false }))}
        onDelete={handleDelete}
        onRename={handleRename}
        onOpenFile={handleOpenFile}
      />
      {showAddModal && project && (
        <AddFieldModal
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddField}
          projectNamespace={activeNamespace}
          projectPath={project.project_path}
        />
      )}
      {yamlModal && (
        <YamlModal node={yamlModal} onClose={() => setYamlModal(null)} />
      )}
      {scanToast && (
        <ScanToast result={scanToast} onDismiss={() => setScanToast(null)} />
      )}

      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes ctxIn   { from { opacity:0; transform:scale(0.88); } to { opacity:1; transform:scale(1); } }
        @keyframes modalIn { from { opacity:0; transform:scale(0.9) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }
        @keyframes pulse-green { 0%,100% { box-shadow: 0 0 6px rgba(34,197,94,0.8), 0 0 12px rgba(34,197,94,0.4); } 50% { box-shadow: 0 0 10px rgba(34,197,94,1), 0 0 20px rgba(34,197,94,0.6); } }
        @keyframes pulse-red   { 0%,100% { box-shadow: 0 0 6px rgba(239,68,68,0.8), 0 0 12px rgba(239,68,68,0.4); } 50% { box-shadow: 0 0 10px rgba(239,68,68,1), 0 0 20px rgba(239,68,68,0.6); } }
        * { box-sizing: border-box; }
        input[type=range] { -webkit-appearance: none; appearance: none; background: transparent; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
      `}</style>
    </div>
  );
}
