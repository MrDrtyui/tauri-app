/**
 * postgresStore.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Types, YAML generators, Helm config, and connection-inference logic for the
 * PostgreSQL first-class infrastructure field.
 *
 * Two deployment modes are supported:
 *   A) Raw Kubernetes manifests (Secret + StatefulSet + Service + PVC)
 *   B) Helm chart (Bitnami postgresql) with rendered values.yaml
 *
 * Connection inference scans Deployment env vars and links Service → Postgres
 * nodes automatically in the graph.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Full configuration for a PostgreSQL field */
export interface PostgresConfig {
  /** Unique field identifier — used in labels and file paths */
  fieldId: string;
  /** Human-readable resource name, e.g. "my-postgres" */
  name: string;
  namespace: string;
  /** e.g. "16-alpine" for raw mode */
  postgresVersion: string;
  databaseName: string;
  username: string;
  /** Stored in a K8s Secret — never plain text in manifest YAML */
  password: string;
  port: number;
  /** e.g. "10Gi" */
  storageSize: string;
  /** optional — leave empty to use the cluster default */
  storageClass: string;
  /** "raw" or "helm" */
  deployMode: "raw" | "helm";
  /** Bitnami chart version, only for helm mode */
  chartVersion: string;
  enableMetrics: boolean;
}

/** A resolved connection from a Service to this Postgres field */
export interface PostgresConnection {
  /** Node ID of the service/deployment */
  serviceNodeId: string;
  /** How the connection was inferred */
  reason:
    | "DATABASE_URL"
    | "PGHOST"
    | "SECRET_REF"
    | "DATABASE_URL+PGHOST"
    | "PGHOST+PGPASSWORD";
  /** The env var names that triggered the link */
  envVars: string[];
}

// ─── Label helpers ────────────────────────────────────────────────────────────

/** Standard Endfield labels applied to every resource owned by a Postgres field */
export function postgresLabels(
  fieldId: string,
  role: "secret" | "configmap" | "statefulset" | "service" | "pvc",
  indent = "    ",
): string {
  return [
    `${indent}app.kubernetes.io/managed-by: endfield`,
    `${indent}endfield.io/component: postgres`,
    `${indent}endfield.io/fieldId: ${fieldId}`,
    `${indent}endfield.io/resourceRole: ${role}`,
  ].join("\n");
}

/** The K8s Service name that other pods use to reach this Postgres instance */
export function postgresServiceName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

/** Full in-cluster DNS for cross-namespace connections */
export function postgresServiceDns(name: string, namespace: string): string {
  return `${postgresServiceName(name)}.${namespace}.svc.cluster.local`;
}

/** The Secret name holding DB credentials */
export function postgresSecretName(name: string): string {
  return `${postgresServiceName(name)}-credentials`;
}

// ─── Raw YAML generators ──────────────────────────────────────────────────────

/**
 * Generate the K8s Secret manifest for PostgreSQL credentials.
 * Values are base64-encoded (in a real implementation the Rust backend would
 * do the actual base64 encoding; here we delegate that to the generator and
 * use string placeholders consistent with what `generateField` produces).
 */
export function generatePostgresSecret(cfg: PostgresConfig): string {
  const svcName = postgresServiceName(cfg.name);
  return `apiVersion: v1
kind: Secret
metadata:
  name: ${postgresSecretName(cfg.name)}
  namespace: ${cfg.namespace}
  labels:
${postgresLabels(cfg.fieldId, "secret")}
type: Opaque
stringData:
  POSTGRES_DB: "${cfg.databaseName}"
  POSTGRES_USER: "${cfg.username}"
  POSTGRES_PASSWORD: "${cfg.password}"
  DATABASE_URL: "postgresql://${cfg.username}:${cfg.password}@${svcName}.${cfg.namespace}.svc.cluster.local:${cfg.port}/${cfg.databaseName}?sslmode=disable"
`;
}

/**
 * Generate the StatefulSet manifest.
 * Credentials are injected via envFrom → secretRef so no passwords appear in
 * the StatefulSet spec itself.
 */
