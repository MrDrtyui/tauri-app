import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

// ─── Types ────────────────────────────────────────────────────────────────────

interface HelmNodeMeta {
  release_name: string;
  namespace: string;
  chart_name: string;
  chart_version: string;
  repo: string;
  values_path: string;
  rendered_dir: string;
}

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
  source: "raw" | "helm" | "external";
  helm?: HelmNodeMeta;
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

interface HelmRenderResult {
  rendered_files: string[];
  warnings: string[];
  error: string | null;
}

// ─── Raw YAML Presets ─────────────────────────────────────────────────────────

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
      {
        key: "KAFKA_LISTENER_SECURITY_PROTOCOL_MAP",
        value: "INTERNAL:PLAINTEXT,EXTERNAL:PLAINTEXT",
      },
      { key: "KAFKA_INTER_BROKER_LISTENER_NAME", value: "INTERNAL" },
      { key: "KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR", value: "3" },
      { key: "KAFKA_DEFAULT_REPLICATION_FACTOR", value: "3" },
      { key: "KAFKA_MIN_INSYNC_REPLICAS", value: "2" },
      { key: "KAFKA_AUTO_CREATE_TOPICS_ENABLE", value: "true" },
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

// ─── Helm Presets ─────────────────────────────────────────────────────────────

const HELM_PRESETS: Record<string, HelmPreset> = {
  "ingress-nginx": {
    typeId: "gateway",
    description: "Nginx Ingress Controller (official chart)",
    chartName: "ingress-nginx",
    repo: "https://kubernetes.github.io/ingress-nginx",
    version: "4.10.1",
    defaultNamespace: "infra-ingress-nginx",
    defaultValues: `ingress-nginx:
  namespaceOverride: "infra-ingress-nginx"

  controller:
    replicaCount: 1

    resources:
      requests:
        cpu: "100m"
        memory: "128Mi"
      limits:
        cpu: "500m"
        memory: "512Mi"

    service:
      type: LoadBalancer
      annotations: {}

    ingressClassResource:
      name: nginx
      enabled: true
      default: false

    admissionWebhooks:
      enabled: false

  rbac:
    create: true
`,
    prodValues: `# Production overrides — edit this file for prod deployments
ingress-nginx:
  controller:
    replicaCount: 2

    resources:
      requests:
        cpu: "200m"
        memory: "256Mi"
      limits:
        cpu: "1000m"
        memory: "1Gi"

    service:
      annotations:
        service.beta.kubernetes.io/aws-load-balancer-type: "nlb"

    admissionWebhooks:
      enabled: true
`,
  },
  redis: {
    typeId: "cache",
    description: "Redis (Bitnami chart)",
    chartName: "redis",
    repo: "https://charts.bitnami.com/bitnami",
    version: "19.5.5",
    defaultNamespace: "infra-redis",
    defaultValues: `redis:
  namespaceOverride: "infra-redis"

  architecture: standalone

  auth:
    enabled: false

  master:
    persistence:
      enabled: true
      size: 2Gi

    resources:
      requests:
        cpu: "100m"
        memory: "128Mi"
      limits:
        cpu: "500m"
        memory: "512Mi"

  replica:
    replicaCount: 0
`,
    prodValues: `# Production overrides — edit this file for prod deployments
redis:
  architecture: replication

  auth:
    enabled: true
    password: "CHANGE_ME"

  master:
    persistence:
      size: 10Gi
    resources:
      requests:
        cpu: "250m"
        memory: "512Mi"
      limits:
        cpu: "1000m"
        memory: "2Gi"

  replica:
    replicaCount: 2
    persistence:
      size: 10Gi
`,
  },
  "cert-manager": {
    typeId: "infra",
    description: "cert-manager (Jetstack chart)",
    chartName: "cert-manager",
    repo: "https://charts.jetstack.io",
    version: "1.14.5",
    defaultNamespace: "infra-cert-manager",
    defaultValues: `cert-manager:
  namespaceOverride: "infra-cert-manager"

  installCRDs: true

  replicaCount: 1

  resources:
    requests:
      cpu: "50m"
      memory: "64Mi"
    limits:
      cpu: "200m"
      memory: "256Mi"
`,
    prodValues: `# Production overrides — edit this file for prod deployments
cert-manager:
  replicaCount: 2

  resources:
    requests:
      cpu: "100m"
      memory: "128Mi"
    limits:
      cpu: "500m"
      memory: "512Mi"
`,
  },
  prometheus: {
    typeId: "monitoring",
    description: "kube-prometheus-stack (Prometheus + Grafana)",
    chartName: "kube-prometheus-stack",
    repo: "https://prometheus-community.github.io/helm-charts",
    version: "58.2.2",
    defaultNamespace: "infra-monitoring",
    defaultValues: `kube-prometheus-stack:
  namespaceOverride: "infra-monitoring"

  grafana:
    enabled: true
    adminPassword: "admin"
    persistence:
      enabled: true
      size: 5Gi

  prometheus:
    prometheusSpec:
      retention: 15d
      storageSpec:
        volumeClaimTemplate:
          spec:
            accessModes: ["ReadWriteOnce"]
            resources:
              requests:
                storage: 10Gi

  alertmanager:
    enabled: false
`,
    prodValues: `# Production overrides — edit this file for prod deployments
kube-prometheus-stack:
  grafana:
    adminPassword: "CHANGE_ME"
    persistence:
      size: 20Gi

  prometheus:
    prometheusSpec:
      retention: 30d
      storageSpec:
        volumeClaimTemplate:
          spec:
            resources:
              requests:
                storage: 50Gi

  alertmanager:
    enabled: true
`,
  },
  kafka: {
    typeId: "queue",
    description: "Apache Kafka (Bitnami chart)",
    chartName: "kafka",
    repo: "https://charts.bitnami.com/bitnami",
    version: "28.3.0",
    defaultNamespace: "infra-kafka",
    defaultValues: `kafka:
  namespaceOverride: "infra-kafka"

  replicaCount: 1

  persistence:
    enabled: true
    size: 20Gi

  resources:
    requests:
      cpu: "500m"
      memory: "1Gi"
    limits:
      cpu: "2000m"
      memory: "4Gi"

  zookeeper:
    enabled: false

  kraft:
    enabled: true
`,
    prodValues: `# Production overrides — edit this file for prod deployments
kafka:
  replicaCount: 3

  persistence:
    size: 50Gi

  resources:
    requests:
      cpu: "1000m"
      memory: "2Gi"
    limits:
      cpu: "4000m"
      memory: "8Gi"
`,
  },
};

// ─── Helm file generators ─────────────────────────────────────────────────────

function generateHelmConfigs(
  releaseName: string,
  preset: HelmPreset,
): Record<string, string> {
  const files: Record<string, string> = {};
  const ns = preset.defaultNamespace;
  const base = `infra/${releaseName}`;

  files[`${base}/namespace.yaml`] = [
    `apiVersion: v1`,
    `kind: Namespace`,
    `metadata:`,
    `  name: ${ns}`,
    `  labels:`,
    `    managed-by: endfield`,
    `    endfield-component: ${releaseName}`,
    ``,
  ].join("\n");

  files[`${base}/helm/Chart.yaml`] = [
    `apiVersion: v2`,
    `name: ${releaseName}`,
    `description: Endfield-managed wrapper chart for ${releaseName}`,
    `type: application`,
    `version: 0.1.0`,
    `appVersion: ""`,
    ``,
    `dependencies:`,
    `  - name: ${preset.chartName}`,
    `    version: "${preset.version}"`,
    `    repository: "${preset.repo}"`,
    ``,
  ].join("\n");

  files[`${base}/helm/values.yaml`] = preset.defaultValues;
  files[`${base}/helm/values.prod.yaml`] = preset.prodValues;
  files[`${base}/rendered/.gitkeep`] = "";

  return files;
}

