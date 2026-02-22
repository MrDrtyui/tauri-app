export interface FileNode {
  id: string;
  name: string;
  type: "file" | "folder";
  path: string;
  children?: FileNode[];
  language?: "yaml" | "helm" | "json" | "txt";
}

export interface FieldNode {
  id: string;
  label: string;
  kind: string;
  typeId: string;
  namespace: string;
  source: "raw" | "helm";
  filePath: string;
  replicas?: number;
}

export interface GraphNode {
  id: string;
  label: string;
  typeId: string;
  x: number;
  y: number;
  filePath: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

// ─── Files tree ───────────────────────────────────────────────────────────────

export const MOCK_FILE_TREE: FileNode[] = [
  {
    id: "root",
    name: "infra",
    type: "folder",
    path: "/infra",
    children: [
      {
        id: "f-ns",
        name: "namespace.yaml",
        type: "file",
        path: "/infra/namespace.yaml",
        language: "yaml",
      },
      {
        id: "folder-apps",
        name: "apps",
        type: "folder",
        path: "/infra/apps",
        children: [
          {
            id: "f-auth",
            name: "auth-deployment.yaml",
            type: "file",
            path: "/infra/apps/auth-deployment.yaml",
            language: "yaml",
          },
          {
            id: "f-api",
            name: "api-deployment.yaml",
            type: "file",
            path: "/infra/apps/api-deployment.yaml",
            language: "yaml",
          },
          {
            id: "f-frontend",
            name: "frontend-deployment.yaml",
            type: "file",
            path: "/infra/apps/frontend-deployment.yaml",
            language: "yaml",
          },
        ],
      },
      {
        id: "folder-db",
        name: "databases",
        type: "folder",
        path: "/infra/databases",
        children: [
          {
            id: "f-pg-ss",
            name: "postgres-statefulset.yaml",
            type: "file",
            path: "/infra/databases/postgres-statefulset.yaml",
            language: "yaml",
          },
          {
            id: "f-pg-svc",
            name: "postgres-service.yaml",
            type: "file",
            path: "/infra/databases/postgres-service.yaml",
            language: "yaml",
          },
          {
            id: "f-pg-sec",
            name: "postgres-secret.yaml",
            type: "file",
            path: "/infra/databases/postgres-secret.yaml",
            language: "yaml",
          },
        ],
      },
      {
        id: "folder-msg",
        name: "messaging",
        type: "folder",
        path: "/infra/messaging",
        children: [
          {
            id: "f-kafka-ss",
            name: "kafka-statefulset.yaml",
            type: "file",
            path: "/infra/messaging/kafka-statefulset.yaml",
            language: "yaml",
          },
          {
            id: "f-kafka-svc",
            name: "kafka-service.yaml",
            type: "file",
            path: "/infra/messaging/kafka-service.yaml",
            language: "yaml",
          },
        ],
      },
      {
        id: "folder-infra",
        name: "infra-components",
        type: "folder",
        path: "/infra/infra",
        children: [
          {
            id: "folder-nginx",
            name: "ingress-nginx",
            type: "folder",
            path: "/infra/infra/ingress-nginx",
            children: [
              {
                id: "f-nginx-ns",
                name: "namespace.yaml",
                type: "file",
                path: "/infra/infra/ingress-nginx/namespace.yaml",
                language: "yaml",
              },
              {
                id: "folder-nginx-helm",
                name: "helm",
                type: "folder",
                path: "/infra/infra/ingress-nginx/helm",
                children: [
                  {
                    id: "f-nginx-chart",
                    name: "Chart.yaml",
                    type: "file",
                    path: "/infra/infra/ingress-nginx/helm/Chart.yaml",
                    language: "helm",
                  },
                  {
                    id: "f-nginx-values",
                    name: "values.yaml",
                    type: "file",
                    path: "/infra/infra/ingress-nginx/helm/values.yaml",
                    language: "yaml",
                  },
                  {
                    id: "f-nginx-prod",
                    name: "values.prod.yaml",
                    type: "file",
                    path: "/infra/infra/ingress-nginx/helm/values.prod.yaml",
                    language: "yaml",
                  },
                ],
              },
            ],
          },
          {
            id: "folder-redis",
            name: "redis",
            type: "folder",
            path: "/infra/infra/redis",
            children: [
              {
                id: "f-redis-chart",
                name: "Chart.yaml",
                type: "file",
                path: "/infra/infra/redis/helm/Chart.yaml",
                language: "helm",
              },
              {
                id: "f-redis-values",
                name: "values.yaml",
                type: "file",
                path: "/infra/infra/redis/helm/values.yaml",
                language: "yaml",
              },
            ],
          },
          {
            id: "folder-monitoring",
            name: "kube-prometheus-stack",
            type: "folder",
            path: "/infra/infra/monitoring",
            children: [
              {
                id: "f-mon-chart",
                name: "Chart.yaml",
                type: "file",
                path: "/infra/infra/monitoring/helm/Chart.yaml",
                language: "helm",
              },
              {
                id: "f-mon-values",
                name: "values.yaml",
                type: "file",
                path: "/infra/infra/monitoring/helm/values.yaml",
                language: "yaml",
              },
            ],
          },
        ],
      },
    ],
  },
];

// ─── Fields (services / infra) ────────────────────────────────────────────────

export const MOCK_FIELDS: FieldNode[] = [
  {
    id: "field-nginx",
    label: "ingress-nginx",
    kind: "HelmRelease",
    typeId: "gateway",
    namespace: "infra-ingress-nginx",
    source: "helm",
    filePath: "/infra/infra/ingress-nginx/helm/Chart.yaml",
  },
  {
    id: "field-auth",
    label: "auth-service",
    kind: "Deployment",
    typeId: "service",
    namespace: "myapp",
    source: "raw",
    filePath: "/infra/apps/auth-deployment.yaml",
    replicas: 3,
  },
  {
    id: "field-api",
    label: "api-gateway",
    kind: "Deployment",
    typeId: "service",
    namespace: "myapp",
    source: "raw",
    filePath: "/infra/apps/api-deployment.yaml",
    replicas: 2,
  },
  {
    id: "field-frontend",
    label: "frontend",
    kind: "Deployment",
    typeId: "service",
    namespace: "myapp",
    source: "raw",
    filePath: "/infra/apps/frontend-deployment.yaml",
    replicas: 2,
  },
  {
    id: "field-redis",
    label: "redis",
    kind: "HelmRelease",
    typeId: "cache",
    namespace: "infra-redis",
    source: "helm",
    filePath: "/infra/infra/redis/helm/Chart.yaml",
  },
  {
    id: "field-postgres",
    label: "postgres-db",
    kind: "StatefulSet",
    typeId: "database",
    namespace: "myapp",
    source: "raw",
    filePath: "/infra/databases/postgres-statefulset.yaml",
    replicas: 1,
  },
  {
    id: "field-kafka",
    label: "kafka-broker",
    kind: "StatefulSet",
    typeId: "queue",
    namespace: "myapp",
    source: "raw",
    filePath: "/infra/messaging/kafka-statefulset.yaml",
    replicas: 3,
  },
  {
    id: "field-monitoring",
    label: "kube-prometheus-stack",
    kind: "HelmRelease",
    typeId: "monitoring",
    namespace: "infra-monitoring",
    source: "helm",
    filePath: "/infra/infra/monitoring/helm/Chart.yaml",
  },
];

// ─── Graph nodes ──────────────────────────────────────────────────────────────

export const MOCK_GRAPH_NODES: GraphNode[] = [
  { id: "gn-nginx", label: "ingress-nginx", typeId: "gateway", x: 10, y: 35, filePath: "/infra/infra/ingress-nginx/helm/Chart.yaml" },
  { id: "gn-auth", label: "auth-service", typeId: "service", x: 35, y: 15, filePath: "/infra/apps/auth-deployment.yaml" },
  { id: "gn-api", label: "api-gateway", typeId: "service", x: 35, y: 50, filePath: "/infra/apps/api-deployment.yaml" },
  { id: "gn-frontend", label: "frontend", typeId: "service", x: 35, y: 80, filePath: "/infra/apps/frontend-deployment.yaml" },
  { id: "gn-redis", label: "redis", typeId: "cache", x: 62, y: 15, filePath: "/infra/infra/redis/helm/Chart.yaml" },
  { id: "gn-postgres", label: "postgres-db", typeId: "database", x: 62, y: 45, filePath: "/infra/databases/postgres-statefulset.yaml" },
  { id: "gn-kafka", label: "kafka-broker", typeId: "queue", x: 62, y: 72, filePath: "/infra/messaging/kafka-statefulset.yaml" },
  { id: "gn-monitoring", label: "kube-prometheus-stack", typeId: "monitoring", x: 85, y: 35, filePath: "/infra/infra/monitoring/helm/Chart.yaml" },
];

export const MOCK_GRAPH_EDGES: GraphEdge[] = [
  { id: "e1", source: "gn-nginx", target: "gn-auth" },
  { id: "e2", source: "gn-nginx", target: "gn-api" },
  { id: "e3", source: "gn-nginx", target: "gn-frontend" },
  { id: "e4", source: "gn-auth", target: "gn-redis", label: "cache" },
  { id: "e5", source: "gn-auth", target: "gn-postgres", label: "db" },
  { id: "e6", source: "gn-api", target: "gn-postgres", label: "db" },
  { id: "e7", source: "gn-api", target: "gn-kafka", label: "events" },
  { id: "e8", source: "gn-monitoring", target: "gn-auth" },
  { id: "e9", source: "gn-monitoring", target: "gn-api" },
];

// ─── Node → Field mapping ─────────────────────────────────────────────────────

export const GRAPH_NODE_TO_FIELD: Record<string, string> = {
  "gn-nginx": "field-nginx",
  "gn-auth": "field-auth",
  "gn-api": "field-api",
  "gn-frontend": "field-frontend",
  "gn-redis": "field-redis",
  "gn-postgres": "field-postgres",
  "gn-kafka": "field-kafka",
  "gn-monitoring": "field-monitoring",
};

// ─── Mock file contents ───────────────────────────────────────────────────────

export const MOCK_FILE_CONTENTS: Record<string, string> = {
  "/infra/apps/auth-deployment.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: auth-service
  namespace: myapp
  labels:
    app: auth-service
    managed-by: endfield
spec:
  replicas: 3
  selector:
    matchLabels:
      app: auth-service
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: auth-service
    spec:
      containers:
        - name: auth-service
          image: myapp/auth:v1.2.0
          ports:
            - containerPort: 8080
          env:
            - name: NODE_ENV
              value: "production"
            - name: PORT
              value: "8080"
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
`,
  "/infra/databases/postgres-statefulset.yaml": `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres-db
  namespace: myapp
  labels:
    app: postgres-db
    managed-by: endfield
spec:
  serviceName: postgres-db-headless
  replicas: 1
  selector:
    matchLabels:
      app: postgres-db
  template:
    metadata:
      labels:
        app: postgres-db
    spec:
      containers:
        - name: postgres-db
          image: postgres:16-alpine
          ports:
            - containerPort: 5432
              name: main
          env:
            - name: POSTGRES_DB
              value: "appdb"
            - name: POSTGRES_USER
              value: "postgres"
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: postgres-db-secret
                  key: POSTGRES_PASSWORD
          resources:
            requests:
              cpu: "250m"
              memory: "256Mi"
            limits:
              cpu: "1000m"
              memory: "1Gi"
`,
  "/infra/infra/ingress-nginx/helm/Chart.yaml": `apiVersion: v2
name: ingress-nginx
description: Endfield-managed wrapper chart for ingress-nginx
type: application
version: 0.1.0
appVersion: ""

dependencies:
  - name: ingress-nginx
    version: "4.10.1"
    repository: "https://kubernetes.github.io/ingress-nginx"
`,
  "/infra/infra/redis/helm/values.yaml": `redis:
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
};