export function generatePostgresStatefulSet(cfg: PostgresConfig): string {
  const svcName = postgresServiceName(cfg.name);
  const secretName = postgresSecretName(cfg.name);
  const storageClassLine = cfg.storageClass
    ? `\n      storageClassName: "${cfg.storageClass}"`
    : "";

  return `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ${svcName}
  namespace: ${cfg.namespace}
  labels:
${postgresLabels(cfg.fieldId, "statefulset")}
spec:
  serviceName: ${svcName}
  replicas: 1
  selector:
    matchLabels:
      app: ${svcName}
      endfield.io/fieldId: ${cfg.fieldId}
  template:
    metadata:
      labels:
        app: ${svcName}
        endfield.io/fieldId: ${cfg.fieldId}
        endfield.io/component: postgres
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: postgres
          image: postgres:${cfg.postgresVersion}
          ports:
            - name: postgresql
              containerPort: ${cfg.port}
              protocol: TCP
          envFrom:
            - secretRef:
                name: ${secretName}
          livenessProbe:
            exec:
              command: ["sh", "-c", "pg_isready -U $POSTGRES_USER -d $POSTGRES_DB"]
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 6
          readinessProbe:
            exec:
              command: ["sh", "-c", "pg_isready -U $POSTGRES_USER -d $POSTGRES_DB"]
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3
          resources:
            requests:
              cpu: "100m"
              memory: "256Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
              subPath: pgdata
  volumeClaimTemplates:
    - metadata:
        name: data
        labels:
${postgresLabels(cfg.fieldId, "pvc", "          ")}
      spec:
        accessModes: ["ReadWriteOnce"]${storageClassLine}
        resources:
          requests:
            storage: ${cfg.storageSize}
`;
}

/** Generate the ClusterIP Service manifest */
export function generatePostgresService(cfg: PostgresConfig): string {
  const svcName = postgresServiceName(cfg.name);
  return `apiVersion: v1
kind: Service
metadata:
  name: ${svcName}
  namespace: ${cfg.namespace}
  labels:
${postgresLabels(cfg.fieldId, "service")}
spec:
  type: ClusterIP
  selector:
    app: ${svcName}
    endfield.io/fieldId: ${cfg.fieldId}
  ports:
    - name: postgresql
      port: ${cfg.port}
      targetPort: postgresql
      protocol: TCP
`;
}

/** Generate the Namespace manifest */
export function generatePostgresNamespace(cfg: PostgresConfig): string {
  return `apiVersion: v1
kind: Namespace
metadata:
  name: ${cfg.namespace}
  labels:
    managed-by: endfield
`;
}

/**
 * Return a map of relative-path → YAML content for all raw mode manifests.
 * The caller (AddFieldModal / tauriStore) saves each file via saveYamlFile.
 */
export function generatePostgresRawManifests(
  cfg: PostgresConfig,
): Record<string, string> {
  const n = postgresServiceName(cfg.name);
  const base = `databases/${n}`;
  return {
    "namespace.yaml": generatePostgresNamespace(cfg),
    [`${base}/${n}-secret.yaml`]: generatePostgresSecret(cfg),
    [`${base}/${n}-statefulset.yaml`]: generatePostgresStatefulSet(cfg),
    [`${base}/${n}-service.yaml`]: generatePostgresService(cfg),
  };
}

// ─── Helm generators ──────────────────────────────────────────────────────────

/** Bitnami postgresql chart defaults */
export const POSTGRES_HELM_PRESET = {
  chartName: "postgresql",
  repo: "https://charts.bitnami.com/bitnami",
  defaultVersion: "15.5.38",
};

/**
 * Generate the Helm wrapper Chart.yaml for Bitnami postgresql.
 */
export function generatePostgresChartYaml(
  cfg: PostgresConfig,
  chartVersion: string,
): string {
  const releaseName = postgresServiceName(cfg.name);
  return `apiVersion: v2
name: ${releaseName}
description: Endfield wrapper chart for PostgreSQL (${cfg.name})
type: application
version: 0.1.0

dependencies:
  - name: ${POSTGRES_HELM_PRESET.chartName}
    version: "${chartVersion}"
    repository: "${POSTGRES_HELM_PRESET.repo}"
`;
}

/**
 * Generate the values.yaml for Bitnami postgresql.
 * Password is kept here for local Helm rendering; for production, users should
 * replace it with an external secret (e.g. ExternalSecrets Operator).
 */
