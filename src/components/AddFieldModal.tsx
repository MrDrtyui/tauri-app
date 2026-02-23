import React, { useState, useRef, useEffect } from "react";
import { useIDEStore } from "../store/ideStore";
import {
  saveYamlFile,
  helmAvailable,
  generateField,
  generateInfra,
  deployResource,
  deployImage,
  type FieldConfig,
  type InfraConfig,
  type DeployImageRequest,
} from "../store/tauriStore";
import { genId } from "../layout/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Node type styles ─────────────────────────────────────────────────────────

const NODE_STYLES: Record<
  string,
  {
    bg: string;
    border: string;
    color: string;
    shadow: string;
    accent: string;
    icon: string;
    label: string;
  }
> = {
  gateway: {
    bg: "linear-gradient(135deg,#0f2847,#1a3a6b)",
    border: "rgba(96,165,250,0.6)",
    color: "#bfdbfe",
    shadow: "rgba(59,130,246,0.4)",
    accent: "#3b82f6",
    icon: "⬡",
    label: "gateway",
  },
  service: {
    bg: "linear-gradient(135deg,#052e1c,#0d4a2e)",
    border: "rgba(52,211,153,0.6)",
    color: "#6ee7b7",
    shadow: "rgba(16,185,129,0.35)",
    accent: "#10b981",
    icon: "◈",
    label: "service",
  },
  database: {
    bg: "linear-gradient(135deg,#0a1f3d,#112d58)",
    border: "rgba(59,130,246,0.55)",
    color: "#93c5fd",
    shadow: "rgba(37,99,235,0.4)",
    accent: "#2563eb",
    icon: "◫",
    label: "database",
  },
  cache: {
    bg: "linear-gradient(135deg,#2d1000,#4a1f00)",
    border: "rgba(251,146,60,0.6)",
    color: "#fed7aa",
    shadow: "rgba(234,88,12,0.4)",
    accent: "#ea580c",
    icon: "⚡",
    label: "cache",
  },
  queue: {
    bg: "linear-gradient(135deg,#2d0000,#4a0a0a)",
    border: "rgba(239,68,68,0.6)",
    color: "#fca5a5",
    shadow: "rgba(220,38,38,0.4)",
    accent: "#dc2626",
    icon: "⊛",
    label: "queue",
  },
  monitoring: {
    bg: "linear-gradient(135deg,#12003d,#1e0a5e)",
    border: "rgba(167,139,250,0.6)",
    color: "#ddd6fe",
    shadow: "rgba(124,58,237,0.4)",
    accent: "#7c3aed",
    icon: "◎",
    label: "monitoring",
  },
  infra: {
    bg: "linear-gradient(135deg,#0d1f0d,#1a3a1a)",
    border: "rgba(74,222,128,0.55)",
    color: "#bbf7d0",
    shadow: "rgba(34,197,94,0.35)",
    accent: "#16a34a",
    icon: "⛵",
    label: "infra",
  },
  custom: {
    bg: "linear-gradient(135deg,#0f1117,#1a1d27)",
    border: "rgba(100,116,139,0.5)",
    color: "#cbd5e1",
    shadow: "rgba(71,85,105,0.35)",
    accent: "#475569",
    icon: "◇",
    label: "custom",
  },
};
function getStyle(typeId: string) {
  return NODE_STYLES[typeId] ?? NODE_STYLES.custom;
}

// ─── Presets ──────────────────────────────────────────────────────────────────

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
    description: "kube-prometheus-stack (Prometheus + Grafana)",
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