// ─── Raw YAML generator ───────────────────────────────────────────────────────

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
    Object.keys(FIELD_PRESETS).find((k) => FIELD_PRESETS[k] === preset) ||
    "custom";

  files[`namespace.yaml`] =
    `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${namespace}\n  labels:\n    managed-by: endfield\n`;

  const secretKeys = ["PASSWORD", "SECRET", "KEY", "TOKEN", "PASS"];
  const sensitiveVars = envVars.filter((e) =>
    secretKeys.some((k) => e.key.toUpperCase().includes(k)),
  );
  const plainVars = envVars.filter(
    (e) => !secretKeys.some((k) => e.key.toUpperCase().includes(k)),
  );

  if (sensitiveVars.length > 0) {
    files[`${f}/${n}-secret.yaml`] =
      `apiVersion: v1\nkind: Secret\nmetadata:\n  name: ${n}-secret\n  namespace: ${namespace}\n  labels:\n    app: ${n}\n    managed-by: endfield\ntype: Opaque\nstringData:\n${sensitiveVars.map((e) => `  ${e.key}: "${e.value}"`).join("\n")}\n`;
  }
  if (preset.generateConfigMap && plainVars.length > 0) {
    files[`${f}/${n}-configmap.yaml`] =
      `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${n}-config\n  namespace: ${namespace}\n  labels:\n    app: ${n}\n    managed-by: endfield\ndata:\n${plainVars.map((e) => `  ${e.key}: "${e.value}"`).join("\n")}\n`;
  }

  const buildEnv = (): string => {
    const all = [...envVars];
    if (presetKey === "postgres" && !all.find((e) => e.key === "PGDATA")) {
      all.push({ key: "PGDATA", value: "/var/lib/postgresql/data/pgdata" });
    }
    if (all.length === 0) return "";
    const lines = ["          env:"];
    for (const e of all) {
      const isSensitive = secretKeys.some((k) =>
        e.key.toUpperCase().includes(k),
      );
      if (isSensitive && sensitiveVars.length > 0) {
        lines.push(
          `          - name: ${e.key}`,
          `            valueFrom:`,
          `              secretKeyRef:`,
          `                name: ${n}-secret`,
          `                key: ${e.key}`,
        );
      } else if (
        preset.generateConfigMap &&
        plainVars.find((v) => v.key === e.key)
      ) {
        lines.push(
          `          - name: ${e.key}`,
          `            valueFrom:`,
          `              configMapKeyRef:`,
          `                name: ${n}-config`,
          `                key: ${e.key}`,
        );
      } else {
        lines.push(
          `          - name: ${e.key}`,
          `            value: "${e.value}"`,
        );
      }
    }
    return lines.join("\n");
  };

  const buildProbes = (): string => {
    if (presetKey === "postgres")
      return [
        `          livenessProbe:`,
        `            exec:`,
        `              command:`,
        `                - bash`,
        `                - -ec`,
        `                - 'PGPASSWORD=$POSTGRES_PASSWORD psql -w -U "$POSTGRES_USER" -d "$POSTGRES_DB" -h 127.0.0.1 -c "SELECT 1"'`,
        `            initialDelaySeconds: 30`,
        `            periodSeconds: 10`,
        `            timeoutSeconds: 5`,
        `            failureThreshold: 6`,
        `          readinessProbe:`,
        `            exec:`,
        `              command:`,
        `                - bash`,
        `                - -ec`,
        `                - 'PGPASSWORD=$POSTGRES_PASSWORD psql -w -U "$POSTGRES_USER" -d "$POSTGRES_DB" -h 127.0.0.1 -c "SELECT 1"'`,
        `            initialDelaySeconds: 5`,
        `            periodSeconds: 10`,
        `            timeoutSeconds: 5`,
        `            failureThreshold: 6`,
      ].join("\n");
    if (presetKey === "mongodb")
      return [
        `          livenessProbe:`,
        `            exec:`,
        `              command:`,
        `                - mongosh`,
        `                - --eval`,
        `                - "db.adminCommand('ping')"`,
        `            initialDelaySeconds: 30`,
        `            periodSeconds: 10`,
        `            timeoutSeconds: 5`,
        `            failureThreshold: 6`,
        `          readinessProbe:`,
        `            exec:`,
        `              command:`,
        `                - mongosh`,
        `                - --eval`,
        `                - "db.adminCommand('ping')"`,
        `            initialDelaySeconds: 5`,
        `            periodSeconds: 10`,
        `            timeoutSeconds: 5`,
        `            failureThreshold: 6`,
      ].join("\n");
    if (presetKey === "redis")
      return [
        `          livenessProbe:`,
        `            exec:`,
        `              command: ["redis-cli", "ping"]`,
        `            initialDelaySeconds: 20`,
        `            periodSeconds: 5`,
        `            timeoutSeconds: 5`,
        `            failureThreshold: 5`,
        `          readinessProbe:`,
        `            exec:`,
        `              command: ["redis-cli", "ping"]`,
        `            initialDelaySeconds: 5`,
        `            periodSeconds: 5`,
        `            timeoutSeconds: 1`,
        `            failureThreshold: 5`,
      ].join("\n");
    if (presetKey === "kafka" || presetKey === "redpanda")
      return [
        `          livenessProbe:`,
        `            tcpSocket:`,
        `              port: ${port}`,
        `            initialDelaySeconds: 60`,
        `            periodSeconds: 15`,
        `            timeoutSeconds: 5`,
        `            failureThreshold: 6`,
        `          readinessProbe:`,
        `            tcpSocket:`,
        `              port: ${port}`,
        `            initialDelaySeconds: 20`,
        `            periodSeconds: 10`,
        `            timeoutSeconds: 5`,
        `            failureThreshold: 6`,
      ].join("\n");
    if (presetKey === "prometheus")
      return [
        `          livenessProbe:`,
        `            httpGet:`,
        `              path: /-/healthy`,
        `              port: ${port}`,
        `            initialDelaySeconds: 30`,
        `            periodSeconds: 15`,
        `            timeoutSeconds: 10`,
        `            failureThreshold: 3`,
        `          readinessProbe:`,
        `            httpGet:`,
        `              path: /-/ready`,
        `              port: ${port}`,
        `            initialDelaySeconds: 5`,
        `            periodSeconds: 5`,
        `            timeoutSeconds: 4`,
        `            failureThreshold: 3`,
      ].join("\n");
    if (presetKey === "grafana")
      return [
        `          livenessProbe:`,
        `            httpGet:`,
        `              path: /api/health`,
        `              port: ${port}`,
        `            initialDelaySeconds: 30`,
        `            periodSeconds: 10`,
        `            timeoutSeconds: 5`,
        `            failureThreshold: 3`,
        `          readinessProbe:`,
        `            httpGet:`,
        `              path: /api/health`,
        `              port: ${port}`,
        `            initialDelaySeconds: 5`,
        `            periodSeconds: 10`,
        `            timeoutSeconds: 5`,
        `            failureThreshold: 3`,
      ].join("\n");
    return [
      `          livenessProbe:`,
      `            httpGet:`,
      `              path: /`,
      `              port: ${port}`,
      `            initialDelaySeconds: 10`,
      `            periodSeconds: 10`,
      `            timeoutSeconds: 5`,
      `            failureThreshold: 3`,
      `          readinessProbe:`,
      `            httpGet:`,
      `              path: /`,
      `              port: ${port}`,
      `            initialDelaySeconds: 5`,
      `            periodSeconds: 5`,
      `            timeoutSeconds: 3`,
      `            failureThreshold: 3`,
    ].join("\n");
  };

  const buildResources = (): string => {
    const m: Record<string, [string, string, string, string]> = {
      postgres: ["250m", "256Mi", "1000m", "1Gi"],
      mongodb: ["250m", "256Mi", "1000m", "1Gi"],
      redis: ["100m", "128Mi", "500m", "512Mi"],
      kafka: ["500m", "1Gi", "2000m", "4Gi"],
      redpanda: ["500m", "1Gi", "2000m", "4Gi"],
      nginx: ["50m", "64Mi", "250m", "256Mi"],
      "ingress-nginx": ["100m", "128Mi", "500m", "512Mi"],
      grafana: ["100m", "128Mi", "500m", "512Mi"],
      prometheus: ["250m", "512Mi", "1000m", "2Gi"],
      custom: ["50m", "64Mi", "500m", "512Mi"],
    };
    const [rc, rm, lc, lm] = m[presetKey] || m.custom;
    return [
      `          resources:`,
      `            requests:`,
      `              cpu: "${rc}"`,
      `              memory: "${rm}"`,
      `            limits:`,
      `              cpu: "${lc}"`,
      `              memory: "${lm}"`,
    ].join("\n");
  };

  const buildVolumeMount = (): string => {
    if (!preset.storageSize) return "";
    if (presetKey === "postgres")
      return [
        `          volumeMounts:`,
        `            - name: data`,
        `              mountPath: /var/lib/postgresql/data`,
        `              subPath: pgdata`,
      ].join("\n");
    if (presetKey === "mongodb")
      return [
        `          volumeMounts:`,
        `            - name: data`,
        `              mountPath: /data/db`,
      ].join("\n");
    return [
      `          volumeMounts:`,
      `            - name: data`,
      `              mountPath: /data`,
    ].join("\n");
  };

  const pvcTemplate = preset.storageSize
    ? [
        `  volumeClaimTemplates:`,
        `    - metadata:`,
        `        name: data`,
        `      spec:`,
        `        accessModes: ["ReadWriteOnce"]`,
        `        resources:`,
        `          requests:`,
        `            storage: ${preset.storageSize}`,
      ].join("\n")
    : "";

  const envSection = buildEnv();
  const probesSection = buildProbes();
  const resourcesSection = buildResources();
  const volumeMount = buildVolumeMount();

  if (preset.kind === "StatefulSet") {
    files[`${f}/${n}-headless-svc.yaml`] = [
      `apiVersion: v1`,
      `kind: Service`,
      `metadata:`,
      `  name: ${n}-headless`,
      `  namespace: ${namespace}`,
      `  labels:`,
      `    app: ${n}`,
      `    managed-by: endfield`,
      `spec:`,
      `  clusterIP: None`,
      `  selector:`,
      `    app: ${n}`,
      `  ports:`,
      `    - name: main`,
      `      port: ${port}`,
      `      targetPort: ${port}`,
      ``,
    ].join("\n");

    const parts = [
      `apiVersion: apps/v1`,
      `kind: StatefulSet`,
      `metadata:`,
      `  name: ${n}`,
      `  namespace: ${namespace}`,
      `  labels:`,
      `    app: ${n}`,
      `    managed-by: endfield`,
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
      `      terminationGracePeriodSeconds: 30`,
      `      securityContext:`,
      `        fsGroup: 999`,
      `      containers:`,
      `        - name: ${n}`,
      `          image: ${preset.image}`,
      `          ports:`,
      `            - containerPort: ${port}`,
      `              name: main`,
    ];
    if (envSection) parts.push(envSection);
    parts.push(probesSection, resourcesSection);
    if (volumeMount) parts.push(volumeMount);
    if (pvcTemplate) parts.push(pvcTemplate);
    parts.push(``);
    files[`${f}/${n}-statefulset.yaml`] = parts.join("\n");
  }

  if (preset.kind === "Deployment") {
    const parts = [
      `apiVersion: apps/v1`,
      `kind: Deployment`,
      `metadata:`,
      `  name: ${n}`,
      `  namespace: ${namespace}`,
      `  labels:`,
      `    app: ${n}`,
      `    managed-by: endfield`,
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
      `          image: ${preset.image}`,
      `          ports:`,
      `            - containerPort: ${port}`,
    ];
    if (envSection) parts.push(envSection);
    parts.push(probesSection, resourcesSection, ``);
    files[`${f}/${n}-deployment.yaml`] = parts.join("\n");
  }

  if (preset.generateService) {
    const svcType =
      presetKey === "ingress-nginx" ? "LoadBalancer" : "ClusterIP";
    files[`${f}/${n}-service.yaml`] = [
      `apiVersion: v1`,
      `kind: Service`,
      `metadata:`,
      `  name: ${n}`,
      `  namespace: ${namespace}`,
      `  labels:`,
      `    app: ${n}`,
      `    managed-by: endfield`,
      `spec:`,
      `  type: ${svcType}`,
      `  selector:`,
      `    app: ${n}`,
      `  ports:`,
      `    - name: main`,
      `      port: ${port}`,
      `      targetPort: ${port}`,
      `      protocol: TCP`,
      ``,
    ].join("\n");
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
      label: "ingress-nginx",
      kind: "HelmRelease",
      image: "helm:ingress-nginx/4.10.1",
      type_id: "gateway",
      typeId: "gateway",
      namespace: "infra-ingress-nginx",
      file_path: "/infra/infra/ingress-nginx/helm/Chart.yaml",
      filePath: "/infra/infra/ingress-nginx/helm/Chart.yaml",
      replicas: null,
      x: 0,
      y: 0,
      source: "helm",
      helm: {
        release_name: "ingress-nginx",
        namespace: "infra-ingress-nginx",
        chart_name: "ingress-nginx",
        chart_version: "4.10.1",
        repo: "https://kubernetes.github.io/ingress-nginx",
        values_path: "/infra/infra/ingress-nginx/helm/values.yaml",
        rendered_dir: "/infra/infra/ingress-nginx/rendered",
      },
    },
    {
      id: "auth-1",
      label: "auth-service",
      kind: "Deployment",
      image: "myapp/auth:v1.2",
      type_id: "service",
      typeId: "service",
      namespace: "myapp",
      file_path: "/infra/apps/auth-deployment.yaml",
      filePath: "/infra/apps/auth-deployment.yaml",
      replicas: 3,
      x: 0,
      y: 0,
      source: "raw",
    },
    {
      id: "redis-2",
      label: "redis",
      kind: "HelmRelease",
      image: "helm:redis/19.5.5",
      type_id: "cache",
      typeId: "cache",
      namespace: "infra-redis",
      file_path: "/infra/infra/redis/helm/Chart.yaml",
      filePath: "/infra/infra/redis/helm/Chart.yaml",
      replicas: null,
      x: 0,
      y: 0,
      source: "helm",
      helm: {
        release_name: "redis",
        namespace: "infra-redis",
        chart_name: "redis",
        chart_version: "19.5.5",
        repo: "https://charts.bitnami.com/bitnami",
        values_path: "/infra/infra/redis/helm/values.yaml",
        rendered_dir: "/infra/infra/redis/rendered",
      },
    },
    {
      id: "kafka-3",
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
      source: "raw",
    },
    {
      id: "postgres-4",
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
      source: "raw",
    },
  ],
};

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
            label: "redis",
            namespace: "infra-redis",
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
    if (cmd === "helm_template")
      return {
        rendered_files: [
          "rendered/00-namespace.yaml",
          "rendered/01-deployment.yaml",
        ],
        warnings: [],
        error: null,
      } as T;
    if (cmd === "helm_install")
      return "✓ helm upgrade --install succeeded (mock)" as T;
    if (cmd === "helm_available") return true as T;
    throw e;
  }
}