export function generatePostgresValuesYaml(cfg: PostgresConfig): string {
  const storageClassLine = cfg.storageClass
    ? `      storageClass: "${cfg.storageClass}"\n`
    : "";
  const metricsSection = cfg.enableMetrics
    ? `  metrics:\n    enabled: true\n    serviceMonitor:\n      enabled: false\n`
    : "";

  return `postgresql:
  auth:
    username: "${cfg.username}"
    password: "${cfg.password}"
    database: "${cfg.databaseName}"

  primary:
    persistence:
      enabled: true
      size: ${cfg.storageSize}
${storageClassLine}
  service:
    ports:
      postgresql: ${cfg.port}

${metricsSection}# Labels so Endfield can identify resources
  commonLabels:
    endfield.io/component: postgres
    endfield.io/fieldId: ${cfg.fieldId}
`;
}

/** Production-hardened values override */
export function generatePostgresProdValuesYaml(cfg: PostgresConfig): string {
  return `postgresql:
  auth:
    # Replace with ExternalSecret or Vault reference in production
    password: "CHANGE_ME_IN_PRODUCTION"

  primary:
    persistence:
      enabled: true
      size: ${cfg.storageSize}

  readReplicas:
    replicaCount: 1
    persistence:
      enabled: true
      size: ${cfg.storageSize}
`;
}

/**
 * Return all Helm mode files (Chart.yaml, values.yaml, values.prod.yaml,
 * namespace.yaml, rendered/.gitkeep) keyed by project-relative path.
 */
export function generatePostgresHelmFiles(
  cfg: PostgresConfig,
): Record<string, string> {
  const n = postgresServiceName(cfg.name);
  const base = `infra/${n}`;
  const chartVersion = cfg.chartVersion || POSTGRES_HELM_PRESET.defaultVersion;
  return {
    "namespace.yaml": generatePostgresNamespace(cfg),
    [`${base}/helm/Chart.yaml`]: generatePostgresChartYaml(cfg, chartVersion),
    [`${base}/helm/values.yaml`]: generatePostgresValuesYaml(cfg),
    [`${base}/helm/values.prod.yaml`]: generatePostgresProdValuesYaml(cfg),
    [`${base}/rendered/.gitkeep`]: "",
  };
}

// ─── Service env injection ────────────────────────────────────────────────────

export interface DbEnvInjection {
  /** Use DATABASE_URL composite string (preferred) */
  useDatabaseUrl: boolean;
  /** Use individual PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE vars */
  usePgVars: boolean;
  /** When true, host is <service>.<ns>.svc.cluster.local; else just <service> */
  fullyQualifiedHost: boolean;
  /** Namespace of the consuming service (used to decide if same-ns shortname works) */
  consumerNamespace: string;
}

export interface InjectedEnvVar {
  key: string;
  /** Plain value or empty string if sourced from secret */
  value: string;
  /** If present, this var should be rendered as secretKeyRef */
  secretRef?: { secretName: string; secretKey: string };
}

/**
 * Generate the list of env vars to inject into a Service/Deployment so it can
 * connect to the given Postgres field.
 *
 * Passwords always use secretKeyRef. Usernames may too when usePgVars is true.
 */
export function buildDbEnvVars(
  cfg: PostgresConfig,
  opts: DbEnvInjection,
): InjectedEnvVar[] {
  const secretName = postgresSecretName(cfg.name);
  const svcName = postgresServiceName(cfg.name);
  const host =
    opts.fullyQualifiedHost || opts.consumerNamespace !== cfg.namespace
      ? postgresServiceDns(cfg.name, cfg.namespace)
      : svcName;

  const vars: InjectedEnvVar[] = [];

  if (opts.useDatabaseUrl) {
    // DATABASE_URL is a composite — we build it referencing the Secret's
    // DATABASE_URL key which already has the full connection string.
    vars.push({
      key: "DATABASE_URL",
      value: "",
      secretRef: { secretName, secretKey: "DATABASE_URL" },
    });
  }

  if (opts.usePgVars) {
    vars.push({ key: "PGHOST", value: host });
    vars.push({ key: "PGPORT", value: String(cfg.port) });
    vars.push({
      key: "PGUSER",
      value: "",
      secretRef: { secretName, secretKey: "POSTGRES_USER" },
    });
    vars.push({
      key: "PGPASSWORD",
      value: "",
      secretRef: { secretName, secretKey: "POSTGRES_PASSWORD" },
    });
    vars.push({
      key: "PGDATABASE",
      value: "",
      secretRef: { secretName, secretKey: "POSTGRES_DB" },
    });
  }

  return vars;
}