// ─── YAML generators ──────────────────────────────────────────────────────────

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
  const presetKey =
    Object.keys(FIELD_PRESETS).find((k) => FIELD_PRESETS[k] === preset) ??
    "custom";
  const secretKeys = ["PASSWORD", "SECRET", "KEY", "TOKEN", "PASS"];
  const sensitiveVars = envVars.filter((e) =>
    secretKeys.some((k) => e.key.toUpperCase().includes(k)),
  );
  const plainVars = envVars.filter(
    (e) => !secretKeys.some((k) => e.key.toUpperCase().includes(k)),
  );

  files["namespace.yaml"] =
    `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${namespace}\n  labels:\n    managed-by: endfield\n`;
  if (sensitiveVars.length > 0)
    files[`${f}/${n}-secret.yaml`] =
      `apiVersion: v1\nkind: Secret\nmetadata:\n  name: ${n}-secret\n  namespace: ${namespace}\ntype: Opaque\nstringData:\n${sensitiveVars.map((e) => `  ${e.key}: "${e.value}"`).join("\n")}\n`;
  if (preset.generateConfigMap && plainVars.length > 0)
    files[`${f}/${n}-configmap.yaml`] =
      `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${n}-config\n  namespace: ${namespace}\ndata:\n${plainVars.map((e) => `  ${e.key}: "${e.value}"`).join("\n")}\n`;

  const buildEnv = (): string => {
    const all = [...envVars];
    if (presetKey === "postgres" && !all.find((e) => e.key === "PGDATA"))
      all.push({ key: "PGDATA", value: "/var/lib/postgresql/data/pgdata" });
    if (all.length === 0) return "";
    const lines = ["          env:"];
    for (const e of all) {
      const isSensitive = secretKeys.some((k) =>
        e.key.toUpperCase().includes(k),
      );
      if (isSensitive && sensitiveVars.length > 0)
        lines.push(
          `          - name: ${e.key}`,
          `            valueFrom:`,
          `              secretKeyRef:`,
          `                name: ${n}-secret`,
          `                key: ${e.key}`,
        );
      else if (
        preset.generateConfigMap &&
        plainVars.find((v) => v.key === e.key)
      )
        lines.push(
          `          - name: ${e.key}`,
          `            valueFrom:`,
          `              configMapKeyRef:`,
          `                name: ${n}-config`,
          `                key: ${e.key}`,
        );
      else
        lines.push(
          `          - name: ${e.key}`,
          `            value: "${e.value}"`,
        );
    }
    return lines.join("\n");
  };

  const res: Record<string, [string, string, string, string]> = {
    postgres: ["250m", "256Mi", "1000m", "1Gi"],
    mongodb: ["250m", "256Mi", "1000m", "1Gi"],
    redis: ["100m", "128Mi", "500m", "512Mi"],
    kafka: ["500m", "1Gi", "2000m", "4Gi"],
    redpanda: ["500m", "1Gi", "2000m", "4Gi"],
    nginx: ["50m", "64Mi", "250m", "256Mi"],
    grafana: ["100m", "128Mi", "500m", "512Mi"],
    prometheus: ["250m", "512Mi", "1000m", "2Gi"],
    custom: ["50m", "64Mi", "500m", "512Mi"],
  };
  const [rc, rm, lc, lm] = res[presetKey] ?? res.custom;
  const rsec = `          resources:\n            requests:\n              cpu: "${rc}"\n              memory: "${rm}"\n            limits:\n              cpu: "${lc}"\n              memory: "${lm}"`;
  const vm = preset.storageSize
    ? presetKey === "postgres"
      ? `          volumeMounts:\n            - name: data\n              mountPath: /var/lib/postgresql/data\n              subPath: pgdata`
      : presetKey === "mongodb"
        ? `          volumeMounts:\n            - name: data\n              mountPath: /data/db`
        : `          volumeMounts:\n            - name: data\n              mountPath: /data`
    : "";
  const pvc = preset.storageSize
    ? `  volumeClaimTemplates:\n    - metadata:\n        name: data\n      spec:\n        accessModes: ["ReadWriteOnce"]\n        resources:\n          requests:\n            storage: ${preset.storageSize}`
    : "";
  const envSec = buildEnv();

  if (preset.kind === "StatefulSet") {
    files[`${f}/${n}-headless-svc.yaml`] =
      `apiVersion: v1\nkind: Service\nmetadata:\n  name: ${n}-headless\n  namespace: ${namespace}\nspec:\n  clusterIP: None\n  selector:\n    app: ${n}\n  ports:\n    - port: ${port}\n      targetPort: ${port}\n`;
    const p = [
      `apiVersion: apps/v1`,
      `kind: StatefulSet`,
      `metadata:`,
      `  name: ${n}`,
      `  namespace: ${namespace}`,
      `spec:`,
      `  serviceName: ${n}-headless`,
      `  replicas: ${preset.replicas}`,
      `  updateStrategy:`,
      `    type: RollingUpdate`,
      `  selector:`,
      `    matchLabels:`,
      `      app: ${n}`,
      `  template:`,
      `    metadata:`,
      `      labels:`,
      `        app: ${n}`,
      `    spec:`,
      `      containers:`,
      `        - name: ${n}`,
      `          image: ${preset.image}`,
      `          ports:`,
      `            - containerPort: ${port}`,
    ];
    if (envSec) p.push(envSec);
    p.push(rsec);
    if (vm) p.push(vm);
    if (pvc) p.push(pvc);
    files[`${f}/${n}-statefulset.yaml`] = p.join("\n") + "\n";
  }
  if (preset.kind === "Deployment") {
    const p = [
      `apiVersion: apps/v1`,
      `kind: Deployment`,
      `metadata:`,
      `  name: ${n}`,
      `  namespace: ${namespace}`,
      `spec:`,
      `  replicas: ${preset.replicas}`,
      `  selector:`,
      `    matchLabels:`,
      `      app: ${n}`,
      `  strategy:`,
      `    type: RollingUpdate`,
      `    rollingUpdate:`,
      `      maxSurge: 1`,
      `      maxUnavailable: 0`,
      `  template:`,
      `    metadata:`,
      `      labels:`,
      `        app: ${n}`,
      `    spec:`,
      `      containers:`,
      `        - name: ${n}`,
      `          image: ${preset.image || n + ":latest"}`,
      `          ports:`,
      `            - containerPort: ${port}`,
    ];
    if (envSec) p.push(envSec);
    p.push(rsec);
    files[`${f}/${n}-deployment.yaml`] = p.join("\n") + "\n";
  }
  if (preset.generateService)
    files[`${f}/${n}-service.yaml`] =
      `apiVersion: v1\nkind: Service\nmetadata:\n  name: ${n}\n  namespace: ${namespace}\nspec:\n  type: ClusterIP\n  selector:\n    app: ${n}\n  ports:\n    - port: ${port}\n      targetPort: ${port}\n      protocol: TCP\n`;

  return files;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
  namespace: string;
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

  // ── Image tab state ──────────────────────────────────────────────────────
  const [imgImage, setImgImage] = useState("");
  const [imgNamespace, setImgNamespace] = useState(namespace);
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

  // Auto-jump to configure when image tab is selected
  useEffect(() => {
    if (tab === "image" && step === "pick") {
      setStep("configure");
      setTimeout(() => nameRef.current?.focus(), 60);
    }
  }, [tab, step]);
  const preset = FIELD_PRESETS[selPreset];
  const helmPreset = HELM_PRESETS[selHelm];
  const t = getStyle(tab === "helm" ? helmPreset.typeId : preset.typeId);

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
      namespace,
      image: preset.image || `${n}:latest`,
      replicas: preset.replicas,
      port,
      // EnvVar uses { key, value } — matches Rust struct
      env: envVars.map((e) => ({ key: e.key, value: e.value })),
      project_path: projectPath,
    };

    try {
      setResult("Generating files...");
      const genResult = await generateField(fieldConfig);

      if (genResult.error) {
        setResult(`⚠ ${genResult.error}`);
        setCreating(false);
        return;
      }

      if (genResult.warnings.length > 0) {
        console.warn("[generate_field] warnings:", genResult.warnings);
      }

      setResult("Deploying...");
      const fieldDir = `${projectPath}/apps/${n}`;
      const deployResult = await deployResource(
        n,
        "raw",
        fieldDir,
        genResult.namespace,
      );

      setResult(
        deployResult.success
          ? "✓ Created & deployed"
          : `✓ Files saved (${deployResult.stderr.split("\n")[0]})`,
      );

      // Log commands to console for transparency
      console.log("[deploy_resource] commands:", deployResult.commands_run);

      const mainFile =
        genResult.generated_files.find(
          (f) => f.includes("deployment") || f.includes("statefulset"),
        ) ??
        genResult.generated_files[0] ??
        `${fieldDir}/deployment.yaml`;

      addNode({
        id: genId("node"),
        label: n,
        kind: preset.kind,
        image: preset.image || `${n}:latest`,
        type_id: preset.typeId,
        namespace: genResult.namespace,
        file_path: mainFile,
        replicas: preset.replicas,
        source: "raw",
        x: 20 + Math.random() * 40,
        y: 20 + Math.random() * 40,
      });
    } catch (e) {
      setResult(`⚠ ${String(e)}`);
    }

    setCreating(false);
    setTimeout(onClose, 1400);
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
      // Step 1: generate files on disk (fast — just writes YAML files)
      const genResult = await generateInfra(infraConfig);

      if (genResult.error) {
        setResult(`⚠ ${genResult.error}`);
        setCreating(false);
        return;
      }

      // Step 2: write values.yaml with our preset (overrides the Rust-generated one)
      await saveYamlFile(
        `${projectPath}/infra/${n}/helm/values.yaml`,
        helmPreset.defaultValues,
      ).catch(() => {});

      // Step 3: write values.prod.yaml
      await saveYamlFile(
        `${projectPath}/infra/${n}/helm/values.prod.yaml`,
        helmPreset.prodValues,
      ).catch(() => {});

      // Step 4: add node to graph immediately — don't wait for deploy
      const chartPath = `${projectPath}/infra/${n}/helm/Chart.yaml`;
      addNode({
        id: genId("node"),
        label: n,
        kind: "HelmRelease",
        image: `helm:${helmPreset.chartName}/${helmPreset.version}`,
        type_id: helmPreset.typeId,
        namespace: genResult.namespace,
        file_path: chartPath,
        replicas: null,
        source: "helm",
        x: 20 + Math.random() * 40,
        y: 20 + Math.random() * 40,
      });

      setResult("✓ Files saved — deploying in background...");

      // Step 5: deploy fire-and-forget — don't await, close modal immediately
      const infraDir = `${projectPath}/infra/${n}`;
      deployResource(n, "helm", infraDir, genResult.namespace, {
        helmRelease: n,
        helmRepoName: helmPreset.chartName,
        helmRepoUrl: helmPreset.repo,
      })
        .then((deployResult) => {
          console.log(
            "[deploy_resource] done:",
            deployResult.success,
            deployResult.commands_run,
          );
          if (!deployResult.success) {
            console.warn("[deploy_resource] stderr:", deployResult.stderr);
          }
        })
        .catch((e) => {
          console.error("[deploy_resource] failed:", e);
        });
    } catch (e) {
      setResult(`⚠ ${String(e)}`);
      setCreating(false);
      return;
    }

    setCreating(false);
    setTimeout(onClose, 900);
  };

  // ── handleCreateImage ──────────────────────────────────────────────────────
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
        setResult("✓ Deployed");
        addNode({
          id: genId("node"),
          label: n,
          kind: "Deployment",
          image: imgImage.trim(),
          type_id: "service",
          namespace: imgNamespace,
          file_path: "",
          replicas: imgReplicas,
          source: "raw",
          x: 20 + Math.random() * 40,
          y: 20 + Math.random() * 40,
        });
        setTimeout(onClose, 1200);
      } else {
        setResult(`⚠ ${res.error ?? res.stderr.split("\n")[0]}`);
      }
    } catch (e) {
      setResult(`⚠ ${String(e)}`);
    }
    setCreating(false);
  };

  // ── Shared styles ──────────────────────────────────────────────────────────
  const LBL: React.CSSProperties = {
    display: "block",
    color: "rgba(255,255,255,0.3)",
    fontSize: 10,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    marginBottom: 5,
  };
  const INP: React.CSSProperties = {
    width: "100%",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 6,
    color: "white",
    fontSize: 12,
    padding: "7px 10px",
    outline: "none",
    fontFamily: "monospace",
  };

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
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(6,12,22,0.82)",
          backdropFilter: "blur(10px)",
        }}
      />

      <div
        style={{
          position: "relative",
          width: step === "pick" ? 700 : 460,
          maxHeight: "88vh",
          borderRadius: 12,
          background: "rgba(10,16,30,0.99)",
          border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
          display: "flex",
          flexDirection: "column",
          fontFamily: "'JetBrains Mono', monospace",
          overflow: "hidden",
          transition: "width 0.2s cubic-bezier(0.4,0,0.2,1)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "12px 18px",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
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
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 5,
                  color: "rgba(255,255,255,0.45)",
                  fontSize: 11,
                  padding: "2px 8px",
                  cursor: "pointer",
                  fontFamily: "monospace",
                }}
              >
                ‹ back
              </button>
            )}
            <span style={{ color: "white", fontWeight: 700, fontSize: 13 }}>
              {step === "pick"
                ? "Add Field"
                : `Configure · ${tab === "helm" ? selHelm : selPreset}`}
            </span>
            <span
              style={{
                color: "rgba(255,255,255,0.2)",
                fontSize: 10,
                padding: "1px 6px",
                borderRadius: 4,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              ns: {namespace}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.07)",
              border: "none",
              borderRadius: "50%",
              width: 22,
              height: 22,
              color: "rgba(255,255,255,0.45)",
              cursor: "pointer",
              fontSize: 11,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ✕
          </button>
        </div>

        {step === "pick" && (
          <div
            style={{
              display: "flex",
              gap: 6,
              padding: "10px 18px 0",
              flexShrink: 0,
            }}
          >
            {(
              [
                ["raw", "⊞ Raw YAML"],
                ["helm", `⛵ Helm${!hasHelm ? " (install helm)" : ""}`],
                ["image", "🚀 Custom Image"],
              ] as const
            ).map(([tb, label]) => (
              <button
                key={tb}
                onClick={() => setTab(tb as "raw" | "helm" | "image")}
                style={{
                  background:
                    tab === tb
                      ? "rgba(59,130,246,0.15)"
                      : "rgba(255,255,255,0.03)",
                  border: `1px solid ${tab === tb ? "rgba(96,165,250,0.4)" : "rgba(255,255,255,0.07)"}`,
                  borderRadius: 6,
                  color: tab === tb ? "#93c5fd" : "rgba(255,255,255,0.35)",
                  fontSize: 11,
                  padding: "4px 14px",
                  cursor: "pointer",
                  fontFamily: "monospace",
                  fontWeight: tb === tab ? 600 : 400,
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
              padding: "12px 18px 16px",
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
                const tt = getStyle(p.typeId);
                return (
                  <PresetCard key={key} tt={tt} onClick={() => pickPreset(key)}>
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
                        <span style={{ fontSize: 16 }}>{tt.icon}</span>
                        <span
                          style={{
                            color: "white",
                            fontWeight: 600,
                            fontSize: 12,
                          }}
                        >
                          {key}
                        </span>
                      </div>
                      <TypeBadge tt={tt} />
                    </div>
                    <div
                      style={{
                        color: "rgba(255,255,255,0.3)",
                        fontSize: 10,
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
                          color: "rgba(255,255,255,0.18)",
                          fontSize: 9,
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.image || "custom"}
                      </span>
                      <span
                        style={{ color: tt.accent, fontSize: 9, flexShrink: 0 }}
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
              padding: "12px 18px 16px",
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
                const tt = getStyle(p.typeId);
                return (
                  <PresetCard key={key} tt={tt} onClick={() => pickHelm(key)}>
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
                        <span style={{ fontSize: 16 }}>⛵</span>
                        <span
                          style={{
                            color: "white",
                            fontWeight: 600,
                            fontSize: 12,
                          }}
                        >
                          {key}
                        </span>
                      </div>
                      <TypeBadge tt={tt} />
                    </div>
                    <div
                      style={{
                        color: "rgba(255,255,255,0.3)",
                        fontSize: 10,
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
                          color: "rgba(255,255,255,0.18)",
                          fontSize: 9,
                          flex: 1,
                        }}
                      >
                        {p.chartName}
                      </span>
                      <span
                        style={{ color: tt.accent, fontSize: 9, flexShrink: 0 }}
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
              padding: "14px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
              minHeight: 0,
            }}
          >
            <PresetBadge
              t={t}
              sub={`${preset.kind} · ${preset.folder}/ · :${port}`}
            >
              {preset.description}
            </PresetBadge>

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
                  (e.target.style.borderColor = "rgba(96,165,250,0.6)")
                }
                onBlur={(e) =>
                  (e.target.style.borderColor = "rgba(255,255,255,0.1)")
                }
              />
            </div>

            <div>
              <label style={LBL}>
                Port{" "}
                <span
                  style={{
                    color: "rgba(255,255,255,0.15)",
                    textTransform: "none",
                  }}
                >
                  (default: {preset.defaultPort})
                </span>
              </label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                style={{ ...INP, color: t.color }}
                onFocus={(e) => (e.target.style.borderColor = t.border)}
                onBlur={(e) =>
                  (e.target.style.borderColor = "rgba(255,255,255,0.1)")
                }
              />
            </div>

            {envVars.length > 0 && (
              <div>
                <label style={LBL}>Environment</label>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  {envVars.map((env, i) => (
                    <div
                      key={i}
                      style={{ display: "flex", gap: 5, alignItems: "center" }}
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
                          borderRadius: 4,
                          color: "rgba(255,255,255,0.45)",
                          fontSize: 10,
                          padding: "4px 7px",
                          outline: "none",
                          fontFamily: "monospace",
                        }}
                      />
                      <span
                        style={{ color: "rgba(255,255,255,0.2)", fontSize: 11 }}
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
                          borderRadius: 4,
                          color: "white",
                          fontSize: 10,
                          padding: "4px 7px",
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
                          fontSize: 12,
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
                    marginTop: 5,
                    background: "none",
                    border: "1px dashed rgba(255,255,255,0.1)",
                    borderRadius: 4,
                    color: "rgba(255,255,255,0.25)",
                    fontSize: 10,
                    padding: "3px 8px",
                    cursor: "pointer",
                    fontFamily: "monospace",
                  }}
                >
                  + add variable
                </button>
              </div>
            )}

            <FilesPreview files={previewFiles} accent={t.accent} />

            <ActionRow
              onClose={onClose}
              onSubmit={handleCreateRaw}
              creating={creating}
              result={result}
              t={t}
              label="Create & Deploy →"
            />
          </div>
        )}

        {/* ── Configure Helm ── */}
        {step === "configure" && tab === "helm" && (
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "14px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
              minHeight: 0,
            }}
          >
            <div
              style={{
                padding: "8px 12px",
                background: t.bg,
                border: `1px solid ${t.border}`,
                borderRadius: 7,
                boxShadow: `0 0 14px ${t.shadow}`,
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 18 }}>⛵</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: t.color, fontWeight: 600, fontSize: 12 }}>
                  {helmPreset.description}
                </div>
                <div
                  style={{
                    color: "rgba(255,255,255,0.3)",
                    fontSize: 10,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {helmPreset.chartName} v{helmPreset.version} ·{" "}
                  {helmPreset.repo}
                </div>
              </div>
              {!hasHelm && (
                <span
                  style={{
                    color: "#fbbf24",
                    fontSize: 9,
                    padding: "2px 6px",
                    border: "1px solid rgba(251,191,36,0.3)",
                    borderRadius: 4,
                    background: "rgba(251,191,36,0.08)",
                    flexShrink: 0,
                  }}
                >
                  helm not found
                </span>
              )}
            </div>

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
                  (e.target.style.borderColor = "rgba(96,165,250,0.6)")
                }
                onBlur={(e) =>
                  (e.target.style.borderColor = "rgba(255,255,255,0.1)")
                }
              />
            </div>

            <div
              style={{
                padding: "7px 10px",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 6,
              }}
            >
              <div
                style={{
                  color: "rgba(255,255,255,0.22)",
                  fontSize: 9,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 3,
                }}
              >
                Namespace
              </div>
              <div style={{ color: t.color, fontSize: 11 }}>
                {helmPreset.defaultNamespace}
              </div>
            </div>

            <FilesPreview files={previewFiles} accent={t.accent} />

            <ActionRow
              onClose={onClose}
              onSubmit={handleCreateHelm}
              creating={creating}
              result={result}
              t={t}
              label="Generate & Add →"
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

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── ConfigureImage ───────────────────────────────────────────────────────────

const IMG_INP: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  color: "white",
  fontSize: 12,
  padding: "7px 10px",
  outline: "none",
  fontFamily: "monospace",
};
const IMG_LBL: React.CSSProperties = {
  display: "block",
  color: "rgba(255,255,255,0.3)",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  marginBottom: 5,
};

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

function ConfigureImage({
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
}: ConfigureImageProps) {
  const t = NODE_STYLES.service;

  const addPort = () =>
    setImgPorts((p) => [...p, { containerPort: 8080, name: "" }]);
  const removePort = (i: number) =>
    setImgPorts((p) => p.filter((_, j) => j !== i));
  const updatePort = (
    i: number,
    field: "containerPort" | "name",
    v: string | number,
  ) =>
    setImgPorts((p) => p.map((x, j) => (j === i ? { ...x, [field]: v } : x)));

  const addEnv = (secret: boolean) => {
    if (secret) setImgSecretEnv((e) => [...e, { key: "", value: "" }]);
    else setImgEnv((e) => [...e, { key: "", value: "" }]);
  };
  const removeEnv = (i: number, secret: boolean) => {
    if (secret) setImgSecretEnv((e) => e.filter((_, j) => j !== i));
    else setImgEnv((e) => e.filter((_, j) => j !== i));
  };
  const updateEnv = (
    i: number,
    field: "key" | "value",
    v: string,
    secret: boolean,
  ) => {
    if (secret)
      setImgSecretEnv((e) =>
        e.map((x, j) => (j === i ? { ...x, [field]: v } : x)),
      );
    else
      setImgEnv((e) => e.map((x, j) => (j === i ? { ...x, [field]: v } : x)));
  };

  const nameErr = !name.trim();
  const imageErr = !imgImage.trim();

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minHeight: 0,
      }}
    >
      {/* Banner */}
      <div
        style={{
          padding: "8px 12px",
          background: t.bg,
          border: `1px solid ${t.border}`,
          borderRadius: 7,
          boxShadow: `0 0 14px ${t.shadow}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 18 }}>🚀</span>
        <div>
          <div style={{ color: t.color, fontWeight: 600, fontSize: 12 }}>
            Deploy Custom Image
          </div>
          <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}>
            Endfield generates manifests and deploys to cluster. No YAML needed.
          </div>
        </div>
      </div>

      {/* Name + Namespace */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label style={IMG_LBL}>App Name</label>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) =>
              setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
            }
            placeholder="my-app"
            style={{
              ...IMG_INP,
              borderColor: nameErr ? "rgba(239,68,68,0.5)" : undefined,
            }}
            onFocus={(e) =>
              (e.target.style.borderColor = "rgba(96,165,250,0.6)")
            }
            onBlur={(e) =>
              (e.target.style.borderColor = "rgba(255,255,255,0.1)")
            }
          />
        </div>
        <div>
          <label style={IMG_LBL}>Namespace</label>
          <input
            value={imgNamespace}
            onChange={(e) => setImgNamespace(e.target.value)}
            style={IMG_INP}
            onFocus={(e) =>
              (e.target.style.borderColor = "rgba(96,165,250,0.6)")
            }
            onBlur={(e) =>
              (e.target.style.borderColor = "rgba(255,255,255,0.1)")
            }
          />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              marginTop: 4,
              cursor: "pointer",
              color: "rgba(255,255,255,0.25)",
              fontSize: 9,
            }}
          >
            <input
              type="checkbox"
              checked={imgCreateNs}
              onChange={(e) => setImgCreateNs(e.target.checked)}
              style={{ accentColor: "#3b82f6", cursor: "pointer" }}
            />
            create if not exists
          </label>
        </div>
      </div>

      {/* Image + Replicas */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 70px", gap: 8 }}>
        <div>
          <label style={IMG_LBL}>Image</label>
          <input
            value={imgImage}
            onChange={(e) => setImgImage(e.target.value)}
            placeholder="registry.io/repo:tag"
            style={{
              ...IMG_INP,
              borderColor: imageErr ? "rgba(239,68,68,0.5)" : undefined,
            }}
            onFocus={(e) =>
              (e.target.style.borderColor = "rgba(96,165,250,0.6)")
            }
            onBlur={(e) =>
              (e.target.style.borderColor = "rgba(255,255,255,0.1)")
            }
          />
        </div>
        <div>
          <label style={IMG_LBL}>Replicas</label>
          <input
            type="number"
            min={1}
            max={99}
            value={imgReplicas}
            onChange={(e) => setImgReplicas(parseInt(e.target.value) || 1)}
            style={{ ...IMG_INP, textAlign: "center" }}
          />
        </div>
      </div>

      {/* Ports */}
      <div>
        <label style={IMG_LBL}>
          Ports{" "}
          <span
            style={{ textTransform: "none", color: "rgba(255,255,255,0.15)" }}
          >
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
                  updatePort(i, "containerPort", parseInt(e.target.value) || 0)
                }
                style={{ ...IMG_INP, width: 80, textAlign: "center" }}
              />
              <input
                value={p.name}
                onChange={(e) => updatePort(i, "name", e.target.value)}
                placeholder="name (opt)"
                style={{ ...IMG_INP, flex: 1, fontSize: 10 }}
              />
              <button
                onClick={() => removePort(i)}
                style={{
                  background: "none",
                  border: "none",
                  color: "rgba(239,68,68,0.4)",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            gap: 6,
            marginTop: 4,
            alignItems: "center",
          }}
        >
          <button
            onClick={addPort}
            style={{
              background: "none",
              border: "1px dashed rgba(255,255,255,0.1)",
              borderRadius: 4,
              color: "rgba(255,255,255,0.25)",
              fontSize: 10,
              padding: "3px 8px",
              cursor: "pointer",
              fontFamily: "monospace",
            }}
          >
            + port
          </button>
          {imgPorts.length > 0 && (
            <select
              value={imgServiceType}
              onChange={(e) =>
                setImgServiceType(
                  e.target.value as "ClusterIP" | "NodePort" | "LoadBalancer",
                )
              }
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 4,
                color: "rgba(255,255,255,0.5)",
                fontSize: 10,
                padding: "3px 6px",
                fontFamily: "monospace",
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

      {/* Plain ENV */}
      <div>
        <label style={IMG_LBL}>
          Env Variables{" "}
          <span
            style={{ textTransform: "none", color: "rgba(255,255,255,0.15)" }}
          >
            (plain)
          </span>
        </label>
        {imgEnv.map((e, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 5,
              alignItems: "center",
              marginBottom: 4,
            }}
          >
            <input
              value={e.key}
              onChange={(ev) => updateEnv(i, "key", ev.target.value, false)}
              placeholder="KEY"
              style={{
                flex: "0 0 40%",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 4,
                color: "rgba(255,255,255,0.45)",
                fontSize: 10,
                padding: "4px 7px",
                outline: "none",
                fontFamily: "monospace",
              }}
            />
            <input
              value={e.value}
              onChange={(ev) => updateEnv(i, "value", ev.target.value, false)}
              placeholder="value"
              style={{ flex: 1, ...IMG_INP, fontSize: 10, padding: "4px 7px" }}
              onFocus={(ev) => (ev.target.style.borderColor = t.border)}
              onBlur={(ev) =>
                (ev.target.style.borderColor = "rgba(255,255,255,0.1)")
              }
            />
            <button
              onClick={() => removeEnv(i, false)}
              style={{
                background: "none",
                border: "none",
                color: "rgba(239,68,68,0.4)",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          onClick={() => addEnv(false)}
          style={{
            background: "none",
            border: "1px dashed rgba(255,255,255,0.1)",
            borderRadius: 4,
            color: "rgba(255,255,255,0.25)",
            fontSize: 10,
            padding: "3px 8px",
            cursor: "pointer",
            fontFamily: "monospace",
          }}
        >
          + env
        </button>
      </div>

      {/* Secret ENV */}
      <div>
        <label style={IMG_LBL}>
          <span style={{ color: "#f87171" }}>🔒</span> Secret Env{" "}
          <span
            style={{ textTransform: "none", color: "rgba(255,255,255,0.15)" }}
          >
            (stored in K8s Secret)
          </span>
        </label>
        {imgSecretEnv.map((e, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 5,
              alignItems: "center",
              marginBottom: 4,
            }}
          >
            <input
              value={e.key}
              onChange={(ev) => updateEnv(i, "key", ev.target.value, true)}
              placeholder="SECRET_KEY"
              style={{
                flex: "0 0 40%",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 4,
                color: "rgba(255,255,255,0.45)",
                fontSize: 10,
                padding: "4px 7px",
                outline: "none",
                fontFamily: "monospace",
              }}
            />
            <input
              value={e.value}
              type="password"
              onChange={(ev) => updateEnv(i, "value", ev.target.value, true)}
              placeholder="secret value"
              style={{
                flex: 1,
                background: "rgba(239,68,68,0.05)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 4,
                color: "white",
                fontSize: 10,
                padding: "4px 7px",
                outline: "none",
                fontFamily: "monospace",
              }}
            />
            <button
              onClick={() => removeEnv(i, true)}
              style={{
                background: "none",
                border: "none",
                color: "rgba(239,68,68,0.4)",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          onClick={() => addEnv(true)}
          style={{
            background: "none",
            border: "1px dashed rgba(239,68,68,0.2)",
            borderRadius: 4,
            color: "rgba(239,68,68,0.35)",
            fontSize: 10,
            padding: "3px 8px",
            cursor: "pointer",
            fontFamily: "monospace",
          }}
        >
          + secret
        </button>
      </div>

      {/* Pull secret */}
      <div>
        <label style={IMG_LBL}>
          Image Pull Secret{" "}
          <span
            style={{ textTransform: "none", color: "rgba(255,255,255,0.15)" }}
          >
            (private registry)
          </span>
        </label>
        <input
          value={imgPullSecret}
          onChange={(e) => setImgPullSecret(e.target.value)}
          placeholder="my-registry-secret (optional)"
          style={{ ...IMG_INP, color: "rgba(255,255,255,0.4)" }}
          onFocus={(e) => (e.target.style.borderColor = "rgba(96,165,250,0.6)")}
          onBlur={(e) => (e.target.style.borderColor = "rgba(255,255,255,0.1)")}
        />
      </div>

      <ActionRow
        onClose={onClose}
        onSubmit={onSubmit}
        creating={creating}
        result={result}
        t={t}
        label="Deploy →"
      />
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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
        padding: "12px 14px",
        borderRadius: 8,
        border: `1.5px solid ${hov ? tt.border.replace("0.6)", "0.5)").replace("0.55)", "0.45)") : "rgba(255,255,255,0.07)"}`,
        background: hov ? tt.bg : "rgba(255,255,255,0.02)",
        boxShadow: hov ? `0 0 16px ${tt.shadow}` : "none",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 5,
        transition: "all 0.12s",
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
        fontSize: 9,
        color: tt.accent,
        padding: "1px 5px",
        borderRadius: 3,
        background: `${tt.accent}18`,
        border: `1px solid ${tt.accent}33`,
      }}
    >
      {tt.label}
    </span>
  );
}

function PresetBadge({
  t,
  sub,
  children,
}: {
  t: (typeof NODE_STYLES)[string];
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "8px 12px",
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 7,
        boxShadow: `0 0 14px ${t.shadow}`,
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 18 }}>{t.icon}</span>
      <div>
        <div style={{ color: t.color, fontWeight: 600, fontSize: 12 }}>
          {children}
        </div>
        <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}>
          {sub}
        </div>
      </div>
    </div>
  );
}

function FilesPreview({ files, accent }: { files: string[]; accent: string }) {
  return (
    <div>
      <div
        style={{
          display: "block",
          color: "rgba(255,255,255,0.3)",
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: 5,
        }}
      >
        Will create
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {files.map((f) => (
          <div
            key={f}
            style={{ display: "flex", alignItems: "center", gap: 5 }}
          >
            <span style={{ color: accent, fontSize: 9 }}>◦</span>
            <span
              style={{
                color: "rgba(255,255,255,0.28)",
                fontSize: 10,
                fontFamily: "monospace",
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

function ActionRow({
  onClose,
  onSubmit,
  creating,
  result,
  t,
  label,
}: {
  onClose: () => void;
  onSubmit: () => void;
  creating: boolean;
  result: string | null;
  t: (typeof NODE_STYLES)[string];
  label: string;
}) {
  const ok = result?.startsWith("✓");
  const warn = result?.startsWith("⚠");
  return (
    <div style={{ display: "flex", gap: 8, flexShrink: 0, paddingBottom: 2 }}>
      <button
        onClick={onClose}
        style={{
          flex: 1,
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 7,
          color: "rgba(255,255,255,0.4)",
          fontSize: 12,
          padding: "8px 0",
          cursor: "pointer",
          fontFamily: "monospace",
        }}
      >
        Cancel
      </button>
      <button
        onClick={onSubmit}
        disabled={creating || ok || warn}
        style={{
          flex: 2.5,
          background: ok
            ? "rgba(16,185,129,0.25)"
            : warn
              ? "rgba(234,88,12,0.25)"
              : creating
                ? "rgba(37,99,235,0.4)"
                : `linear-gradient(135deg,${t.accent}bb,${t.accent})`,
          border: `1px solid ${t.border}`,
          borderRadius: 7,
          color: ok ? "#6ee7b7" : warn ? "#fdba74" : "white",
          fontSize: 12,
          fontWeight: 600,
          padding: "8px 0",
          cursor: creating ? "not-allowed" : "pointer",
          fontFamily: "monospace",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        {creating && !result && (
          <div
            style={{
              width: 11,
              height: 11,
              borderRadius: "50%",
              border: "1.5px solid rgba(255,255,255,0.3)",
              borderTopColor: "white",
              animation: "spin 0.7s linear infinite",
            }}
          />
        )}
        {result || label}
      </button>
    </div>
  );
}