// ─── Node types ───────────────────────────────────────────────────────────────

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
  infra: {
    label: "Infra",
    bg: "linear-gradient(135deg, #0d1f0d 0%, #1a3a1a 100%)",
    border: "rgba(74,222,128,0.55)",
    color: "#bbf7d0",
    shadow: "rgba(34,197,94,0.35)",
    accent: "#16a34a",
    icon: "⛵",
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

// ─── Scale factor (zoom) ──────────────────────────────────────────────────────
// Increase this value to make everything bigger (e.g. 1.5, 1.6, 1.8)
const SCALE = 1.5;

// Helper: convert vw-based sizes to scaled px values
// Usage: sz(0.8) → "calc(0.8vw * 1.5)"  — keeps fluid layout but bigger
const vw = (n: number) => `calc(${n}vw * ${SCALE})`;

// ─── Components ───────────────────────────────────────────────────────────────

function TrafficLight({
  status,
  size = 10,
}: {
  status: string;
  size?: number;
}) {
  const s =
    STATUS_COLORS[status as keyof typeof STATUS_COLORS] || STATUS_COLORS.gray;
  const outer = size * SCALE;
  const inner = (size - 2) * SCALE;
  return (
    <div
      style={{
        width: outer + 6,
        height: outer + 6,
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
          width: inner,
          height: inner,
          borderRadius: "50%",
          background: s.inner,
          boxShadow:
            status === "gray"
              ? "none"
              : `0 0 ${inner * 0.8}px ${s.glow}, 0 0 ${inner * 1.5}px ${s.glow}`,
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
    source: node.source || "raw",
    helm: node.helm,
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

function deriveRelatedFiles(mainFilePath: string): string[] {
  if (!mainFilePath) return [];
  const files: string[] = [mainFilePath];
  const dir = mainFilePath.substring(0, mainFilePath.lastIndexOf("/"));
  const filename = mainFilePath.substring(mainFilePath.lastIndexOf("/") + 1);
  const base = filename
    .replace(/-statefulset\.ya?ml$/, "")
    .replace(/-deployment\.ya?ml$/, "")
    .replace(/\.ya?ml$/, "");
  const siblings = [
    `${dir}/${base}-secret.yaml`,
    `${dir}/${base}-configmap.yaml`,
    `${dir}/${base}-service.yaml`,
    `${dir}/${base}-headless-svc.yaml`,
  ];
  for (const s of siblings) {
    if (s !== mainFilePath) files.push(s);
  }
  return files;
}

// ─── ProjectSelector ──────────────────────────────────────────────────────────

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
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: vw(2),
          width: vw(32),
          minWidth: 340 * SCALE,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: vw(0.8) }}>
          <div
            style={{
              width: vw(3),
              height: vw(3),
              minWidth: 36 * SCALE,
              minHeight: 36 * SCALE,
              borderRadius: vw(0.6),
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
              fontSize: vw(1.8),
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
            fontSize: vw(0.85),
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
            padding: `${vw(1.1)} 0`,
            background: loading
              ? "rgba(37,99,235,0.4)"
              : "linear-gradient(135deg, #3b82f6, #2563eb)",
            border: "1px solid rgba(96,165,250,0.3)",
            borderRadius: vw(0.7),
            color: "white",
            fontSize: vw(0.95),
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
            boxShadow: "0 0 24px rgba(59,130,246,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: vw(0.6),
            fontFamily: "monospace",
            transition: "all 0.15s",
          }}
        >
          {loading ? (
            <>
              <div
                style={{
                  width: vw(0.9),
                  height: vw(0.9),
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
              <span style={{ fontSize: vw(1.1) }}>⊞</span>Open config folder
            </>
          )}
        </button>
        <div style={{ width: "100%" }}>
          <div
            style={{
              color: "rgba(255,255,255,0.25)",
              fontSize: vw(0.7),
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom: vw(0.6),
            }}
          >
            Recent
          </div>
          {recentPaths.map((p) => (
            <div
              key={p}
              onClick={() => load(p)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: vw(0.6),
                padding: `${vw(0.55)} ${vw(0.8)}`,
                borderRadius: vw(0.5),
                border: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(255,255,255,0.03)",
                cursor: "pointer",
                marginBottom: vw(0.35),
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
                style={{ fontSize: vw(0.8), color: "rgba(255,255,255,0.3)" }}
              >
                ⊙
              </span>
              <span
                style={{
                  fontSize: vw(0.78),
                  color: "rgba(255,255,255,0.5)",
                  fontFamily: "monospace",
                }}
              >
                {p}
              </span>
            </div>
          ))}
        </div>
        {error && (
          <div
            style={{
              width: "100%",
              padding: `${vw(0.7)} ${vw(0.9)}`,
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: vw(0.5),
              color: "#fca5a5",
              fontSize: vw(0.75),
            }}
          >
            ⚠ {error}
          </div>
        )}
      </div>
    </div>
  );
}

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
        bottom: vw(2),
        right: vw(2),
        zIndex: 2000,
        background: hasErrors ? "rgba(120,40,10,0.9)" : "rgba(10,40,20,0.9)",
        border: `1px solid ${hasErrors ? "rgba(251,146,60,0.4)" : "rgba(52,211,153,0.4)"}`,
        borderRadius: vw(0.7),
        padding: `${vw(0.8)} ${vw(1.2)}`,
        color: hasErrors ? "#fdba74" : "#6ee7b7",
        fontSize: vw(0.8),
        backdropFilter: "blur(16px)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        display: "flex",
        flexDirection: "column",
        gap: vw(0.3),
        animation: "ctxIn 0.2s ease both",
        maxWidth: vw(24),
      }}
    >
      <span style={{ fontWeight: 600 }}>
        {hasErrors ? "⚠" : "✓"} Loaded {result.nodes.length} fields
      </span>
      <span style={{ color: "rgba(255,255,255,0.4)", fontSize: vw(0.7) }}>
        {result.project_path}
      </span>
      {hasErrors && (
        <span style={{ fontSize: vw(0.7) }}>
          {result.errors.length} parse errors
        </span>
      )}
    </div>
  );
}

