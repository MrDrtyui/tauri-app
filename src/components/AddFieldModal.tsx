import { AppIcon, AppIconName, resolveNodeIconName } from "../ui/AppIcon";
import React, { useState, useRef, useEffect } from "react";
import { useIDEStore } from "../store/ideStore";
import {
  saveYamlFile,
  helmAvailable,
  generateField,
  generateInfra,
  deployResource,
  deployImage,
  type YamlNode,
  type FieldConfig,
  type InfraConfig,
  type DeployImageRequest,
} from "../store/tauriStore";
import { genId } from "../layout/utils";

// ─── Types ─────────────────────────────────────────────────────────

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

interface HelmPreset {
  typeId: string;
  description: string;
  chartName: string;
  repo: string;
  version: string;
  defaultNamespace: string;
  defaultValues: string;
  prodValues: string;
}

// ─── Node type → Catppuccin tokens ─────────────────────────────────

const NODE_STYLES: Record<
  string,
  {
    color: string;
    border: string;
    bg: string;
    shadow: string;
    icon: string;
    label: string;
  }
> = {
  gateway: {
    color: "var(--ctp-blue)",
    border: "rgba(137,180,250,0.30)",
    bg: "rgba(137,180,250,0.07)",
    shadow: "rgba(137,180,250,0.12)",
    icon: "gateway",
    label: "gateway",
  },
  service: {
    color: "var(--ctp-green)",
    border: "rgba(166,227,161,0.30)",
    bg: "rgba(166,227,161,0.07)",
    shadow: "rgba(166,227,161,0.12)",
    icon: "service",
    label: "service",
  },
  database: {
    color: "var(--ctp-sapphire)",
    border: "rgba(116,199,236,0.30)",
    bg: "rgba(116,199,236,0.07)",
    shadow: "rgba(116,199,236,0.12)",
    icon: "database",
    label: "database",
  },
  cache: {
    color: "var(--ctp-peach)",
    border: "rgba(250,179,135,0.30)",
    bg: "rgba(250,179,135,0.07)",
    shadow: "rgba(250,179,135,0.12)",
    icon: "cache",
    label: "cache",
  },
  queue: {
    color: "var(--ctp-maroon)",
    border: "rgba(235,160,172,0.30)",
    bg: "rgba(235,160,172,0.07)",
    shadow: "rgba(235,160,172,0.12)",
    icon: "queue",
    label: "queue",
  },
  monitoring: {
    color: "var(--ctp-mauve)",
    border: "rgba(203,166,247,0.30)",
    bg: "rgba(203,166,247,0.07)",
    shadow: "rgba(203,166,247,0.12)",
    icon: "monitoring",
    label: "monitoring",
  },
  infra: {
    color: "var(--ctp-teal)",
    border: "rgba(148,226,213,0.30)",
    bg: "rgba(148,226,213,0.07)",
    shadow: "rgba(148,226,213,0.12)",
    icon: "helmRelease",
    label: "infra",
  },
  custom: {
    color: "var(--text-muted)",
    border: "var(--border-default)",
    bg: "var(--bg-elevated)",
    shadow: "rgba(0,0,0,0.15)",
    icon: "default",
    label: "custom",
  },
};
function getStyle(typeId: string) {
  return NODE_STYLES[typeId] ?? NODE_STYLES.custom;
}