/**
 * Render a list of injected env vars to a YAML snippet suitable for embedding
 * in a container spec's `env:` block.
 */
export function renderEnvVarsYaml(vars: InjectedEnvVar[]): string {
  return vars
    .map((v) => {
      if (v.secretRef) {
        return `        - name: ${v.key}
          valueFrom:
            secretKeyRef:
              name: ${v.secretRef.secretName}
              key: ${v.secretRef.secretKey}`;
      }
      return `        - name: ${v.key}
          value: "${v.value}"`;
    })
    .join("\n");
}

// ─── Connection inference ─────────────────────────────────────────────────────

/**
 * A minimal representation of a Deployment's env vars — either plain values
 * or secret/configmap refs.  Mirrors what Endfield stores for each node.
 */
export interface DeploymentEnvSpec {
  nodeId: string;
  nodeLabel: string;
  nodeNamespace: string;
  envVars: Array<{
    key: string;
    /** plain value or undefined if it comes from a ref */
    value?: string;
    secretRef?: { secretName: string; secretKey?: string };
    configMapRef?: { configMapName: string; configMapKey?: string };
  }>;
}

/**
 * Core inference function — given a Deployment's env spec and a list of known
 * Postgres configs, return all connections that can be detected.
 *
 * Detection rules (multiple can match):
 *  1) DATABASE_URL contains the Postgres service name or its full DNS
 *  2) PGHOST equals the service name or DNS
 *  3) Any env var references a Secret whose name == postgresSecretName(cfg)
 */
export function inferPostgresConnections(
  deployment: DeploymentEnvSpec,
  postgresFields: PostgresConfig[],
): PostgresConnection[] {
  const connections: PostgresConnection[] = [];

  for (const cfg of postgresFields) {
    const svcName = postgresServiceName(cfg.name);
    const svcDns = postgresServiceDns(cfg.name, cfg.namespace);
    const secretName = postgresSecretName(cfg.name);

    let reason: PostgresConnection["reason"] | null = null;
    const triggeredVars: string[] = [];

    let hasDatabaseUrl = false;
    let hasPgHost = false;
    let hasSecretRef = false;

    for (const env of deployment.envVars) {
      // Rule 1: DATABASE_URL contains service name or DNS
      if (env.key === "DATABASE_URL" && env.value) {
        if (env.value.includes(svcName) || env.value.includes(svcDns)) {
          hasDatabaseUrl = true;
          triggeredVars.push("DATABASE_URL");
        }
      }

      // Rule 2: PGHOST matches service name or DNS
      if (env.key === "PGHOST" && env.value) {
        if (env.value === svcName || env.value === svcDns) {
          hasPgHost = true;
          triggeredVars.push("PGHOST");
          if (env.value.includes(".svc.cluster.local")) {
            triggeredVars.push("(fully qualified DNS)");
          }
        }
      }

      // Rule 3: secretKeyRef references the Postgres credentials Secret
      if (env.secretRef?.secretName === secretName) {
        hasSecretRef = true;
        if (!triggeredVars.includes(`secretRef(${secretName})`)) {
          triggeredVars.push(`secretRef(${secretName})`);
        }
      }
    }

    if (hasDatabaseUrl && hasPgHost) {
      reason = "DATABASE_URL+PGHOST";
    } else if (hasDatabaseUrl) {
      reason = "DATABASE_URL";
    } else if (hasPgHost && hasSecretRef) {
      reason = "PGHOST+PGPASSWORD";
    } else if (hasPgHost) {
      reason = "PGHOST";
    } else if (hasSecretRef) {
      reason = "SECRET_REF";
    }

    if (reason) {
      connections.push({
        serviceNodeId: deployment.nodeId,
        reason,
        envVars: [...new Set(triggeredVars)],
      });
    }
  }

  return connections;
}

/** Edge label shown when hovering a Service→Postgres connection in the graph */
export function dbEdgeLabel(connection: PostgresConnection): string {
  return connection.envVars
    .filter((v) => !v.startsWith("("))
    .slice(0, 3)
    .join(", ");
}