// ─── AddFieldModal ────────────────────────────────────────────────────────────

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
  const [tab, setTab] = useState<"raw" | "helm">("raw");
  const [step, setStep] = useState<"pick" | "configure">("pick");
  const [selectedPreset, setSelectedPreset] = useState("postgres");
  const [selectedHelmPreset, setSelectedHelmPreset] = useState("ingress-nginx");
  const [name, setName] = useState("");
  const [port, setPort] = useState(5432);
  const [envVars, setEnvVars] = useState<FieldEnvVar[]>([]);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [helmAvailable, setHelmAvailable] = useState(true);
  const nameRef = useRef<HTMLInputElement>(null);

  const preset = FIELD_PRESETS[selectedPreset];
  const helmPreset = HELM_PRESETS[selectedHelmPreset];
  const t = getType(tab === "helm" ? helmPreset.typeId : preset.typeId);

  useEffect(() => {
    safeInvoke<boolean>("helm_available")
      .then(setHelmAvailable)
      .catch(() => setHelmAvailable(false));
  }, []);

  const selectPreset = (key: string) => {
    setSelectedPreset(key);
    const p = FIELD_PRESETS[key];
    setName(key);
    setPort(p.defaultPort);
    setEnvVars(p.envVars.map((e) => ({ ...e })));
    setStep("configure");
    setTimeout(() => nameRef.current?.focus(), 60);
  };

  const selectHelmPreset = (key: string) => {
    setSelectedHelmPreset(key);
    setName(key);
    setStep("configure");
    setTimeout(() => nameRef.current?.focus(), 60);
  };

  const previewFiles =
    tab === "helm"
      ? Object.keys(generateHelmConfigs(name || selectedHelmPreset, helmPreset))
      : Object.keys(
          generateConfigs(
            name || selectedPreset,
            preset,
            projectNamespace,
            port,
            envVars,
          ),
        );

  const handleCreateRaw = async () => {
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
    for (const [rel, content] of Object.entries(files)) {
      try {
        await safeInvoke("save_yaml_file", {
          filePath: `${projectPath}/${rel}`,
          content,
        });
      } catch (e) {
        errors.push(`${rel}: ${e}`);
      }
    }
    if (errors.length > 0) {
      setResult(`⚠ Save failed: ${errors[0]}`);
      setCreating(false);
      return;
    }
    try {
      await safeInvoke("kubectl_apply", {
        path: `${projectPath}/namespace.yaml`,
      });
      for (const rel of Object.keys(files)) {
        if (rel === "namespace.yaml") continue;
        await safeInvoke("kubectl_apply", { path: `${projectPath}/${rel}` });
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
      source: "raw",
    });
    setCreating(false);
    setTimeout(onClose, 1500);
  };

  const handleCreateHelm = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    setResult(null);
    const safeName = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-");
    const files = generateHelmConfigs(safeName, helmPreset);
    setResult("Saving files...");
    const errors: string[] = [];
    for (const [rel, content] of Object.entries(files)) {
      try {
        await safeInvoke("save_yaml_file", {
          filePath: `${projectPath}/${rel}`,
          content,
        });
      } catch (e) {
        errors.push(`${rel}: ${e}`);
      }
    }
    if (errors.length > 0) {
      setResult(`⚠ Save failed: ${errors[0]}`);
      setCreating(false);
      return;
    }
    const componentDir = `${projectPath}/infra/${safeName}`;
    setResult("Running helm template...");
    let renderedCount = 0;
    try {
      const renderResult = await safeInvoke<HelmRenderResult>("helm_template", {
        componentDir,
        releaseName: safeName,
        namespace: helmPreset.defaultNamespace,
      });
      if (renderResult.error) {
        setResult(
          `⚠ Files saved, render failed: ${renderResult.error.slice(0, 80)}`,
        );
        setCreating(false);
        return;
      }
      renderedCount = renderResult.rendered_files.length;
    } catch (e) {
      setResult(`⚠ helm CLI not found — files saved, skipping deploy`);
      setCreating(false);
      return;
    }
    setResult("Deploying to cluster...");
    try {
      await safeInvoke<string>("helm_install", {
        componentDir,
        releaseName: safeName,
        namespace: helmPreset.defaultNamespace,
      });
      setResult(`✓ Deployed · ${renderedCount} manifests`);
    } catch (e) {
      setResult(`⚠ Rendered OK, deploy failed: ${String(e).slice(0, 70)}`);
    }
    const chartPath = `${projectPath}/infra/${safeName}/helm/Chart.yaml`;
    onAdd({
      id: `helm-${safeName}-${Date.now()}`,
      label: safeName,
      kind: "HelmRelease",
      image: `helm:${helmPreset.chartName}/${helmPreset.version}`,
      type_id: helmPreset.typeId,
      typeId: helmPreset.typeId,
      namespace: helmPreset.defaultNamespace,
      file_path: chartPath,
      filePath: chartPath,
      replicas: null,
      x: 30 + Math.random() * 30,
      y: 30 + Math.random() * 30,
      source: "helm",
      helm: {
        release_name: safeName,
        namespace: helmPreset.defaultNamespace,
        chart_name: helmPreset.chartName,
        chart_version: helmPreset.version,
        repo: helmPreset.repo,
        values_path: `${projectPath}/infra/${safeName}/helm/values.yaml`,
        rendered_dir: `${projectPath}/infra/${safeName}/rendered`,
      },
    });
    setCreating(false);
    setTimeout(onClose, 1800);
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
          width: step === "pick" ? vw(54) : vw(36),
          maxHeight: "88vh",
          borderRadius: vw(1.2),
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
            padding: `${vw(0.9)} ${vw(1.3)}`,
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: vw(0.7) }}>
            {step === "configure" && (
              <button
                onClick={() => setStep("pick")}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: vw(0.4),
                  color: "rgba(255,255,255,0.45)",
                  fontSize: vw(0.72),
                  padding: `${vw(0.2)} ${vw(0.6)}`,
                  cursor: "pointer",
                  fontFamily: "monospace",
                }}
              >
                ‹ back
              </button>
            )}
            <span
              style={{ color: "white", fontWeight: 600, fontSize: vw(0.95) }}
            >
              {step === "pick"
                ? "Add Field"
                : `Configure · ${tab === "helm" ? selectedHelmPreset : selectedPreset}`}
            </span>
            <span
              style={{
                color: "rgba(255,255,255,0.2)",
                fontSize: vw(0.65),
                padding: `${vw(0.1)} ${vw(0.5)}`,
                borderRadius: vw(0.3),
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
              width: vw(1.5),
              height: vw(1.5),
              minWidth: 20,
              minHeight: 20,
              color: "rgba(255,255,255,0.45)",
              cursor: "pointer",
              fontSize: vw(0.7),
            }}
          >
            ✕
          </button>
        </div>

        {/* Tab switcher */}
        {step === "pick" && (
          <div
            style={{
              display: "flex",
              gap: vw(0.3),
              padding: `${vw(0.6)} ${vw(1.3)} 0`,
              flexShrink: 0,
            }}
          >
            {(["raw", "helm"] as const).map((tb) => (
              <button
                key={tb}
                onClick={() => setTab(tb)}
                style={{
                  background:
                    tab === tb
                      ? "rgba(59,130,246,0.15)"
                      : "rgba(255,255,255,0.03)",
                  border: `1px solid ${tab === tb ? "rgba(96,165,250,0.4)" : "rgba(255,255,255,0.07)"}`,
                  borderRadius: vw(0.4),
                  color: tab === tb ? "#93c5fd" : "rgba(255,255,255,0.35)",
                  fontSize: vw(0.72),
                  padding: `${vw(0.3)} ${vw(0.9)}`,
                  cursor: "pointer",
                  fontFamily: "monospace",
                  fontWeight: tab === tb ? 600 : 400,
                }}
              >
                {tb === "raw"
                  ? "⊞ Raw YAML"
                  : `⛵ Helm Chart${!helmAvailable ? " (install helm)" : ""}`}
              </button>
            ))}
          </div>
        )}

        {/* Pick step — Raw */}
        {step === "pick" && tab === "raw" && (
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: `${vw(0.8)} ${vw(1.3)} ${vw(1)}`,
              minHeight: 0,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: vw(0.5),
              }}
            >
              {Object.entries(FIELD_PRESETS).map(([key, p]) => {
                const tt = getType(p.typeId);
                return (
                  <div
                    key={key}
                    onClick={() => selectPreset(key)}
                    style={{
                      padding: `${vw(0.85)} ${vw(1)}`,
                      borderRadius: vw(0.6),
                      border: "1.5px solid rgba(255,255,255,0.07)",
                      background: "rgba(255,255,255,0.02)",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: vw(0.35),
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
                          gap: vw(0.4),
                        }}
                      >
                        <span style={{ fontSize: vw(1) }}>{tt.icon}</span>
                        <span
                          style={{
                            color: "white",
                            fontWeight: 600,
                            fontSize: vw(0.82),
                          }}
                        >
                          {key}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: vw(0.58),
                          color: tt.accent,
                          padding: `${vw(0.1)} ${vw(0.4)}`,
                          borderRadius: vw(0.25),
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
                        fontSize: vw(0.63),
                        lineHeight: 1.4,
                      }}
                    >
                      {p.description}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: vw(0.4),
                      }}
                    >
                      <span
                        style={{
                          color: "rgba(255,255,255,0.18)",
                          fontSize: vw(0.58),
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
                          fontSize: vw(0.6),
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

        {/* Pick step — Helm */}
        {step === "pick" && tab === "helm" && (
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: `${vw(0.8)} ${vw(1.3)} ${vw(1)}`,
              minHeight: 0,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: vw(0.5),
              }}
            >
              {Object.entries(HELM_PRESETS).map(([key, p]) => {
                const tt = getType(p.typeId);
                return (
                  <div
                    key={key}
                    onClick={() => selectHelmPreset(key)}
                    style={{
                      padding: `${vw(0.85)} ${vw(1)}`,
                      borderRadius: vw(0.6),
                      border: "1.5px solid rgba(255,255,255,0.07)",
                      background: "rgba(255,255,255,0.02)",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: vw(0.35),
                      transition: "all 0.12s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = tt.bg;
                      e.currentTarget.style.borderColor = tt.border
                        .replace("0.6)", "0.5)")
                        .replace("0.55)", "0.45)");
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
                          gap: vw(0.4),
                        }}
                      >
                        <span style={{ fontSize: vw(1) }}>⛵</span>
                        <span
                          style={{
                            color: "white",
                            fontWeight: 600,
                            fontSize: vw(0.82),
                          }}
                        >
                          {key}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: vw(0.58),
                          color: tt.accent,
                          padding: `${vw(0.1)} ${vw(0.4)}`,
                          borderRadius: vw(0.25),
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
                        fontSize: vw(0.63),
                        lineHeight: 1.4,
                      }}
                    >
                      {p.description}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: vw(0.4),
                      }}
                    >
                      <span
                        style={{
                          color: "rgba(255,255,255,0.18)",
                          fontSize: vw(0.58),
                          fontFamily: "monospace",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flex: 1,
                        }}
                      >
                        {p.chartName}
                      </span>
                      <span
                        style={{
                          color: tt.accent,
                          fontSize: vw(0.6),
                          flexShrink: 0,
                        }}
                      >
                        v{p.version}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Configure step — Raw */}
        {step === "configure" && tab === "raw" && (
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: `${vw(1)} ${vw(1.3)}`,
              display: "flex",
              flexDirection: "column",
              gap: vw(0.85),
              minHeight: 0,
            }}
          >
            <div
              style={{
                padding: `${vw(0.65)} ${vw(0.9)}`,
                background: t.bg,
                border: `1px solid ${t.border}`,
                borderRadius: vw(0.5),
                boxShadow: `0 0 14px ${t.shadow}`,
                display: "flex",
                alignItems: "center",
                gap: vw(0.6),
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: vw(1.1) }}>{t.icon}</span>
              <div>
                <div
                  style={{
                    color: t.color,
                    fontWeight: 600,
                    fontSize: vw(0.82),
                  }}
                >
                  {preset.description}
                </div>
                <div
                  style={{ color: "rgba(255,255,255,0.3)", fontSize: vw(0.62) }}
                >
                  {preset.kind} · {preset.folder}/ · :{port}
                </div>
              </div>
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  color: "rgba(255,255,255,0.3)",
                  fontSize: vw(0.62),
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginBottom: vw(0.3),
                }}
              >
                Name
              </label>
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateRaw();
                  if (e.key === "Escape") onClose();
                }}
                placeholder={selectedPreset}
                style={{
                  width: "100%",
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: vw(0.45),
                  color: "white",
                  fontSize: vw(0.82),
                  padding: `${vw(0.55)} ${vw(0.7)}`,
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
            <div>
              <label
                style={{
                  display: "block",
                  color: "rgba(255,255,255,0.3)",
                  fontSize: vw(0.62),
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginBottom: vw(0.3),
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
                  borderRadius: vw(0.45),
                  color: t.color,
                  fontSize: vw(0.82),
                  padding: `${vw(0.55)} ${vw(0.7)}`,
                  outline: "none",
                  fontFamily: "monospace",
                }}
                onFocus={(e) => (e.target.style.borderColor = t.border)}
                onBlur={(e) =>
                  (e.target.style.borderColor = "rgba(255,255,255,0.1)")
                }
              />
            </div>
            {envVars.length > 0 && (
              <div>
                <label
                  style={{
                    display: "block",
                    color: "rgba(255,255,255,0.3)",
                    fontSize: vw(0.62),
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    marginBottom: vw(0.3),
                  }}
                >
                  Environment
                </label>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: vw(0.28),
                  }}
                >
                  {envVars.map((env, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        gap: vw(0.35),
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
                          borderRadius: vw(0.3),
                          color: "rgba(255,255,255,0.45)",
                          fontSize: vw(0.68),
                          padding: `${vw(0.38)} ${vw(0.55)}`,
                          outline: "none",
                          fontFamily: "monospace",
                        }}
                      />
                      <span
                        style={{
                          color: "rgba(255,255,255,0.18)",
                          fontSize: vw(0.7),
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
                          borderRadius: vw(0.3),
                          color: "white",
                          fontSize: vw(0.68),
                          padding: `${vw(0.38)} ${vw(0.55)}`,
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
                          fontSize: vw(0.72),
                          flexShrink: 0,
                          padding: `0 ${vw(0.2)}`,
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
                    marginTop: vw(0.35),
                    background: "none",
                    border: "1px dashed rgba(255,255,255,0.1)",
                    borderRadius: vw(0.3),
                    color: "rgba(255,255,255,0.25)",
                    fontSize: vw(0.65),
                    padding: `${vw(0.28)} ${vw(0.6)}`,
                    cursor: "pointer",
                    fontFamily: "monospace",
                  }}
                >
                  + add variable
                </button>
              </div>
            )}
            <div>
              <label
                style={{
                  display: "block",
                  color: "rgba(255,255,255,0.3)",
                  fontSize: vw(0.62),
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginBottom: vw(0.3),
                }}
              >
                Will create
              </label>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: vw(0.18),
                }}
              >
                {previewFiles.map((f) => (
                  <div
                    key={f}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: vw(0.35),
                    }}
                  >
                    <span style={{ color: t.accent, fontSize: vw(0.6) }}>
                      ◦
                    </span>
                    <span
                      style={{
                        color: "rgba(255,255,255,0.28)",
                        fontSize: vw(0.63),
                        fontFamily: "monospace",
                      }}
                    >
                      {f}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: vw(0.5),
                flexShrink: 0,
                paddingBottom: vw(0.2),
              }}
            >
              <button
                onClick={onClose}
                style={{
                  flex: 1,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: vw(0.5),
                  color: "rgba(255,255,255,0.4)",
                  fontSize: vw(0.78),
                  padding: `${vw(0.6)} 0`,
                  cursor: "pointer",
                  fontFamily: "monospace",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateRaw}
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
                  borderRadius: vw(0.5),
                  color: result?.startsWith("✓")
                    ? "#6ee7b7"
                    : result
                      ? "#fdba74"
                      : "white",
                  fontSize: vw(0.78),
                  fontWeight: 600,
                  padding: `${vw(0.6)} 0`,
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

        {/* Configure step — Helm */}
        {step === "configure" && tab === "helm" && (
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: `${vw(1)} ${vw(1.3)}`,
              display: "flex",
              flexDirection: "column",
              gap: vw(0.85),
              minHeight: 0,
            }}
          >
            <div
              style={{
                padding: `${vw(0.65)} ${vw(0.9)}`,
                background: t.bg,
                border: `1px solid ${t.border}`,
                borderRadius: vw(0.5),
                boxShadow: `0 0 14px ${t.shadow}`,
                display: "flex",
                alignItems: "center",
                gap: vw(0.6),
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: vw(1.1) }}>⛵</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    color: t.color,
                    fontWeight: 600,
                    fontSize: vw(0.82),
                  }}
                >
                  {helmPreset.description}
                </div>
                <div
                  style={{
                    color: "rgba(255,255,255,0.3)",
                    fontSize: vw(0.62),
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {helmPreset.chartName} v{helmPreset.version} ·{" "}
                  {helmPreset.repo}
                </div>
              </div>
              {!helmAvailable && (
                <span
                  style={{
                    color: "#fbbf24",
                    fontSize: vw(0.6),
                    padding: `${vw(0.15)} ${vw(0.5)}`,
                    border: "1px solid rgba(251,191,36,0.3)",
                    borderRadius: vw(0.25),
                    background: "rgba(251,191,36,0.08)",
                    flexShrink: 0,
                  }}
                >
                  helm not found
                </span>
              )}
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  color: "rgba(255,255,255,0.3)",
                  fontSize: vw(0.62),
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginBottom: vw(0.3),
                }}
              >
                Release name
              </label>
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateHelm();
                  if (e.key === "Escape") onClose();
                }}
                placeholder={selectedHelmPreset}
                style={{
                  width: "100%",
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: vw(0.45),
                  color: "white",
                  fontSize: vw(0.82),
                  padding: `${vw(0.55)} ${vw(0.7)}`,
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
            <div
              style={{
                padding: `${vw(0.5)} ${vw(0.7)}`,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: vw(0.4),
              }}
            >
              <div
                style={{
                  color: "rgba(255,255,255,0.22)",
                  fontSize: vw(0.58),
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: vw(0.18),
                }}
              >
                Namespace
              </div>
              <div
                style={{
                  color: t.color,
                  fontSize: vw(0.72),
                  fontFamily: "monospace",
                }}
              >
                {helmPreset.defaultNamespace}
              </div>
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  color: "rgba(255,255,255,0.3)",
                  fontSize: vw(0.62),
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginBottom: vw(0.3),
                }}
              >
                Will create
              </label>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: vw(0.18),
                }}
              >
                {previewFiles.map((f) => (
                  <div
                    key={f}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: vw(0.35),
                    }}
                  >
                    <span style={{ color: t.accent, fontSize: vw(0.6) }}>
                      ◦
                    </span>
                    <span
                      style={{
                        color: "rgba(255,255,255,0.28)",
                        fontSize: vw(0.63),
                        fontFamily: "monospace",
                      }}
                    >
                      {f}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: vw(0.5),
                flexShrink: 0,
                paddingBottom: vw(0.2),
              }}
            >
              <button
                onClick={onClose}
                style={{
                  flex: 1,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: vw(0.5),
                  color: "rgba(255,255,255,0.4)",
                  fontSize: vw(0.78),
                  padding: `${vw(0.6)} 0`,
                  cursor: "pointer",
                  fontFamily: "monospace",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateHelm}
                disabled={
                  creating || result?.startsWith("✓") || result?.startsWith("⚠")
                }
                style={{
                  flex: 2.5,
                  background: result?.startsWith("✓")
                    ? "rgba(16,185,129,0.25)"
                    : result?.startsWith("⚠")
                      ? "rgba(234,88,12,0.25)"
                      : creating
                        ? "rgba(37,99,235,0.4)"
                        : `linear-gradient(135deg, ${t.accent}bb, ${t.accent})`,
                  border: `1px solid ${t.border}`,
                  borderRadius: vw(0.5),
                  color: result?.startsWith("✓")
                    ? "#6ee7b7"
                    : result?.startsWith("⚠")
                      ? "#fdba74"
                      : "white",
                  fontSize: vw(0.78),
                  fontWeight: 600,
                  padding: `${vw(0.6)} 0`,
                  cursor: creating ? "not-allowed" : "pointer",
                  fontFamily: "monospace",
                  transition: "all 0.15s",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: vw(0.5),
                }}
              >
                {creating &&
                  !result?.startsWith("✓") &&
                  !result?.startsWith("⚠") && (
                    <div
                      style={{
                        width: vw(0.7),
                        height: vw(0.7),
                        borderRadius: "50%",
                        border: "1.5px solid rgba(255,255,255,0.3)",
                        borderTopColor: "white",
                        animation: "spin 0.7s linear infinite",
                        flexShrink: 0,
                      }}
                    />
                  )}
                {result || "Generate & Deploy →"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── NamespaceSwitcher ────────────────────────────────────────────────────────

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
          gap: vw(0.4),
          padding: `${vw(0.25)} ${vw(0.7)}`,
          borderRadius: vw(0.4),
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.04)",
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.2)", fontSize: vw(0.62) }}>
          ns
        </span>
        <span
          style={{
            color: "rgba(255,255,255,0.45)",
            fontSize: vw(0.72),
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
          gap: vw(0.4),
          padding: `${vw(0.25)} ${vw(0.7)}`,
          borderRadius: vw(0.4),
          border: `1px solid ${open ? "rgba(96,165,250,0.4)" : "rgba(255,255,255,0.08)"}`,
          background: open ? "rgba(59,130,246,0.08)" : "rgba(255,255,255,0.04)",
          cursor: "pointer",
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.2)", fontSize: vw(0.62) }}>
          ns
        </span>
        <span
          style={{
            color: "#93c5fd",
            fontSize: vw(0.72),
            fontFamily: "monospace",
          }}
        >
          {active}
        </span>
        <span style={{ color: "rgba(255,255,255,0.2)", fontSize: vw(0.55) }}>
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
              borderRadius: vw(0.55),
              padding: vw(0.3),
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
                  padding: `${vw(0.4)} ${vw(0.7)}`,
                  borderRadius: vw(0.35),
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: vw(0.45),
                  background:
                    ns === active ? "rgba(59,130,246,0.12)" : "transparent",
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
                    fontSize: vw(0.55),
                  }}
                >
                  ●
                </span>
                <span
                  style={{
                    color: ns === active ? "#93c5fd" : "rgba(255,255,255,0.55)",
                    fontSize: vw(0.72),
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

// ─── FieldConfigPanel ─────────────────────────────────────────────────────────

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
  const [rendering, setRendering] = useState(false);
  const [renderResult, setRenderResult] = useState<string | null>(null);

  useEffect(() => {
    if (node?.replicas != null) setReplicaValue(node.replicas);
    setApplyResult(null);
    setRenderResult(null);
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

  const handleRerender = async () => {
    if (!node?.helm) return;
    setRendering(true);
    setRenderResult(null);
    try {
      const componentDir = node.helm.rendered_dir.replace(/\/rendered$/, "");
      const result = await safeInvoke<HelmRenderResult>("helm_template", {
        componentDir,
        releaseName: node.helm.release_name,
        namespace: node.helm.namespace,
      });
      if (result.error) {
        setRenderResult(`✗ ${result.error.slice(0, 60)}`);
      } else {
        setRenderResult(`✓ ${result.rendered_files.length} files rendered`);
      }
    } catch (e) {
      setRenderResult(`✗ ${String(e).slice(0, 60)}`);
    } finally {
      setRendering(false);
      setTimeout(() => setRenderResult(null), 4000);
    }
  };

  const handleHelmInstall = async () => {
    if (!node?.helm) return;
    setApplying(true);
    setApplyResult(null);
    try {
      const componentDir = node.helm.rendered_dir.replace(/\/rendered$/, "");
      await safeInvoke<string>("helm_install", {
        componentDir,
        releaseName: node.helm.release_name,
        namespace: node.helm.namespace,
      });
      setApplyResult(`✓ Installed`);
    } catch (e) {
      setApplyResult(`✗ ${String(e).slice(0, 60)}`);
    } finally {
      setApplying(false);
      setTimeout(() => setApplyResult(null), 4000);
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
          gap: vw(0.5),
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.12)", fontSize: vw(1.5) }}>
          ◇
        </span>
        <span style={{ color: "rgba(255,255,255,0.18)", fontSize: vw(0.72) }}>
          Select a field
        </span>
      </div>
    );

  const t = getType(node.typeId);
  const sc = fieldStatus
    ? STATUS_COLORS[fieldStatus.status as keyof typeof STATUS_COLORS]
    : STATUS_COLORS.gray;
  const isHelm = node.source === "helm";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: vw(0.75),
        flex: 1,
        overflowY: "auto",
        minHeight: 0,
        paddingRight: vw(0.3),
      }}
    >
      {/* Node header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: vw(0.6),
          padding: `${vw(0.6)} ${vw(0.8)}`,
          background: t.bg,
          border: `1px solid ${t.border}`,
          borderRadius: vw(0.5),
          boxShadow: `0 0 12px ${t.shadow}`,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: vw(1) }}>{isHelm ? "⛵" : t.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              color: t.color,
              fontWeight: 600,
              fontSize: vw(0.85),
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {node.label}
          </div>
          <div style={{ color: "rgba(255,255,255,0.3)", fontSize: vw(0.63) }}>
            {isHelm
              ? `HelmRelease · ${node.namespace}`
              : `${node.kind} · ${node.namespace}`}
          </div>
        </div>
        {fieldStatus && <TrafficLight status={fieldStatus.status} size={9} />}
      </div>

      {/* Helm metadata */}
      {isHelm && node.helm && (
        <>
          <div
            style={{
              padding: `${vw(0.5)} ${vw(0.7)}`,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: vw(0.4),
              flexShrink: 0,
            }}
          >
            <div
              style={{
                color: "rgba(255,255,255,0.22)",
                fontSize: vw(0.58),
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: vw(0.25),
              }}
            >
              Chart
            </div>
            <div
              style={{
                color: t.color,
                fontSize: vw(0.72),
                fontFamily: "monospace",
              }}
            >
              {node.helm.chart_name}{" "}
              <span style={{ color: "rgba(255,255,255,0.35)" }}>
                v{node.helm.chart_version}
              </span>
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.22)",
                fontSize: vw(0.6),
                marginTop: vw(0.15),
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {node.helm.repo}
            </div>
          </div>
          <div
            style={{
              padding: `${vw(0.5)} ${vw(0.7)}`,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.05)",
              borderRadius: vw(0.4),
              flexShrink: 0,
            }}
          >
            <div
              style={{
                color: "rgba(255,255,255,0.18)",
                fontSize: vw(0.58),
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: vw(0.18),
              }}
            >
              Rendered dir
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.3)",
                fontSize: vw(0.63),
                fontFamily: "monospace",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {node.helm.rendered_dir.split("/").slice(-4).join("/")}
            </div>
          </div>
          <button
            onClick={handleRerender}
            disabled={rendering}
            style={{
              width: "100%",
              background: rendering
                ? "rgba(22,163,74,0.2)"
                : "linear-gradient(135deg, rgba(22,163,74,0.25), rgba(22,163,74,0.4))",
              border: "1px solid rgba(74,222,128,0.35)",
              borderRadius: vw(0.4),
              color: renderResult?.startsWith("✓")
                ? "#6ee7b7"
                : renderResult?.startsWith("✗")
                  ? "#fca5a5"
                  : "#bbf7d0",
              fontSize: vw(0.78),
              fontWeight: 600,
              padding: `${vw(0.55)} 0`,
              cursor: rendering ? "not-allowed" : "pointer",
              fontFamily: "monospace",
              flexShrink: 0,
              transition: "all 0.15s",
            }}
          >
            {rendering
              ? "Rendering..."
              : renderResult || "↻ Re-render Templates"}
          </button>
          <button
            onClick={handleHelmInstall}
            disabled={applying}
            style={{
              width: "100%",
              background: applying
                ? "rgba(37,99,235,0.4)"
                : "linear-gradient(135deg, #1e3a5f, #1e40af)",
              border: "1px solid rgba(59,130,246,0.4)",
              borderRadius: vw(0.4),
              color: applyResult?.startsWith("✓")
                ? "#6ee7b7"
                : applyResult?.startsWith("✗")
                  ? "#fca5a5"
                  : "#bfdbfe",
              fontSize: vw(0.82),
              padding: `${vw(0.65)} 0`,
              cursor: applying ? "not-allowed" : "pointer",
              fontFamily: "monospace",
              fontWeight: 600,
              transition: "all 0.15s",
              flexShrink: 0,
            }}
          >
            {applying
              ? "Installing..."
              : applyResult || "helm upgrade --install →"}
          </button>
        </>
      )}

      {/* Cluster status for raw nodes */}
      {!isHelm && fieldStatus && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: vw(0.4),
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
                borderRadius: vw(0.4),
                padding: vw(0.5),
                textAlign: "center",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div
                style={{
                  color: "rgba(255,255,255,0.3)",
                  fontSize: vw(0.58),
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: vw(0.2),
                }}
              >
                {label}
              </div>
              <div
                style={{ color: sc.inner, fontSize: vw(1.1), fontWeight: 700 }}
              >
                {value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Replicas for raw nodes */}
      {!isHelm && node.replicas != null && (
        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            borderRadius: vw(0.5),
            padding: vw(0.75),
            border: "1px solid rgba(255,255,255,0.06)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: vw(0.55),
            }}
          >
            <span
              style={{
                color: "rgba(255,255,255,0.4)",
                fontSize: vw(0.68),
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Replicas
            </span>
            <span
              style={{ color: "#60a5fa", fontSize: vw(1), fontWeight: 700 }}
            >
              {replicaValue}
            </span>
          </div>
          <div
            style={{
              position: "relative",
              height: vw(0.35),
              background: "rgba(51,65,85,0.6)",
              borderRadius: 999,
              marginBottom: vw(0.5),
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
                width: vw(1),
                height: vw(1),
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
              style={{ color: "rgba(255,255,255,0.18)", fontSize: vw(0.58) }}
            >
              1
            </span>
            <span
              style={{ color: "rgba(255,255,255,0.18)", fontSize: vw(0.58) }}
            >
              10
            </span>
          </div>
        </div>
      )}

      {/* Image */}
      {!isHelm && node.image && (
        <div
          style={{
            padding: `${vw(0.45)} ${vw(0.7)}`,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: vw(0.4),
            flexShrink: 0,
          }}
        >
          <div
            style={{
              color: "rgba(255,255,255,0.22)",
              fontSize: vw(0.58),
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: vw(0.18),
            }}
          >
            Image
          </div>
          <div
            style={{
              color: "#93c5fd",
              fontSize: vw(0.7),
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

      {/* File path */}
      {(node.filePath || node.file_path) && (
        <div
          style={{
            padding: `${vw(0.45)} ${vw(0.7)}`,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.05)",
            borderRadius: vw(0.4),
            flexShrink: 0,
          }}
        >
          <div
            style={{
              color: "rgba(255,255,255,0.18)",
              fontSize: vw(0.58),
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: vw(0.18),
            }}
          >
            {isHelm ? "Chart.yaml" : "File"}
          </div>
          <div
            style={{
              color: "rgba(255,255,255,0.3)",
              fontSize: vw(0.63),
              fontFamily: "monospace",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {(node.filePath || node.file_path).split("/").slice(-4).join("/")}
          </div>
        </div>
      )}

      {/* Pods */}
      {fieldStatus && fieldStatus.pods.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: vw(0.28),
            flexShrink: 0,
          }}
        >
          <div
            style={{
              color: "rgba(255,255,255,0.22)",
              fontSize: vw(0.58),
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
                gap: vw(0.45),
                padding: `${vw(0.32)} ${vw(0.55)}`,
                background: "rgba(255,255,255,0.03)",
                borderRadius: vw(0.35),
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
                  fontSize: vw(0.63),
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
                style={{ color: "rgba(255,255,255,0.22)", fontSize: vw(0.58) }}
              >
                {pod.ready}/{pod.total}
              </span>
              {pod.restarts > 0 && (
                <span style={{ color: "#f87171", fontSize: vw(0.58) }}>
                  ↺{pod.restarts}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Apply button */}
      {!isHelm && node.replicas != null && (
        <button
          onClick={handleApply}
          disabled={applying}
          style={{
            marginTop: vw(0.4),
            width: "100%",
            background: applying
              ? "rgba(37,99,235,0.4)"
              : "linear-gradient(135deg, #1e3a5f, #1e40af)",
            border: "1px solid rgba(59,130,246,0.4)",
            borderRadius: vw(0.4),
            color: applyResult?.startsWith("✓")
              ? "#6ee7b7"
              : applyResult?.startsWith("✗")
                ? "#fca5a5"
                : "#bfdbfe",
            fontSize: vw(0.82),
            padding: `${vw(0.65)} 0`,
            cursor: applying ? "not-allowed" : "pointer",
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

// ─── DeleteConfirmModal ───────────────────────────────────────────────────────

function DeleteConfirmModal({
  node,
  onClose,
  onConfirm,
}: {
  node: YamlNode;
  onClose: () => void;
  onConfirm: (
    node: YamlNode,
    mode: "full" | "cluster_only" | "ui_only",
  ) => Promise<void>;
}) {
  const [mode, setMode] = useState<"full" | "cluster_only" | "ui_only">("full");
  const [deleting, setDeleting] = useState(false);
  const isHelm = node.source === "helm";
  const t = (() => {
    const types: Record<
      string,
      { border: string; accent: string; bg: string }
    > = {
      database: {
        border: "rgba(59,130,246,0.5)",
        accent: "#2563eb",
        bg: "rgba(10,31,61,0.95)",
      },
      cache: {
        border: "rgba(251,146,60,0.5)",
        accent: "#ea580c",
        bg: "rgba(45,16,0,0.95)",
      },
      queue: {
        border: "rgba(239,68,68,0.5)",
        accent: "#dc2626",
        bg: "rgba(45,0,0,0.95)",
      },
      gateway: {
        border: "rgba(96,165,250,0.5)",
        accent: "#3b82f6",
        bg: "rgba(15,40,71,0.95)",
      },
      monitoring: {
        border: "rgba(167,139,250,0.5)",
        accent: "#7c3aed",
        bg: "rgba(18,0,61,0.95)",
      },
      infra: {
        border: "rgba(74,222,128,0.5)",
        accent: "#16a34a",
        bg: "rgba(10,30,10,0.95)",
      },
    };
    return (
      types[(node as any).typeId || (node as any).type_id || "service"] || {
        border: "rgba(100,116,139,0.4)",
        accent: "#475569",
        bg: "rgba(13,20,36,0.95)",
      }
    );
  })();

  const filePath = (node as any).filePath || node.file_path;
  const relFiles =
    isHelm && node.helm
      ? [
          node.helm.values_path,
          node.helm.values_path.replace("values.yaml", "values.prod.yaml"),
          node.helm.values_path.replace("values.yaml", "Chart.yaml"),
          node.helm.rendered_dir,
        ]
      : deriveRelatedFiles(filePath);

  const modeLabels = {
    full: {
      title: "Delete everything",
      desc: isHelm
        ? "Remove helm/ + rendered/ dirs + helm uninstall from cluster"
        : "Remove YAML files from disk + kubectl delete from cluster",
      icon: "⚠",
      color: "#f87171",
    },
    cluster_only: {
      title: "Cluster only",
      desc: isHelm
        ? "helm uninstall from cluster, keep files on disk"
        : "kubectl delete from cluster, keep YAML files on disk",
      icon: "☁",
      color: "#fbbf24",
    },
    ui_only: {
      title: "UI only",
      desc: "Remove from this view only, don't touch files or cluster",
      icon: "◈",
      color: "#94a3b8",
    },
  };

  const handleConfirm = async () => {
    setDeleting(true);
    try {
      await onConfirm(node, mode);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
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
          background: "rgba(4,8,18,0.8)",
          backdropFilter: "blur(12px)",
        }}
      />
      <div
        style={{
          position: "relative",
          width: vw(32),
          minWidth: 380,
          borderRadius: vw(1),
          background: t.bg,
          border: `1px solid ${t.border}`,
          boxShadow:
            "0 0 40px rgba(239,68,68,0.15), 0 24px 60px rgba(0,0,0,0.7)",
          fontFamily: "monospace",
          animation: "modalIn 0.2s cubic-bezier(0.34,1.45,0.64,1) both",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: `${vw(0.8)} ${vw(1.2)}`,
            borderBottom: "1px solid rgba(239,68,68,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: vw(0.5) }}>
            <span style={{ color: "#f87171", fontSize: vw(1.1) }}>⌫</span>
            <span
              style={{ color: "white", fontWeight: 700, fontSize: vw(0.9) }}
            >
              Delete {isHelm ? "Helm Release" : "Field"}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.3)",
              cursor: "pointer",
              fontSize: vw(0.9),
            }}
          >
            ✕
          </button>
        </div>
        <div
          style={{
            padding: `${vw(1)} ${vw(1.2)}`,
            display: "flex",
            flexDirection: "column",
            gap: vw(0.8),
          }}
        >
          <div
            style={{
              padding: `${vw(0.6)} ${vw(0.9)}`,
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${t.border}`,
              borderRadius: vw(0.5),
              display: "flex",
              alignItems: "center",
              gap: vw(0.6),
            }}
          >
            <div style={{ flex: 1 }}>
              <div
                style={{ color: "white", fontWeight: 600, fontSize: vw(0.88) }}
              >
                {node.label}
              </div>
              <div
                style={{
                  color: "rgba(255,255,255,0.3)",
                  fontSize: vw(0.65),
                  marginTop: vw(0.1),
                }}
              >
                {isHelm
                  ? `HelmRelease · ns: ${node.namespace}`
                  : `${node.kind} · ns: ${node.namespace}`}
              </div>
            </div>
            <span
              style={{
                color: t.accent,
                fontSize: vw(0.65),
                padding: `${vw(0.15)} ${vw(0.5)}`,
                border: `1px solid ${t.accent}44`,
                borderRadius: vw(0.25),
                background: `${t.accent}18`,
              }}
            >
              {(node as any).typeId || node.type_id}
            </span>
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: vw(0.35) }}
          >
            {(["full", "cluster_only", "ui_only"] as const).map((m) => {
              const ml = modeLabels[m];
              const active = mode === m;
              return (
                <div
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    padding: `${vw(0.55)} ${vw(0.8)}`,
                    borderRadius: vw(0.5),
                    border: `1px solid ${active ? ml.color + "66" : "rgba(255,255,255,0.07)"}`,
                    background: active
                      ? `${ml.color}12`
                      : "rgba(255,255,255,0.02)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: vw(0.6),
                    transition: "all 0.1s",
                  }}
                >
                  <span
                    style={{
                      color: active ? ml.color : "rgba(255,255,255,0.25)",
                      fontSize: vw(0.9),
                      width: vw(1.1),
                      textAlign: "center",
                    }}
                  >
                    {active ? "◉" : "○"}
                  </span>
                  <div>
                    <div
                      style={{
                        color: active ? ml.color : "rgba(255,255,255,0.7)",
                        fontSize: vw(0.78),
                        fontWeight: active ? 600 : 400,
                      }}
                    >
                      {ml.icon} {ml.title}
                    </div>
                    <div
                      style={{
                        color: "rgba(255,255,255,0.25)",
                        fontSize: vw(0.63),
                        marginTop: vw(0.1),
                      }}
                    >
                      {ml.desc}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {mode === "full" && (
            <div
              style={{
                padding: `${vw(0.5)} ${vw(0.7)}`,
                background: "rgba(239,68,68,0.06)",
                border: "1px solid rgba(239,68,68,0.15)",
                borderRadius: vw(0.4),
              }}
            >
              <div
                style={{
                  color: "rgba(239,68,68,0.6)",
                  fontSize: vw(0.6),
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginBottom: vw(0.3),
                }}
              >
                Will delete from disk
              </div>
              {relFiles.map((f) => (
                <div
                  key={f}
                  style={{
                    color: "rgba(255,255,255,0.35)",
                    fontSize: vw(0.63),
                    fontFamily: "monospace",
                    lineHeight: 1.7,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  ✕ {f.split("/").slice(-4).join("/")}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: vw(0.5), marginTop: vw(0.2) }}>
            <button
              onClick={onClose}
              style={{
                flex: 1,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: vw(0.45),
                color: "rgba(255,255,255,0.4)",
                fontSize: vw(0.78),
                padding: `${vw(0.6)} 0`,
                cursor: "pointer",
                fontFamily: "monospace",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={deleting}
              style={{
                flex: 2,
                background: deleting
                  ? "rgba(239,68,68,0.2)"
                  : "linear-gradient(135deg, rgba(220,38,38,0.7), rgba(185,28,28,0.9))",
                border: "1px solid rgba(239,68,68,0.5)",
                borderRadius: vw(0.45),
                color: "#fca5a5",
                fontSize: vw(0.78),
                fontWeight: 700,
                padding: `${vw(0.6)} 0`,
                cursor: deleting ? "not-allowed" : "pointer",
                fontFamily: "monospace",
                transition: "all 0.15s",
                boxShadow: "0 0 16px rgba(239,68,68,0.2)",
              }}
            >
              {deleting ? "Deleting..." : "Confirm Delete"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ContextMenu ──────────────────────────────────────────────────────────────

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
  const isHelm = menu.kind === "HelmRelease";
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
      label: isHelm ? "Open Chart.yaml" : "Open YAML",
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
          minWidth: vw(13),
          borderRadius: vw(0.9),
          padding: vw(0.4),
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
            padding: `${vw(0.4)} ${vw(0.8)} ${vw(0.5)}`,
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            marginBottom: vw(0.3),
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
                borderRadius: vw(0.35),
                color: "white",
                fontSize: vw(0.78),
                padding: `${vw(0.25)} ${vw(0.5)}`,
                outline: "none",
              }}
            />
          ) : (
            <div>
              <div
                style={{
                  color: "rgba(255,255,255,0.55)",
                  fontSize: vw(0.75),
                  fontWeight: 600,
                }}
              >
                {menu.label}
              </div>
              {menu.kind && (
                <div
                  style={{
                    color: "rgba(255,255,255,0.25)",
                    fontSize: vw(0.65),
                    marginTop: vw(0.1),
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
                  margin: `${vw(0.3)} ${vw(0.4)}`,
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
                gap: vw(0.6),
                padding: `${vw(0.45)} ${vw(0.8)}`,
                borderRadius: vw(0.55),
                cursor: "pointer",
                background:
                  hovered === item.id
                    ? item.id === "delete"
                      ? "rgba(239,68,68,0.18)"
                      : "rgba(255,255,255,0.09)"
                    : "transparent",
              }}
            >
              <span
                style={{
                  fontSize: vw(0.95),
                  color:
                    hovered === item.id ? item.color! : "rgba(255,255,255,0.4)",
                  width: vw(1.1),
                  textAlign: "center",
                }}
              >
                {item.icon}
              </span>
              <span
                style={{
                  fontSize: vw(0.8),
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

// ─── YamlModal ────────────────────────────────────────────────────────────────

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
          width: vw(42),
          maxHeight: "75vh",
          borderRadius: vw(1),
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
            padding: `${vw(0.8)} ${vw(1.2)}`,
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div>
            <span
              style={{ color: "white", fontWeight: 600, fontSize: vw(0.9) }}
            >
              {node.label}
            </span>
            <span
              style={{
                color: "rgba(255,255,255,0.3)",
                fontSize: vw(0.72),
                marginLeft: vw(0.6),
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
              width: vw(1.5),
              height: vw(1.5),
              minWidth: 20,
              minHeight: 20,
              color: "rgba(255,255,255,0.5)",
              cursor: "pointer",
              fontSize: vw(0.75),
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
            padding: `${vw(1)} ${vw(1.2)}`,
            color: "#93c5fd",
            fontSize: vw(0.75),
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

// ─── DraggableNode ────────────────────────────────────────────────────────────

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
  const isHelm = node.source === "helm";
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
          border: `1px solid ${isSelected ? t.border.replace("0.6)", "1)").replace("0.55)", "1)") : t.border}`,
          borderRadius: vw(0.4),
          padding: `${vw(0.6)} ${vw(1)}`,
          color: t.color,
          fontSize: vw(0.82),
          fontWeight: 600,
          boxShadow: isDragging
            ? `0 0 24px ${t.shadow}, 0 8px 24px rgba(0,0,0,0.4)`
            : isSelected
              ? `0 0 20px ${t.shadow}, 0 0 0 1.5px ${t.accent}`
              : `0 0 12px ${t.shadow}`,
          whiteSpace: "nowrap",
          display: "flex",
          alignItems: "center",
          gap: vw(0.5),
          transform: isDragging ? "scale(1.05)" : "scale(1)",
          transition: isDragging ? "transform 0.05s" : "transform 0.12s",
        }}
      >
        <TrafficLight status={status} size={8} />
        <span style={{ fontSize: vw(0.85), opacity: 0.8 }}>
          {isHelm ? "⛵" : t.icon}
        </span>
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.05vw" }}
        >
          <span>{node.label}</span>
          <span style={{ fontSize: vw(0.6), opacity: 0.45, fontWeight: 400 }}>
            {isHelm && node.helm
              ? `helm · v${node.helm.chart_version}`
              : `${node.kind}${node.replicas ? ` ×${fieldStatus ? fieldStatus.ready : node.replicas}` : ""}`}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

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
  const [deleteConfirm, setDeleteConfirm] = useState<{ node: YamlNode } | null>(
    null,
  );
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
    (n) => !activeNamespace || n.namespace === activeNamespace,
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
    const found = Array.from(
      new Set(result.nodes.map((n) => n.namespace).filter(Boolean)),
    );
    const projectName = result.project_path.split("/").pop() || "default";
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
    setNodes((prev) =>
      prev.map((n) =>
        n.id === id
          ? {
              ...n,
              x: Math.max(
                0,
                Math.min(
                  ((e.clientX - rect.left) / rect.width) * 100 - offsetXpct,
                  88,
                ),
              ),
              y: Math.max(
                0,
                Math.min(
                  ((e.clientY - rect.top) / rect.height) * 100 - offsetYpct,
                  90,
                ),
              ),
            }
          : n,
      ),
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
    (id: string) => {
      const node = nodes.find((n) => n.id === id);
      if (node) setDeleteConfirm({ node });
    },
    [nodes],
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

  const allNsDisplay =
    allNamespaces.length > 0 ? allNamespaces : [activeNamespace];

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        background: "#0a1628",
        display: "flex",
        flexDirection: "column",
        gap: vw(0.5),
        padding: vw(0.8),
        fontFamily: "monospace",
        boxSizing: "border-box",
        overflow: "hidden",
        // ── SCALE: all vw units are multiplied by SCALE above ──
        // If you want to adjust global size, change the SCALE constant near top of file
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Topbar */}
      <div
        style={{
          position: "relative",
          borderRadius: vw(0.5),
          padding: `${vw(0.5)} ${vw(1)}`,
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
            borderRadius: vw(0.5),
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
            gap: vw(1),
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: vw(0.6),
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: vw(2.2),
                height: vw(2.2),
                borderRadius: vw(0.4),
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
                fontSize: vw(1.4),
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
              gap: vw(0.4),
              fontSize: vw(0.85),
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
            <span style={{ color: "#475569", padding: `0 ${vw(0.2)}` }}>/</span>
            <span
              style={{
                color: "#cbd5e1",
                padding: `${vw(0.2)} ${vw(0.6)}`,
                borderRadius: vw(0.3),
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
              gap: vw(0.8),
              flexShrink: 0,
            }}
          >
            <NamespaceSwitcher
              namespaces={allNsDisplay}
              active={activeNamespace}
              onChange={setActiveNamespace}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: vw(0.4),
                padding: `${vw(0.25)} ${vw(0.7)}`,
                borderRadius: vw(0.4),
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.04)",
              }}
            >
              <TrafficLight status={overallStatus} size={7} />
              <span
                style={{ color: "rgba(255,255,255,0.4)", fontSize: vw(0.7) }}
              >
                {clusterStatus?.kubectl_available === false
                  ? "kubectl unavailable"
                  : `${clusterStatus?.fields.filter((f) => f.status === "green").length || 0}/${clusterStatus?.fields.length || 0} healthy`}
              </span>
            </div>
            <span
              style={{ fontSize: vw(0.72), color: "rgba(255,255,255,0.2)" }}
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
                fontSize: vw(1),
              }}
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "3fr 1fr",
          gridTemplateRows: "1fr 2fr",
          gap: vw(0.5),
          minHeight: 0,
        }}
      >
        {/* Canvas */}
        <div
          style={{
            gridColumn: "1",
            gridRow: "1 / 3",
            borderRadius: vw(0.5),
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
              padding: `${vw(0.8)} ${vw(1.5)}`,
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                color: "white",
                fontWeight: 600,
                fontSize: vw(0.95),
                letterSpacing: "0.05em",
              }}
            >
              Microservice Dashboard
            </span>
            <div
              style={{
                display: "flex",
                gap: vw(0.8),
                alignItems: "center",
                fontSize: vw(0.72),
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
                  borderRadius: vw(0.4),
                  padding: `${vw(0.5)} ${vw(1.5)}`,
                  color: "#64748b",
                  fontSize: vw(0.75),
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  background: "rgba(0,0,0,0.2)",
                  display: "flex",
                  alignItems: "center",
                  gap: vw(0.4),
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
                <span style={{ fontSize: vw(0.9) }}>⊕</span> New Field +
              </div>
            </div>
          </div>
        </div>

        {/* Config panel */}
        <div
          style={{
            gridColumn: "2",
            gridRow: "1",
            borderRadius: vw(0.5),
            border: "1px solid rgba(255,255,255,0.1)",
            background: "#0d1b2e",
            padding: `${vw(1)} ${vw(1.2)}`,
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
              marginBottom: vw(0.8),
              flexShrink: 0,
            }}
          >
            <span
              style={{
                color: "white",
                fontWeight: 600,
                fontSize: vw(0.9),
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
                  fontSize: vw(0.8),
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

        {/* AI Assistant */}
        <div
          style={{
            gridColumn: "2",
            gridRow: "2",
            borderRadius: vw(0.5),
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
              padding: `${vw(0.8)} ${vw(1.2)}`,
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                color: "white",
                fontWeight: 600,
                fontSize: vw(1),
                letterSpacing: "0.05em",
              }}
            >
              AI Assistant
            </span>
            <div style={{ display: "flex", gap: vw(0.3) }}>
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: vw(0.4),
                    height: vw(0.4),
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
              padding: `${vw(0.8)} ${vw(1)}`,
              display: "flex",
              flexDirection: "column",
              gap: vw(0.7),
              overflowY: "auto",
              minHeight: 0,
            }}
          >
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <div
                style={{
                  background: "rgba(37,99,235,0.2)",
                  border: "1px solid rgba(59,130,246,0.3)",
                  borderRadius: vw(0.5),
                  borderTopRightRadius: vw(0.1),
                  padding: `${vw(0.5)} ${vw(0.8)}`,
                  color: "#bfdbfe",
                  fontSize: vw(0.8),
                  maxWidth: "85%",
                }}
              >
                Deploy ingress-nginx via Helm
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: vw(0.5),
                alignItems: "flex-start",
              }}
            >
              <div
                style={{
                  width: vw(1.6),
                  height: vw(1.6),
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #475569, #1e293b)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  fontSize: vw(0.7),
                  color: "#94a3b8",
                }}
              >
                ✦
              </div>
              <div
                style={{
                  background: "rgba(30,41,59,0.6)",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: vw(0.5),
                  borderTopLeftRadius: vw(0.1),
                  padding: `${vw(0.5)} ${vw(0.8)}`,
                  color: "#e2e8f0",
                  fontSize: vw(0.8),
                  maxWidth: "85%",
                }}
              >
                Generated Chart.yaml wrapper for ingress-nginx v4.10.1,
                values.yaml with dev defaults, values.prod.yaml, and rendered 6
                manifests into rendered/
              </div>
            </div>
          </div>
          <div
            style={{
              padding: `${vw(0.7)} ${vw(1)}`,
              borderTop: "1px solid rgba(255,255,255,0.05)",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", gap: vw(0.5) }}>
              <input
                style={{
                  flex: 1,
                  background: "rgba(30,41,59,0.6)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: vw(0.4),
                  padding: `${vw(0.5)} ${vw(0.7)}`,
                  color: "#e2e8f0",
                  fontSize: vw(0.8),
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
                  borderRadius: vw(0.4),
                  color: "white",
                  fontSize: vw(0.8),
                  padding: `0 ${vw(1)}`,
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

      {/* Overlays */}
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
      {deleteConfirm && (
        <DeleteConfirmModal
          node={deleteConfirm.node}
          onClose={() => setDeleteConfirm(null)}
          onConfirm={async (node, mode) => {
            setDeleteConfirm(null);
            const isHelm = node.source === "helm";
            if (mode === "full") {
              if (isHelm && node.helm) {
                await safeInvoke("delete_field_files", {
                  filePaths: [
                    node.helm.values_path,
                    node.helm.values_path.replace(
                      "values.yaml",
                      "values.prod.yaml",
                    ),
                    node.helm.values_path.replace("values.yaml", "Chart.yaml"),
                  ],
                  namespace: node.namespace,
                });
                await safeInvoke("helm_uninstall", {
                  releaseName: node.helm.release_name,
                  namespace: node.helm.namespace,
                }).catch(() => {});
              } else {
                const filePath = node.filePath || node.file_path;
                await safeInvoke("delete_field_files", {
                  filePaths: deriveRelatedFiles(filePath),
                  namespace: node.namespace,
                });
              }
            } else if (mode === "cluster_only") {
              if (isHelm && node.helm) {
                await safeInvoke("helm_uninstall", {
                  releaseName: node.helm.release_name,
                  namespace: node.helm.namespace,
                }).catch(() => {});
              } else {
                await safeInvoke("kubectl_delete_by_label", {
                  label: node.label,
                  namespace: node.namespace,
                });
              }
            }
            setNodes((prev) => prev.filter((n) => n.id !== node.id));
            if (selectedNode?.id === node.id) setSelectedNode(null);
            setTimeout(fetchClusterStatus, 1000);
          }}
        />
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