// ─── Presets ────────────────────────────────────────────────────────

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
    replicas: 3,
    description: "Apache Kafka — event streaming",
    folder: "messaging",
    generateConfigMap: true,
    generateService: true,
    storageSize: "20Gi",
    envVars: [
      { key: "KAFKA_ZOOKEEPER_CONNECT", value: "zookeeper:2181" },
      { key: "KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR", value: "3" },
      { key: "KAFKA_MIN_INSYNC_REPLICAS", value: "2" },
    ],
  },
  redpanda: {
    typeId: "queue",
    image: "redpandadata/redpanda:v23.3.11",
    defaultPort: 9092,
    kind: "StatefulSet",
    replicas: 3,
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

const HELM_PRESETS: Record<string, HelmPreset> = {
  "ingress-nginx": {
    typeId: "gateway",
    description: "Nginx Ingress Controller (official chart)",
    chartName: "ingress-nginx",
    repo: "https://kubernetes.github.io/ingress-nginx",
    version: "4.10.1",
    defaultNamespace: "infra-ingress-nginx",
    defaultValues: `ingress-nginx:\n  namespaceOverride: "infra-ingress-nginx"\n  controller:\n    replicaCount: 1\n    service:\n      type: LoadBalancer\n    admissionWebhooks:\n      enabled: false\n`,
    prodValues: `ingress-nginx:\n  controller:\n    replicaCount: 2\n    admissionWebhooks:\n      enabled: true\n`,
  },
  redis: {
    typeId: "cache",
    description: "Redis (Bitnami chart)",
    chartName: "redis",
    repo: "https://charts.bitnami.com/bitnami",
    version: "20.6.3",
    defaultNamespace: "infra-redis",
    defaultValues: `redis:\n  architecture: standalone\n  auth:\n    enabled: false\n  master:\n    persistence:\n      enabled: false\n  replica:\n    replicaCount: 0\n    persistence:\n      enabled: false\n`,
    prodValues: `redis:\n  architecture: replication\n  auth:\n    enabled: true\n    password: "CHANGE_ME"\n  master:\n    persistence:\n      enabled: true\n      size: 2Gi\n  replica:\n    replicaCount: 1\n    persistence:\n      enabled: true\n      size: 2Gi\n`,
  },
  "cert-manager": {
    typeId: "infra",
    description: "cert-manager (Jetstack chart)",
    chartName: "cert-manager",
    repo: "https://charts.jetstack.io",
    version: "1.14.5",
    defaultNamespace: "infra-cert-manager",
    defaultValues: `cert-manager:\n  installCRDs: true\n  replicaCount: 1\n`,
    prodValues: `cert-manager:\n  replicaCount: 2\n`,
  },
  prometheus: {
    typeId: "monitoring",
    description: "kube-prometheus-stack (Prometheus+Grafana)",
    chartName: "kube-prometheus-stack",
    repo: "https://prometheus-community.github.io/helm-charts",
    version: "58.2.2",
    defaultNamespace: "infra-monitoring",
    defaultValues: `kube-prometheus-stack:\n  grafana:\n    enabled: true\n    adminPassword: "admin"\n  alertmanager:\n    enabled: false\n`,
    prodValues: `kube-prometheus-stack:\n  grafana:\n    adminPassword: "CHANGE_ME"\n`,
  },
  kafka: {
    typeId: "queue",
    description: "Apache Kafka (Bitnami chart)",
    chartName: "kafka",
    repo: "https://charts.bitnami.com/bitnami",
    version: "31.3.1",
    defaultNamespace: "infra-kafka",
    defaultValues: `kafka:\n  replicaCount: 1\n  persistence:\n    enabled: false\n  kraft:\n    enabled: true\n  zookeeper:\n    persistence:\n      enabled: false\n`,
    prodValues: `kafka:\n  replicaCount: 3\n  persistence:\n    enabled: true\n    size: 50Gi\n`,
  },
};

// ─── YAML generators (unchanged logic) ─────────────────────────────

function generateHelmConfigs(
  releaseName: string,
  preset: HelmPreset,
): Record<string, string> {
  const base = `infra/${releaseName}`;
  return {
    [`${base}/namespace.yaml`]: `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${preset.defaultNamespace}\n  labels:\n    managed-by: endfield\n`,
    [`${base}/helm/Chart.yaml`]: `apiVersion: v2\nname: ${releaseName}\ndescription: Endfield wrapper chart for ${releaseName}\ntype: application\nversion: 0.1.0\n\ndependencies:\n  - name: ${preset.chartName}\n    version: "${preset.version}"\n    repository: "${preset.repo}"\n`,
    [`${base}/helm/values.yaml`]: preset.defaultValues,
    [`${base}/helm/values.prod.yaml`]: preset.prodValues,
    [`${base}/rendered/.gitkeep`]: "",
  };
}

const STATEFUL_IMAGES = [
  "postgres",
  "mysql",
  "mongo",
  "mariadb",
  "redis",
  "kafka",
  "redpanda",
  "cassandra",
  "clickhouse",
  "rabbitmq",
  "nats",
  "elasticsearch",
];

function isStatefulPreset(preset: FieldPreset): boolean {
  const img = preset.image.toLowerCase();
  return STATEFUL_IMAGES.some((name) => img.includes(name));
}

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
  const secretKeys = ["PASSWORD", "SECRET", "KEY", "TOKEN", "PASS"];
  const hasSensitive = envVars.some((e) =>
    secretKeys.some((k) => e.key.toUpperCase().includes(k)),
  );

  files["namespace.yaml"] =
    `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${namespace}\n  labels:\n    managed-by: endfield\n`;

  if (hasSensitive) files[`${f}/${n}-secret.yaml`] = "";

  if (preset.generateService) files[`${f}/${n}-service.yaml`] = "";

  const isStateful = isStatefulPreset(preset);
  if (isStateful) {
    files[`${f}/${n}-statefulset.yaml`] = "";
  } else {
    files[`${f}/${n}-deployment.yaml`] = "";
    if (preset.generateConfigMap) {
      files[`${f}/${n}-configmap.yaml`] = "";
    }
  }

  return files;
}

// ─── Shared input style helpers ─────────────────────────────────────

const INP: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-primary)",
  fontSize: "var(--font-size-sm)",
  padding: "7px 10px",
  outline: "none",
  fontFamily: "var(--font-mono)",
  transition: "border-color 0.12s ease",
};

const LBL: React.CSSProperties = {
  display: "block",
  color: "var(--text-subtle)",
  fontSize: "var(--font-size-xs)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontWeight: 500,
  marginBottom: 5,
  fontFamily: "var(--font-ui)",
};

// ─── Sub-components ─────────────────────────────────────────────────

function PresetCard({
  tt,
  onClick,
  children,
}: {
  tt: (typeof NODE_STYLES)[string];
  onClick: () => void;
  children: React.ReactNode;
}) {
  const [hov, setHov] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: "12px 13px",
        borderRadius: "var(--radius-lg)",
        border: `1px solid ${hov ? tt.border.replace("0.30", "0.50") : "var(--border-subtle)"}`,
        background: hov ? tt.bg : "var(--bg-surface)",
        boxShadow: hov ? `0 0 16px ${tt.shadow}` : "none",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 5,
        transition: "all 0.12s ease",
      }}
    >
      {children}
    </div>
  );
}

function TypeBadge({ tt }: { tt: (typeof NODE_STYLES)[string] }) {
  return (
    <span
      style={{
        fontSize: "var(--font-size-xs)",
        color: tt.color,
        padding: "1px 6px",
        borderRadius: "var(--radius-full)",
        background: tt.bg,
        border: `1px solid ${tt.border}`,
        fontFamily: "var(--font-mono)",
      }}
    >
      {tt.label}
    </span>
  );
}

function SectionBanner({
  tt,
  icon,
  title,
  sub,
}: {
  tt: (typeof NODE_STYLES)[string];
  icon: string;
  title: string;
  sub: string;
}) {
  return (
    <div
      style={{
        padding: "9px 13px",
        background: tt.bg,
        border: `1px solid ${tt.border}`,
        borderRadius: "var(--radius-lg)",
        boxShadow: `0 0 12px ${tt.shadow}`,
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontSize: 17,
          opacity: 0.9,
          color: tt.color,
          display: "flex",
          alignItems: "center",
        }}
      >
        <AppIcon name={icon as AppIconName} size={17} strokeWidth={1.5} />
      </span>
      <div>
        <div
          style={{
            color: tt.color,
            fontWeight: 500,
            fontSize: "var(--font-size-md)",
          }}
        >
          {title}
        </div>
        <div
          style={{
            color: "var(--text-faint)",
            fontSize: "var(--font-size-xs)",
            marginTop: 1,
          }}
        >
          {sub}
        </div>
      </div>
    </div>
  );
}

function FilesPreview({
  files,
  tt,
}: {
  files: string[];
  tt: (typeof NODE_STYLES)[string];
}) {
  return (
    <div>
      <div style={{ ...LBL, marginBottom: 7 }}>Will create</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {files.map((f) => (
          <div
            key={f}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span style={{ display: "flex", color: tt.color }}>
              <AppIcon name="statusDot" size={8} strokeWidth={2} />
            </span>
            <span
              style={{
                color: "var(--text-faint)",
                fontSize: "var(--font-size-xs)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {f}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EnvEditor({
  vars,
  onChange,
}: {
  vars: FieldEnvVar[];
  onChange: (v: FieldEnvVar[]) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {vars.map((env, i) => (
        <div key={i} style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <input
            value={env.key}
            onChange={(e) => {
              const nv = [...vars];
              nv[i] = { ...nv[i], key: e.target.value };
              onChange(nv);
            }}
            style={{
              ...INP,
              flex: "0 0 44%",
              fontSize: "var(--font-size-xs)",
              padding: "4px 8px",
            }}
          />
          <span style={{ color: "var(--border-default)", fontSize: 11 }}>
            :
          </span>
          <input
            value={env.value}
            onChange={(e) => {
              const nv = [...vars];
              nv[i] = { ...nv[i], value: e.target.value };
              onChange(nv);
            }}
            style={{
              ...INP,
              flex: 1,
              fontSize: "var(--font-size-xs)",
              padding: "4px 8px",
            }}
          />
          <button
            onClick={() => onChange(vars.filter((_, j) => j !== i))}
            style={{
              background: "none",
              border: "none",
              color: "var(--ctp-red)",
              cursor: "pointer",
              fontSize: 11,
              opacity: 0.6,
              padding: "0 2px",
              transition: "opacity 0.1s",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.opacity = "1")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.opacity = "0.6")
            }
          >
            <AppIcon name="close" size={10} strokeWidth={2.5} />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...vars, { key: "", value: "" }])}
        style={{
          background: "none",
          border: "1px dashed var(--border-default)",
          borderRadius: "var(--radius-xs)",
          color: "var(--text-faint)",
          fontSize: "var(--font-size-xs)",
          padding: "4px 10px",
          cursor: "pointer",
          fontFamily: "var(--font-ui)",
          textAlign: "left",
          marginTop: 2,
          transition: "var(--ease-fast)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor =
            "var(--border-strong)";
          (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor =
            "var(--border-default)";
          (e.currentTarget as HTMLElement).style.color = "var(--text-faint)";
        }}
      >
        + add variable
      </button>
    </div>
  );
}

function ActionRow({
  onClose,
  onSubmit,
  creating,
  result,
  tt,
  label,
}: {
  onClose: () => void;
  onSubmit: () => void;
  creating: boolean;
  result: string | null;
  tt: (typeof NODE_STYLES)[string];
  label: string;
}) {
  const isOk =
    result?.startsWith("OK") ||
    result?.includes("success") ||
    result?.includes("Created") ||
    result?.includes("Deployed");
  const isWarn =
    result?.includes("error") ||
    result?.includes("Error") ||
    result?.includes("warning");
  return (
    <div style={{ display: "flex", gap: 8, flexShrink: 0, paddingBottom: 2 }}>
      <button
        onClick={onClose}
        style={{
          flex: 1,
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-md)",
          color: "var(--text-muted)",
          fontSize: "var(--font-size-sm)",
          padding: "8px 0",
          cursor: "pointer",
          fontFamily: "var(--font-ui)",
          transition: "var(--ease-fast)",
        }}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLElement).style.background =
            "var(--ctp-surface1)")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLElement).style.background =
            "var(--bg-elevated)")
        }
      >
        Cancel
      </button>
      <button
        onClick={onSubmit}
        disabled={creating || !!isOk || !!isWarn}
        style={{
          flex: 2.5,
          background: isOk
            ? "rgba(166,227,161,0.12)"
            : isWarn
              ? "rgba(250,179,135,0.10)"
              : tt.bg,
          border: `1px solid ${isOk ? "rgba(166,227,161,0.3)" : isWarn ? "rgba(250,179,135,0.3)" : tt.border}`,
          borderRadius: "var(--radius-md)",
          color: isOk
            ? "var(--ctp-green)"
            : isWarn
              ? "var(--ctp-peach)"
              : tt.color,
          fontSize: "var(--font-size-sm)",
          fontWeight: 500,
          padding: "8px 0",
          cursor: creating ? "wait" : "pointer",
          fontFamily: "var(--font-ui)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          transition: "var(--ease-fast)",
          opacity: creating && !result ? 0.7 : 1,
        }}
      >
        {creating && !result && (
          <div
            style={{
              width: 11,
              height: 11,
              borderRadius: "50%",
              border: `1.5px solid ${tt.color}44`,
              borderTopColor: tt.color,
              animation: "ef-spin 0.7s linear infinite",
            }}
          />
        )}
        {result || label}
      </button>
    </div>
  );
}

// ─── Main AddFieldModal ─────────────────────────────────────────────

interface Props {
  onClose: () => void;
  namespace: string;
  projectPath?: string | null;
  onAdd?: (node: YamlNode) => void;
}

export function AddFieldModal({ onClose, namespace }: Props) {
  const addNode = useIDEStore((s) => s.addNode);
  const projectPath = useIDEStore((s) => s.projectPath);

  const [tab, setTab] = useState<"raw" | "helm" | "image">("raw");
  const [step, setStep] = useState<"pick" | "configure">("pick");
  const [selPreset, setSelPreset] = useState("postgres");
  const [selHelm, setSelHelm] = useState("ingress-nginx");
  const [name, setName] = useState("");
  const [port, setPort] = useState(5432);
  const [envVars, setEnvVars] = useState<FieldEnvVar[]>([]);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [hasHelm, setHasHelm] = useState(true);
  const nameRef = useRef<HTMLInputElement>(null);

  // Image tab
  const [imgImage, setImgImage] = useState("");
  const [imgNamespace, setImgNamespace] = useState("apps");
  const [imgReplicas, setImgReplicas] = useState(1);
  const [imgPorts, setImgPorts] = useState<
    Array<{ containerPort: number; name: string }>
  >([]);
  const [imgServiceType, setImgServiceType] = useState<
    "ClusterIP" | "NodePort" | "LoadBalancer"
  >("ClusterIP");
  const [imgEnv, setImgEnv] = useState<FieldEnvVar[]>([]);
  const [imgSecretEnv, setImgSecretEnv] = useState<FieldEnvVar[]>([]);
  const [imgPullSecret, setImgPullSecret] = useState("");
  const [imgCreateNs, setImgCreateNs] = useState(false);

  useEffect(() => {
    if (tab === "image" && step === "pick") {
      setStep("configure");
      setTimeout(() => nameRef.current?.focus(), 60);
    }
  }, [tab, step]);

  useEffect(() => {
    helmAvailable()
      .then(setHasHelm)
      .catch(() => setHasHelm(false));
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const preset = FIELD_PRESETS[selPreset];
  const helmPreset = HELM_PRESETS[selHelm];
  const tt = getStyle(tab === "helm" ? helmPreset.typeId : preset.typeId);

  const pickPreset = (key: string) => {
    const p = FIELD_PRESETS[key];
    setSelPreset(key);
    setName(key);
    setPort(p.defaultPort);
    setEnvVars(p.envVars.map((e) => ({ ...e })));
    setStep("configure");
    setTimeout(() => nameRef.current?.focus(), 60);
  };
  const pickHelm = (key: string) => {
    setSelHelm(key);
    setName(key);
    setStep("configure");
    setTimeout(() => nameRef.current?.focus(), 60);
  };

  const previewFiles =
    tab === "helm"
      ? Object.keys(generateHelmConfigs(name || selHelm, helmPreset))
      : Object.keys(
          generateConfigs(name || selPreset, preset, namespace, port, envVars),
        );

  const handleCreateRaw = async () => {
    if (!name.trim() || creating || !projectPath) return;
    setCreating(true);
    setResult(null);
    const n = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-");
    const fieldConfig: FieldConfig = {
      id: n,
      label: n,
      namespace: "apps",
      image: preset.image || `${n}:latest`,
      replicas: preset.replicas,
      port,
      env: envVars.map((e) => ({ key: e.key, value: e.value })),
      project_path: projectPath,
    };
    try {
      setResult("Generating files...");
      const genResult = await generateField(fieldConfig);
      if (genResult.error) {
        setResult(`Error: ${genResult.error}`);
        setCreating(false);
        return;
      }
      const fieldDir = `${projectPath}/apps/${n}`;
      const mainFile =
        genResult.generated_files.find(
          (f) => f.includes("statefulset") || f.includes("deployment"),
        ) ??
        genResult.generated_files[0] ??
        `${fieldDir}/deployment.yaml`;
      addNode({
        id: genId("node"),
        label: n,
        kind: isStatefulPreset(preset) ? "StatefulSet" : preset.kind,
        image: preset.image || `${n}:latest`,
        type_id: preset.typeId,
        namespace: genResult.namespace,
        file_path: mainFile,
        replicas: preset.replicas,
        source: "raw",
        x: 20 + Math.random() * 40,
        y: 20 + Math.random() * 40,
      });
      setResult("Deploying to cluster...");
      const deployResult = await deployResource(
        n,
        "raw",
        fieldDir,
        genResult.namespace,
      );
      if (!deployResult.success) {
        const errMsg = deployResult.stderr?.trim() || "kubectl apply failed";
        setResult(`Error: ${errMsg.split("\n")[0]}`);
        setCreating(false);
        return;
      }
      setResult("OK: Deployed");
    } catch (e) {
      setResult(`Error: ${String(e)}`);
    }
    setCreating(false);
    setTimeout(onClose, 900);
  };

  const handleCreateHelm = async () => {
    if (!name.trim() || creating || !projectPath) return;
    setCreating(true);
    setResult("Saving files...");
    const n = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-");
    const infraConfig: InfraConfig = {
      id: n,
      label: n,
      source: "helm",
      namespace: helmPreset.defaultNamespace,
      helm: {
        repo_name: helmPreset.chartName,
        repo_url: helmPreset.repo,
        chart_name: helmPreset.chartName,
        chart_version: helmPreset.version,
        values_path: null,
      },
      raw_yaml_path: null,
      project_path: projectPath,
    };
    try {
      const genResult = await generateInfra(infraConfig);
      if (genResult.error) {
        setResult(`Error: ${genResult.error}`);
        setCreating(false);
        return;
      }
      await saveYamlFile(
        `${projectPath}/infra/${n}/helm/values.yaml`,
        helmPreset.defaultValues,
      ).catch(() => {});
      await saveYamlFile(
        `${projectPath}/infra/${n}/helm/values.prod.yaml`,
        helmPreset.prodValues,
      ).catch(() => {});
      addNode({
        id: genId("node"),
        label: n,
        kind: "HelmRelease",
        image: `helm:${helmPreset.chartName}/${helmPreset.version}`,
        type_id: helmPreset.typeId,
        namespace: genResult.namespace,
        file_path: `${projectPath}/infra/${n}/helm/Chart.yaml`,
        replicas: null,
        source: "helm",
        helm: {
          release_name: n,
          namespace: genResult.namespace,
          chart_name: helmPreset.chartName,
          chart_version: helmPreset.version,
          repo: helmPreset.repo,
          values_path: `${projectPath}/infra/${n}/helm/values.yaml`,
          rendered_dir: `${projectPath}/infra/${n}/rendered`,
        },
        x: 20 + Math.random() * 40,
        y: 20 + Math.random() * 40,
      });
      setResult("OK: Files saved — deploying in background...");
      const infraDir = `${projectPath}/infra/${n}`;
      deployResource(n, "helm", infraDir, genResult.namespace, {
        helmRelease: n,
        helmRepoName: helmPreset.chartName,
        helmRepoUrl: helmPreset.repo,
      })
        .then((r) => {
          if (!r.success) console.error("[helm deploy failed]", r.stderr);
        })
        .catch((e) => console.error("[helm deploy error]", e));
    } catch (e) {
      setResult(`Error: ${String(e)}`);
      setCreating(false);
      return;
    }
    setCreating(false);
    setTimeout(onClose, 900);
  };

  const handleCreateImage = async () => {
    if (!name.trim() || !imgImage.trim() || creating) return;
    setCreating(true);
    setResult("Deploying…");
    const n = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-");
    const request: DeployImageRequest = {
      namespace: imgNamespace,
      name: n,
      image: imgImage.trim(),
      replicas: imgReplicas,
      env: imgEnv.filter((e) => e.key.trim()),
      secretEnv: imgSecretEnv.filter((e) => e.key.trim()),
      ports: imgPorts.filter((p) => p.containerPort > 0),
      serviceType: imgServiceType,
      imagePullSecret: imgPullSecret.trim() || undefined,
      createNamespace: imgCreateNs,
    };
    try {
      const res = await deployImage(request);
      if (res.success) {
        // Save manifests to disk so deletion, editing and file watcher all work
        const fieldDir = `${projectPath}/apps/${n}`;
        const saves: Promise<void>[] = [];
        if (res.manifests.namespace) {
          saves.push(
            saveYamlFile(
              `${fieldDir}/namespace.yaml`,
              res.manifests.namespace,
            ).catch(() => {}),
          );
        }
        if (res.manifests.secret) {
          saves.push(
            saveYamlFile(
              `${fieldDir}/${n}-secret.yaml`,
              res.manifests.secret,
            ).catch(() => {}),
          );
        }
        saves.push(
          saveYamlFile(
            `${fieldDir}/deployment.yaml`,
            res.manifests.deployment,
          ).catch(() => {}),
        );
        if (res.manifests.service) {
          saves.push(
            saveYamlFile(
              `${fieldDir}/service.yaml`,
              res.manifests.service,
            ).catch(() => {}),
          );
        }
        await Promise.all(saves);

        setResult("OK: Deployed");
        addNode({
          id: genId("node"),
          label: n,
          kind: "Deployment",
          image: imgImage.trim(),
          type_id: "service",
          namespace: imgNamespace,
          file_path: `${fieldDir}/deployment.yaml`,
          replicas: imgReplicas,
          source: "raw",
          x: 20 + Math.random() * 40,
          y: 20 + Math.random() * 40,
        });
        setTimeout(onClose, 1200);
      } else {
        setResult(`Error: ${res.error ?? res.stderr.split("\n")[0]}`);
      }
    } catch (e) {
      setResult(`Error: ${String(e)}`);
    }
    setCreating(false);
  };

  const TABS = [
    ["raw", "Raw YAML"],
    ["helm", `Helm${!hasHelm ? " (install helm)" : ""}`],
    ["image", "Custom Image"],
  ] as const;

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Backdrop */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(17,17,27,0.60)",
          backdropFilter: "var(--blur-md)",
          WebkitBackdropFilter: "var(--blur-md)",
        }}
      />

      <div
        style={{
          position: "relative",
          width: step === "pick" ? 700 : 480,
          maxHeight: "88vh",
          borderRadius: "var(--radius-2xl)",
          background: "var(--bg-modal)",
          border: "1px solid var(--border-default)",
          boxShadow: "var(--shadow-modal)",
          display: "flex",
          flexDirection: "column",
          fontFamily: "var(--font-ui)",
          overflow: "hidden",
          transition: "width 0.2s cubic-bezier(0.4,0,0.2,1)",
          animation: "ef-fadein 0.12s ease-out",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "11px 16px",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {step === "configure" && (
              <button
                onClick={() => {
                  setStep("pick");
                  setResult(null);
                  if (tab === "image") setTab("raw");
                }}
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-xs)",
                  color: "var(--text-muted)",
                  fontSize: "var(--font-size-xs)",
                  padding: "2px 8px",
                  cursor: "pointer",
                  fontFamily: "var(--font-ui)",
                  transition: "var(--ease-fast)",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLElement).style.background =
                    "var(--ctp-surface1)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLElement).style.background =
                    "var(--bg-elevated)")
                }
              >
                back
              </button>
            )}
            <span
              style={{
                color: "var(--text-primary)",
                fontWeight: 500,
                fontSize: "var(--font-size-md)",
              }}
            >
              {step === "pick"
                ? "Add Field"
                : `Configure · ${tab === "helm" ? selHelm : selPreset}`}
            </span>
            <span
              style={{
                color: "var(--text-faint)",
                fontSize: "var(--font-size-xs)",
                padding: "1px 7px",
                borderRadius: "var(--radius-full)",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-subtle)",
                fontFamily: "var(--font-mono)",
              }}
            >
              ns: {namespace}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "var(--bg-elevated)",
              border: "none",
              borderRadius: "50%",
              width: 22,
              height: 22,
              color: "var(--text-faint)",
              cursor: "pointer",
              fontSize: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "var(--ease-fast)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background =
                "var(--ctp-surface1)";
              (e.currentTarget as HTMLElement).style.color =
                "var(--text-secondary)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background =
                "var(--bg-elevated)";
              (e.currentTarget as HTMLElement).style.color =
                "var(--text-faint)";
            }}
          >
            <AppIcon name="close" size={10} strokeWidth={2.5} />
          </button>
        </div>

        {/* Tab switcher */}
        {step === "pick" && (
          <div
            style={{
              display: "flex",
              gap: 5,
              padding: "10px 16px 0",
              flexShrink: 0,
            }}
          >
            {TABS.map(([tb, label]) => (
              <button
                key={tb}
                onClick={() => setTab(tb as "raw" | "helm" | "image")}
                style={{
                  background:
                    tab === tb ? "var(--bg-sidebar-active)" : "transparent",
                  border: `1px solid ${tab === tb ? "var(--border-accent)" : "var(--border-subtle)"}`,
                  borderRadius: "var(--radius-sm)",
                  color: tab === tb ? "var(--accent-alt)" : "var(--text-faint)",
                  fontSize: "var(--font-size-xs)",
                  padding: "4px 13px",
                  cursor: "pointer",
                  fontFamily: "var(--font-ui)",
                  fontWeight: tab === tb ? 500 : 400,
                  transition: "var(--ease-fast)",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* ── Raw preset grid ── */}
        {step === "pick" && tab === "raw" && (
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "12px 16px 16px",
              minHeight: 0,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3,1fr)",
                gap: 8,
              }}
            >
              {Object.entries(FIELD_PRESETS).map(([key, p]) => {
                const t2 = getStyle(p.typeId);
                return (
                  <PresetCard key={key} tt={t2} onClick={() => pickPreset(key)}>
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
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 15,
                            opacity: 0.85,
                            display: "flex",
                            alignItems: "center",
                          }}
                        >
                          <AppIcon
                            name={t2.icon as AppIconName}
                            size={15}
                            strokeWidth={1.5}
                          />
                        </span>
                        <span
                          style={{
                            color: "var(--text-primary)",
                            fontWeight: 500,
                            fontSize: "var(--font-size-md)",
                          }}
                        >
                          {key}
                        </span>
                      </div>
                      <TypeBadge tt={t2} />
                    </div>
                    <div
                      style={{
                        color: "var(--text-faint)",
                        fontSize: "var(--font-size-xs)",
                        lineHeight: 1.4,
                      }}
                    >
                      {p.description}
                    </div>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 5 }}
                    >
                      <span
                        style={{
                          color: "var(--text-faint)",
                          fontSize: "var(--font-size-xs)",
                          fontFamily: "var(--font-mono)",
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.image || "custom"}
                      </span>
                      <span
                        style={{
                          color: t2.color,
                          fontSize: "var(--font-size-xs)",
                          fontFamily: "var(--font-mono)",
                          flexShrink: 0,
                        }}
                      >
                        :{p.defaultPort}
                      </span>
                    </div>
                  </PresetCard>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Helm preset grid ── */}
        {step === "pick" && tab === "helm" && (
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "12px 16px 16px",
              minHeight: 0,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3,1fr)",
                gap: 8,
              }}
            >
              {Object.entries(HELM_PRESETS).map(([key, p]) => {
                const t2 = getStyle(p.typeId);
                return (
                  <PresetCard key={key} tt={t2} onClick={() => pickHelm(key)}>
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
                          gap: 6,
                        }}
                      >
                        <AppIcon
                          name="helmRelease"
                          size={15}
                          strokeWidth={1.5}
                          style={{ opacity: 0.85 }}
                        />
                        <span
                          style={{
                            color: "var(--text-primary)",
                            fontWeight: 500,
                            fontSize: "var(--font-size-md)",
                          }}
                        >
                          {key}
                        </span>
                      </div>
                      <TypeBadge tt={t2} />
                    </div>
                    <div
                      style={{
                        color: "var(--text-faint)",
                        fontSize: "var(--font-size-xs)",
                        lineHeight: 1.4,
                      }}
                    >
                      {p.description}
                    </div>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 5 }}
                    >
                      <span
                        style={{
                          color: "var(--text-faint)",
                          fontSize: "var(--font-size-xs)",
                          fontFamily: "var(--font-mono)",
                          flex: 1,
                        }}
                      >
                        {p.chartName}
                      </span>
                      <span
                        style={{
                          color: t2.color,
                          fontSize: "var(--font-size-xs)",
                          fontFamily: "var(--font-mono)",
                          flexShrink: 0,
                        }}
                      >
                        v{p.version}
                      </span>
                    </div>
                  </PresetCard>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Configure Raw ── */}
        {step === "configure" && tab === "raw" && (
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
              minHeight: 0,
            }}
          >
            <SectionBanner
              tt={tt}
              icon={tt.icon}
              title={preset.description}
              sub={`${preset.kind} · ${preset.folder}/ · :${port}`}
            />
            <div>
              <label style={LBL}>Name</label>
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateRaw();
                }}
                placeholder={selPreset}
                style={INP}
                onFocus={(e) =>
                  ((e.target as HTMLInputElement).style.borderColor =
                    "var(--border-accent)")
                }
                onBlur={(e) =>
                  ((e.target as HTMLInputElement).style.borderColor =
                    "var(--border-default)")
                }
              />
            </div>
            <div>
              <label style={LBL}>
                Port{" "}
                <span
                  style={{ textTransform: "none", color: "var(--text-faint)" }}
                >
                  (default: {preset.defaultPort})
                </span>
              </label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                style={{ ...INP, color: tt.color }}
                onFocus={(e) =>
                  ((e.target as HTMLInputElement).style.borderColor = tt.border)
                }
                onBlur={(e) =>
                  ((e.target as HTMLInputElement).style.borderColor =
                    "var(--border-default)")
                }
              />
            </div>
            {envVars.length > 0 && (
              <div>
                <label style={LBL}>Environment</label>
                <EnvEditor vars={envVars} onChange={setEnvVars} />
              </div>
            )}
            <FilesPreview files={previewFiles} tt={tt} />
            <ActionRow
              onClose={onClose}
              onSubmit={handleCreateRaw}
              creating={creating}
              result={result}
              tt={tt}
              label="Create & Deploy"
            />
          </div>
        )}

        {/* ── Configure Helm ── */}
        {step === "configure" && tab === "helm" && (
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
              minHeight: 0,
            }}
          >
            <SectionBanner
              tt={tt}
              icon="helmRelease"
              title={helmPreset.description}
              sub={`${helmPreset.chartName} v${helmPreset.version} · ${helmPreset.repo}`}
            />
            {!hasHelm && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "6px 10px",
                  background: "rgba(249,226,175,0.07)",
                  border: "1px solid rgba(249,226,175,0.20)",
                  borderRadius: "var(--radius-md)",
                }}
              >
                <AppIcon
                  name="warning"
                  size={12}
                  strokeWidth={2}
                  style={{ color: "var(--ctp-yellow)" }}
                />
                <span
                  style={{
                    color: "var(--ctp-yellow)",
                    fontSize: "var(--font-size-xs)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  helm not found in PATH — install helm to deploy
                </span>
              </div>
            )}
            <div>
              <label style={LBL}>Release name</label>
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateHelm();
                }}
                placeholder={selHelm}
                style={INP}
                onFocus={(e) =>
                  ((e.target as HTMLInputElement).style.borderColor =
                    "var(--border-accent)")
                }
                onBlur={(e) =>
                  ((e.target as HTMLInputElement).style.borderColor =
                    "var(--border-default)")
                }
              />
            </div>
            <div
              style={{
                padding: "8px 10px",
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <div
                style={{
                  color: "var(--text-subtle)",
                  fontSize: "var(--font-size-xs)",
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  marginBottom: 3,
                  fontWeight: 500,
                }}
              >
                Namespace
              </div>
              <div
                style={{
                  color: tt.color,
                  fontSize: "var(--font-size-sm)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {helmPreset.defaultNamespace}
              </div>
            </div>
            <FilesPreview files={previewFiles} tt={tt} />
            <ActionRow
              onClose={onClose}
              onSubmit={handleCreateHelm}
              creating={creating}
              result={result}
              tt={tt}
              label="Generate & Add"
            />
          </div>
        )}

        {/* ── Configure Custom Image ── */}
        {step === "configure" && tab === "image" && (
          <ConfigureImage
            name={name}
            setName={setName}
            imgImage={imgImage}
            setImgImage={setImgImage}
            imgNamespace={imgNamespace}
            setImgNamespace={setImgNamespace}
            imgReplicas={imgReplicas}
            setImgReplicas={setImgReplicas}
            imgPorts={imgPorts}
            setImgPorts={setImgPorts}
            imgServiceType={imgServiceType}
            setImgServiceType={setImgServiceType}
            imgEnv={imgEnv}
            setImgEnv={setImgEnv}
            imgSecretEnv={imgSecretEnv}
            setImgSecretEnv={setImgSecretEnv}
            imgPullSecret={imgPullSecret}
            setImgPullSecret={setImgPullSecret}
            imgCreateNs={imgCreateNs}
            setImgCreateNs={setImgCreateNs}
            nameRef={nameRef}
            onClose={onClose}
            onSubmit={handleCreateImage}
            creating={creating}
            result={result}
          />
        )}
      </div>

      <style>{`@keyframes ef-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── ConfigureImage ─────────────────────────────────────────────────

interface ConfigureImageProps {
  name: string;
  setName: (v: string) => void;
  imgImage: string;
  setImgImage: (v: string) => void;
  imgNamespace: string;
  setImgNamespace: (v: string) => void;
  imgReplicas: number;
  setImgReplicas: (v: number) => void;
  imgPorts: Array<{ containerPort: number; name: string }>;
  setImgPorts: React.Dispatch<
    React.SetStateAction<Array<{ containerPort: number; name: string }>>
  >;
  imgServiceType: "ClusterIP" | "NodePort" | "LoadBalancer";
  setImgServiceType: (v: "ClusterIP" | "NodePort" | "LoadBalancer") => void;
  imgEnv: FieldEnvVar[];
  setImgEnv: React.Dispatch<React.SetStateAction<FieldEnvVar[]>>;
  imgSecretEnv: FieldEnvVar[];
  setImgSecretEnv: React.Dispatch<React.SetStateAction<FieldEnvVar[]>>;
  imgPullSecret: string;
  setImgPullSecret: (v: string) => void;
  imgCreateNs: boolean;
  setImgCreateNs: (v: boolean) => void;
  nameRef: React.RefObject<HTMLInputElement>;
  onClose: () => void;
  onSubmit: () => void;
  creating: boolean;
  result: string | null;
}

function ConfigureImage(props: ConfigureImageProps) {
  const tt = getStyle("service");
  const {
    name,
    setName,
    imgImage,
    setImgImage,
    imgNamespace,
    setImgNamespace,
    imgReplicas,
    setImgReplicas,
    imgPorts,
    setImgPorts,
    imgServiceType,
    setImgServiceType,
    imgEnv,
    setImgEnv,
    imgSecretEnv,
    setImgSecretEnv,
    imgPullSecret,
    setImgPullSecret,
    imgCreateNs,
    setImgCreateNs,
    nameRef,
    onClose,
    onSubmit,
    creating,
    result,
  } = props;

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 13,
        minHeight: 0,
      }}
    >
      <SectionBanner
        tt={tt}
        icon="deploy"
        title="Deploy Custom Image"
        sub="Endfield generates manifests and deploys to cluster. No YAML needed."
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label style={LBL}>App Name</label>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) =>
              setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
            }
            placeholder="my-app"
            style={{
              ...INP,
              borderColor: !name.trim() ? "rgba(243,139,168,0.35)" : undefined,
            }}
            onFocus={(e) =>
              ((e.target as HTMLInputElement).style.borderColor =
                "var(--border-accent)")
            }
            onBlur={(e) =>
              ((e.target as HTMLInputElement).style.borderColor = name.trim()
                ? "var(--border-default)"
                : "rgba(243,139,168,0.35)")
            }
          />
        </div>
        <div>
          <label style={LBL}>Namespace</label>
          <input
            value={imgNamespace}
            onChange={(e) => setImgNamespace(e.target.value)}
            style={INP}
            onFocus={(e) =>
              ((e.target as HTMLInputElement).style.borderColor =
                "var(--border-accent)")
            }
            onBlur={(e) =>
              ((e.target as HTMLInputElement).style.borderColor =
                "var(--border-default)")
            }
          />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              marginTop: 4,
              cursor: "pointer",
              color: "var(--text-faint)",
              fontSize: "var(--font-size-xs)",
            }}
          >
            <input
              type="checkbox"
              checked={imgCreateNs}
              onChange={(e) => setImgCreateNs(e.target.checked)}
              style={{ accentColor: "var(--accent)", cursor: "pointer" }}
            />
            create if not exists
          </label>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 72px", gap: 8 }}>
        <div>
          <label style={LBL}>Image</label>
          <input
            value={imgImage}
            onChange={(e) => setImgImage(e.target.value)}
            placeholder="registry.io/repo:tag"
            style={{
              ...INP,
              borderColor: !imgImage.trim()
                ? "rgba(243,139,168,0.35)"
                : undefined,
            }}
            onFocus={(e) =>
              ((e.target as HTMLInputElement).style.borderColor =
                "var(--border-accent)")
            }
            onBlur={(e) =>
              ((e.target as HTMLInputElement).style.borderColor =
                imgImage.trim()
                  ? "var(--border-default)"
                  : "rgba(243,139,168,0.35)")
            }
          />
        </div>
        <div>
          <label style={LBL}>Replicas</label>
          <input
            type="number"
            min={1}
            max={99}
            value={imgReplicas}
            onChange={(e) => setImgReplicas(parseInt(e.target.value) || 1)}
            style={{ ...INP, textAlign: "center" }}
          />
        </div>
      </div>

      {/* Ports */}
      <div>
        <label style={LBL}>
          Ports{" "}
          <span style={{ textTransform: "none", color: "var(--text-faint)" }}>
            (optional — creates Service)
          </span>
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {imgPorts.map((p, i) => (
            <div
              key={i}
              style={{ display: "flex", gap: 5, alignItems: "center" }}
            >
              <input
                type="number"
                min={1}
                max={65535}
                value={p.containerPort}
                onChange={(e) =>
                  setImgPorts((prev) =>
                    prev.map((x, j) =>
                      j === i
                        ? { ...x, containerPort: parseInt(e.target.value) || 0 }
                        : x,
                    ),
                  )
                }
                style={{ ...INP, width: 80, textAlign: "center" }}
              />
              <input
                value={p.name}
                onChange={(e) =>
                  setImgPorts((prev) =>
                    prev.map((x, j) =>
                      j === i ? { ...x, name: e.target.value } : x,
                    ),
                  )
                }
                placeholder="name (opt)"
                style={{ ...INP, flex: 1, fontSize: "var(--font-size-xs)" }}
              />
              <button
                onClick={() =>
                  setImgPorts((prev) => prev.filter((_, j) => j !== i))
                }
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--ctp-red)",
                  cursor: "pointer",
                  fontSize: 11,
                  opacity: 0.6,
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLElement).style.opacity = "1")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLElement).style.opacity = "0.6")
                }
              >
                <AppIcon name="close" size={10} strokeWidth={2.5} />
              </button>
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            gap: 6,
            marginTop: 5,
            alignItems: "center",
          }}
        >
          <button
            onClick={() =>
              setImgPorts((prev) => {
                // pick a port that's not already used
                const used = new Set(prev.map((p) => p.containerPort));
                let next = 8080;
                while (used.has(next)) next++;
                return [...prev, { containerPort: next, name: "" }];
              })
            }
            style={{
              background: "none",
              border: "1px dashed var(--border-default)",
              borderRadius: "var(--radius-xs)",
              color: "var(--text-faint)",
              fontSize: "var(--font-size-xs)",
              padding: "3px 9px",
              cursor: "pointer",
              fontFamily: "var(--font-ui)",
              transition: "var(--ease-fast)",
            }}
          >
            + port
          </button>
          {imgPorts.length > 0 && (
            <select
              value={imgServiceType}
              onChange={(e) =>
                setImgServiceType(e.target.value as typeof imgServiceType)
              }
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-xs)",
                color: "var(--text-muted)",
                fontSize: "var(--font-size-xs)",
                padding: "3px 7px",
                fontFamily: "var(--font-ui)",
                cursor: "pointer",
                outline: "none",
              }}
            >
              <option value="ClusterIP">ClusterIP</option>
              <option value="NodePort">NodePort</option>
              <option value="LoadBalancer">LoadBalancer</option>
            </select>
          )}
        </div>
      </div>

      {/* Plain env */}
      <div>
        <label style={LBL}>
          Env Variables{" "}
          <span style={{ textTransform: "none", color: "var(--text-faint)" }}>
            (plain)
          </span>
        </label>
        <EnvEditor vars={imgEnv} onChange={(v) => setImgEnv(v)} />
      </div>

      {/* Secret env */}
      <div>
        <label style={LBL}>
          <AppIcon
            name="secret"
            size={12}
            strokeWidth={1.75}
            style={{ color: "var(--ctp-red)", marginRight: 4 }}
          />{" "}
          Secret Env{" "}
          <span style={{ textTransform: "none", color: "var(--text-faint)" }}>
            (stored in K8s Secret)
          </span>
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {imgSecretEnv.map((e, i) => (
            <div
              key={i}
              style={{ display: "flex", gap: 5, alignItems: "center" }}
            >
              <input
                value={e.key}
                onChange={(ev) =>
                  setImgSecretEnv((prev) =>
                    prev.map((x, j) =>
                      j === i ? { ...x, key: ev.target.value } : x,
                    ),
                  )
                }
                placeholder="SECRET_KEY"
                style={{
                  ...INP,
                  flex: "0 0 44%",
                  fontSize: "var(--font-size-xs)",
                  padding: "4px 8px",
                  borderColor: "rgba(243,139,168,0.20)",
                }}
              />
              <input
                value={e.value}
                type="password"
                onChange={(ev) =>
                  setImgSecretEnv((prev) =>
                    prev.map((x, j) =>
                      j === i ? { ...x, value: ev.target.value } : x,
                    ),
                  )
                }
                placeholder="secret value"
                style={{
                  ...INP,
                  flex: 1,
                  fontSize: "var(--font-size-xs)",
                  padding: "4px 8px",
                  background: "rgba(243,139,168,0.04)",
                  borderColor: "rgba(243,139,168,0.20)",
                }}
              />
              <button
                onClick={() =>
                  setImgSecretEnv((prev) => prev.filter((_, j) => j !== i))
                }
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--ctp-red)",
                  cursor: "pointer",
                  fontSize: 11,
                  opacity: 0.6,
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLElement).style.opacity = "1")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLElement).style.opacity = "0.6")
                }
              >
                <AppIcon name="close" size={10} strokeWidth={2.5} />
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              setImgSecretEnv((prev) => [...prev, { key: "", value: "" }])
            }
            style={{
              background: "none",
              border: "1px dashed rgba(243,139,168,0.20)",
              borderRadius: "var(--radius-xs)",
              color: "rgba(243,139,168,0.45)",
              fontSize: "var(--font-size-xs)",
              padding: "4px 10px",
              cursor: "pointer",
              fontFamily: "var(--font-ui)",
              textAlign: "left",
              marginTop: 2,
              transition: "var(--ease-fast)",
            }}
          >
            + secret
          </button>
        </div>
      </div>

      {/* Pull secret */}
      <div>
        <label style={LBL}>
          Image Pull Secret{" "}
          <span style={{ textTransform: "none", color: "var(--text-faint)" }}>
            (private registry)
          </span>
        </label>
        <input
          value={imgPullSecret}
          onChange={(e) => setImgPullSecret(e.target.value)}
          placeholder="my-registry-secret (optional)"
          style={{ ...INP, color: "var(--text-muted)" }}
          onFocus={(e) =>
            ((e.target as HTMLInputElement).style.borderColor =
              "var(--border-accent)")
          }
          onBlur={(e) =>
            ((e.target as HTMLInputElement).style.borderColor =
              "var(--border-default)")
          }
        />
      </div>

      <ActionRow
        onClose={onClose}
        onSubmit={onSubmit}
        creating={creating}
        result={result}
        tt={tt}
        label="Deploy"
      />
    </div>
  );
}
