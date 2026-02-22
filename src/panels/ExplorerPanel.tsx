import React, { useState, useEffect } from "react";
import { useIDEStore } from "../store/ideStore";
import { YamlNode, saveYamlFile, kubectlApply, helmTemplate } from "../store/tauriStore";
import { genId } from "../layout/utils";

// ─── Color/icon maps ──────────────────────────────────────────────────────────

const TYPE_COLOR: Record<string, string> = {
  gateway: "#3b82f6",
  service: "#10b981",
  database: "#2563eb",
  cache: "#ea580c",
  queue: "#dc2626",
  monitoring: "#7c3aed",
  infra: "#16a34a",
};
const TYPE_ICON: Record<string, string> = {
  gateway: "⬡",
  service: "◈",
  database: "◫",
  cache: "⚡",
  queue: "⊛",
  monitoring: "◎",
  infra: "⛵",
};

// ─── File tree helpers ────────────────────────────────────────────────────────

interface FileTreeNode {
  id: string;
  name: string;
  isDir: boolean;
  path: string;
  isHelm: boolean;
  children: FileTreeNode[];
}

function buildTree(nodes: YamlNode[], projectPath: string): FileTreeNode[] {
  const map = new Map<string, FileTreeNode>();

  function ensure(fullPath: string, name: string, isDir: boolean, isHelm: boolean): FileTreeNode {
    if (!map.has(fullPath)) {
      map.set(fullPath, { id: fullPath, name, isDir, path: fullPath, isHelm, children: [] });
    }
    return map.get(fullPath)!;
  }

  for (const node of nodes) {
    const rel = node.file_path.startsWith(projectPath)
      ? node.file_path.slice(projectPath.length).replace(/^\//, "")
      : node.file_path;
    const parts = rel.split("/").filter(Boolean);
    let cur = projectPath;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const next = cur + "/" + part;
      const isLast = i === parts.length - 1;
      const isHelm = part === "Chart.yaml" || part.endsWith("values.yaml");
      const child = ensure(next, part, !isLast, isHelm);
      const parent = map.get(cur);
      if (parent && !parent.children.find((c) => c.id === next)) {
        parent.children.push(child);
      }
      cur = next;
    }
    // ensure root
    ensure(projectPath, projectPath.split("/").pop() ?? projectPath, true, false);
  }

  const root = map.get(projectPath);
  return root ? root.children : [];
}

// ─── Presets ──────────────────────────────────────────────────────────────────

interface RawPreset {
  typeId: string;
  image: string;
  port: number;
  kind: "Deployment" | "StatefulSet";
  replicas: number;
  desc: string;
  folder: string;
  storage?: string;
  env: Array<{ k: string; v: string }>;
  svc: boolean;
}
const RAW_PRESETS: Record<string, RawPreset> = {
  service:  { typeId:"service",    image:"",                              port:8080, kind:"Deployment",  replicas:2, desc:"Generic service",    folder:"apps",       env:[],                                                                   svc:true  },
  postgres: { typeId:"database",   image:"postgres:16-alpine",            port:5432, kind:"StatefulSet", replicas:1, desc:"PostgreSQL",         folder:"databases",  env:[{k:"POSTGRES_DB",v:"appdb"},{k:"POSTGRES_PASSWORD",v:"changeme"}],    svc:true, storage:"10Gi" },
  mongodb:  { typeId:"database",   image:"mongo:7",                       port:27017,kind:"StatefulSet", replicas:1, desc:"MongoDB",            folder:"databases",  env:[{k:"MONGO_INITDB_ROOT_PASSWORD",v:"changeme"}],                       svc:true, storage:"10Gi" },
  redis:    { typeId:"cache",      image:"redis:7-alpine",                port:6379, kind:"StatefulSet", replicas:1, desc:"Redis cache",        folder:"cache",      env:[],                                                                   svc:true, storage:"2Gi"  },
  kafka:    { typeId:"queue",      image:"confluentinc/cp-kafka:7.6.0",   port:9092, kind:"StatefulSet", replicas:3, desc:"Apache Kafka",       folder:"messaging",  env:[{k:"KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR",v:"3"}],                  svc:true, storage:"20Gi" },
  nginx:    { typeId:"gateway",    image:"nginx:1.25-alpine",             port:80,   kind:"Deployment",  replicas:2, desc:"Nginx proxy",        folder:"apps",       env:[],                                                                   svc:true  },
  grafana:  { typeId:"monitoring", image:"grafana/grafana:latest",        port:3000, kind:"Deployment",  replicas:1, desc:"Grafana dashboard",  folder:"monitoring", env:[],                                                                   svc:true  },
};

interface HelmPreset {
  typeId: string;
  desc: string;
  chart: string;
  repo: string;
  version: string;
  ns: string;
  values: string;
}
const HELM_PRESETS: Record<string, HelmPreset> = {
  "ingress-nginx":          { typeId:"gateway",    desc:"Nginx Ingress Controller",  chart:"ingress-nginx",          repo:"https://kubernetes.github.io/ingress-nginx",            version:"4.10.1",  ns:"infra-ingress-nginx", values:"controller:\n  replicaCount: 2\n  service:\n    type: LoadBalancer\n" },
  "cert-manager":           { typeId:"infra",      desc:"TLS certificate manager",   chart:"cert-manager",           repo:"https://charts.jetstack.io",                            version:"v1.14.4", ns:"cert-manager",        values:"installCRDs: true\n" },
  "kube-prometheus-stack":  { typeId:"monitoring", desc:"Prometheus + Grafana",      chart:"kube-prometheus-stack",  repo:"https://prometheus-community.github.io/helm-charts",   version:"58.0.0",  ns:"infra-monitoring",    values:"grafana:\n  enabled: true\nprometheus:\n  enabled: true\n" },
};

function buildRawYaml(name: string, p: RawPreset, port: number, ns: string): Record<string, string> {
  const n = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const files: Record<string, string> = {};
  const envYaml = p.env.length
    ? "        env:\n" + p.env.map(e => `          - name: ${e.k}\n            value: "${e.v}"`).join("\n") + "\n"
    : "";
  const volMount = p.storage
    ? `        volumeMounts:\n          - name: data\n            mountPath: /data\n      volumes:\n        - name: data\n          persistentVolumeClaim:\n            claimName: ${n}-pvc\n`
    : "";
  files[`${p.folder}/${n}-${p.kind.toLowerCase()}.yaml`] =
    `apiVersion: apps/v1\nkind: ${p.kind}\nmetadata:\n  name: ${n}\n  namespace: ${ns}\n  labels:\n    app: ${n}\n    managed-by: endfield\nspec:\n  replicas: ${p.replicas}\n  selector:\n    matchLabels:\n      app: ${n}\n  template:\n    metadata:\n      labels:\n        app: ${n}\n    spec:\n      containers:\n        - name: ${n}\n          image: ${p.image || n + ":latest"}\n          ports:\n            - containerPort: ${port}\n${envYaml}${volMount}`;
  if (p.svc) {
    files[`${p.folder}/${n}-service.yaml`] =
      `apiVersion: v1\nkind: Service\nmetadata:\n  name: ${n}\n  namespace: ${ns}\nspec:\n  selector:\n    app: ${n}\n  ports:\n    - port: ${port}\n      targetPort: ${port}\n`;
  }
  if (p.storage) {
    files[`${p.folder}/${n}-pvc.yaml`] =
      `apiVersion: v1\nkind: PersistentVolumeClaim\nmetadata:\n  name: ${n}-pvc\n  namespace: ${ns}\nspec:\n  accessModes: [ReadWriteOnce]\n  resources:\n    requests:\n      storage: ${p.storage}\n`;
  }
  return files;
}

function buildHelmFiles(name: string, p: HelmPreset): Record<string, string> {
  return {
    [`infra/${name}/helm/Chart.yaml`]:
      `apiVersion: v2\nname: ${name}\ndescription: Endfield wrapper for ${p.chart}\ntype: application\nversion: 0.1.0\ndependencies:\n  - name: ${p.chart}\n    version: "${p.version}"\n    repository: "${p.repo}"\n`,
    [`infra/${name}/helm/values.yaml`]: p.values,
    [`infra/${name}/namespace.yaml`]:
      `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${p.ns}\n`,
  };
}

// ─── AddFieldModal ────────────────────────────────────────────────────────────

function AddFieldModal({ projectPath, onAdd, onClose }: {
  projectPath: string;
  onAdd: (n: YamlNode) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"raw" | "helm">("raw");
  const [rawKey, setRawKey] = useState("service");
  const [helmKey, setHelmKey] = useState("ingress-nginx");
  const [name, setName] = useState("");
  const [ns, setNs] = useState("default");
  const [port, setPort] = useState(8080);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const rawPreset = RAW_PRESETS[rawKey];
  const helmPreset = HELM_PRESETS[helmKey];

  const handleCreate = async () => {
    if (!name.trim()) { setMsg("Name is required"); return; }
    setBusy(true); setMsg(null);
    try {
      const n = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      if (mode === "raw") {
        const files = buildRawYaml(n, rawPreset, port, ns);
        for (const [rel, content] of Object.entries(files)) {
          await saveYamlFile(`${projectPath}/${rel}`, content);
          await kubectlApply(`${projectPath}/${rel}`).catch(() => {});
        }
        const mainFile = Object.keys(files)[0];
        onAdd({
          id: genId("node"), label: n, kind: rawPreset.kind,
          image: rawPreset.image || n + ":latest", type_id: rawPreset.typeId,
          namespace: ns, file_path: `${projectPath}/${mainFile}`,
          replicas: rawPreset.replicas, source: "raw",
          x: 10 + Math.random() * 60, y: 10 + Math.random() * 60,
        });
      } else {
        const files = buildHelmFiles(n, helmPreset);
        for (const [rel, content] of Object.entries(files)) {
          await saveYamlFile(`${projectPath}/${rel}`, content);
        }
        const dir = `${projectPath}/infra/${n}`;
        await helmTemplate(dir, n, helmPreset.ns).catch(() => {});
        onAdd({
          id: genId("node"), label: n, kind: "HelmRelease",
          image: `helm:${helmPreset.chart}/${helmPreset.version}`,
          type_id: helmPreset.typeId, namespace: helmPreset.ns,
          file_path: `${dir}/helm/Chart.yaml`,
          replicas: null, source: "helm",
          x: 10 + Math.random() * 60, y: 10 + Math.random() * 60,
        });
      }
      setMsg("Created successfully");
    } catch (e: unknown) {
      setMsg("Error: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  const inp: React.CSSProperties = {
    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 4, padding: "5px 8px", color: "rgba(255,255,255,0.75)",
    fontSize: 11, fontFamily: "monospace", outline: "none", width: "100%",
  };

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center" }}
    >
      <div style={{ background:"#0f1a2e", border:"1px solid rgba(255,255,255,0.1)", borderRadius:9, width:420, overflow:"hidden" }}>
        {/* Header */}
        <div style={{ padding:"12px 16px", borderBottom:"1px solid rgba(255,255,255,0.07)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ color:"#e2e8f0", fontFamily:"monospace", fontWeight:600, fontSize:13 }}>Add Field</span>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"rgba(255,255,255,0.3)", cursor:"pointer", fontSize:16 }}>✕</button>
        </div>
        {/* Mode tabs */}
        <div style={{ display:"flex", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
          {(["raw","helm"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex:1, padding:"6px 0", background: mode===m ? "rgba(59,130,246,0.1)" : "none",
              border:"none", borderBottom:`2px solid ${mode===m ? "#60a5fa" : "transparent"}`,
              color: mode===m ? "#93c5fd" : "rgba(255,255,255,0.3)",
              fontSize:10, cursor:"pointer", fontFamily:"monospace", letterSpacing:"0.06em",
            }}>
              {m === "helm" ? "⛵ HELM" : "RAW YAML"}
            </button>
          ))}
        </div>
        <div style={{ padding:16, display:"flex", flexDirection:"column", gap:10 }}>
          <div>
            <div style={{ color:"rgba(255,255,255,0.3)", fontSize:10, marginBottom:4, fontFamily:"monospace" }}>NAME</div>
            <input value={name} onChange={e => setName(e.target.value)} placeholder={mode==="raw" ? "my-service" : "my-release"} style={inp} />
          </div>
          {mode === "raw" ? (
            <>
              <div>
                <div style={{ color:"rgba(255,255,255,0.3)", fontSize:10, marginBottom:4, fontFamily:"monospace" }}>PRESET</div>
                <select value={rawKey} onChange={e => { setRawKey(e.target.value); setPort(RAW_PRESETS[e.target.value].port); }} style={{ ...inp, cursor:"pointer" }}>
                  {Object.entries(RAW_PRESETS).map(([k,p]) => (
                    <option key={k} value={k}>{TYPE_ICON[p.typeId]} {k} — {p.desc}</option>
                  ))}
                </select>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                <div>
                  <div style={{ color:"rgba(255,255,255,0.3)", fontSize:10, marginBottom:4, fontFamily:"monospace" }}>NAMESPACE</div>
                  <input value={ns} onChange={e => setNs(e.target.value)} style={inp} />
                </div>
                <div>
                  <div style={{ color:"rgba(255,255,255,0.3)", fontSize:10, marginBottom:4, fontFamily:"monospace" }}>PORT</div>
                  <input type="number" value={port} onChange={e => setPort(Number(e.target.value))} style={inp} />
                </div>
              </div>
              <div style={{ color:"rgba(255,255,255,0.2)", fontSize:10, fontFamily:"monospace", lineHeight:1.6 }}>
                {rawPreset.image && <>{rawPreset.image}<br /></>}
                folder: {rawPreset.folder}/
                {rawPreset.storage && <> · storage: {rawPreset.storage}</>}
              </div>
            </>
          ) : (
            <>
              <div>
                <div style={{ color:"rgba(255,255,255,0.3)", fontSize:10, marginBottom:4, fontFamily:"monospace" }}>CHART</div>
                <select value={helmKey} onChange={e => setHelmKey(e.target.value)} style={{ ...inp, cursor:"pointer" }}>
                  {Object.entries(HELM_PRESETS).map(([k,p]) => (
                    <option key={k} value={k}>{TYPE_ICON[p.typeId]} {k} — {p.desc}</option>
                  ))}
                </select>
              </div>
              <div style={{ color:"rgba(255,255,255,0.2)", fontSize:10, fontFamily:"monospace", lineHeight:1.6 }}>
                {helmPreset.chart} {helmPreset.version}<br />
                ns: {helmPreset.ns}
              </div>
            </>
          )}
          {msg && (
            <div style={{ color: msg.startsWith("Error") ? "#fca5a5" : "#6ee7b7", fontSize:11, fontFamily:"monospace" }}>
              {msg.startsWith("Error") ? "✗ " : "✓ "}{msg}
            </div>
          )}
          <button
            onClick={handleCreate}
            disabled={busy}
            style={{
              padding:"8px 16px", background:"rgba(59,130,246,0.18)",
              border:"1px solid rgba(96,165,250,0.4)", borderRadius:5,
              color:"#93c5fd", fontSize:11, fontFamily:"monospace",
              cursor: busy ? "wait" : "pointer", marginTop:2,
            }}
          >
            {busy ? "Creating…" : "Create Field"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── FileTreeView ─────────────────────────────────────────────────────────────

function FileTreeView({
  nodes, depth, expanded, onToggle, selectedId, onFileClick,
}: {
  nodes: FileTreeNode[];
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  selectedId: string | null;
  onFileClick: (n: FileTreeNode) => void;
}) {
  return (
    <>
      {nodes.map(node => {
        const isOpen = expanded.has(node.id);
        const isSel = selectedId === node.id;
        return (
          <React.Fragment key={node.id}>
            <div
              onClick={() => node.isDir ? onToggle(node.id) : onFileClick(node)}
              style={{
                display:"flex", alignItems:"center", gap:4,
                padding:`2px 8px 2px ${6 + depth * 14}px`,
                cursor:"pointer",
                background: isSel ? "rgba(59,130,246,0.15)" : "transparent",
                borderLeft: isSel ? "2px solid rgba(96,165,250,0.7)" : "2px solid transparent",
              }}
              onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
              onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ fontSize:9, color:"rgba(255,255,255,0.2)", width:10, flexShrink:0 }}>
                {node.isDir ? (isOpen ? "▾" : "▸") : ""}
              </span>
              <span style={{ fontSize:12, flexShrink:0 }}>
                {node.isDir ? (isOpen ? "📂" : "📁") : node.isHelm ? "⛵" : "📄"}
              </span>
              <span style={{
                fontSize:11,
                color: isSel ? "#93c5fd" : node.isDir ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.45)",
                overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
              }}>
                {node.name}
              </span>
            </div>
            {node.isDir && isOpen && (
              <FileTreeView
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                selectedId={selectedId}
                onFileClick={onFileClick}
              />
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

// ─── FieldSection ─────────────────────────────────────────────────────────────

function FieldSection({ label, fields, expanded, onToggle, selectedId, onFieldClick }: {
  label: string;
  fields: YamlNode[];
  expanded: boolean;
  onToggle: () => void;
  selectedId: string | null;
  onFieldClick: (n: YamlNode) => void;
}) {
  return (
    <>
      <div
        onClick={onToggle}
        style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 8px", cursor:"pointer" }}
        onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
      >
        <span style={{ fontSize:8, color:"rgba(255,255,255,0.3)" }}>{expanded ? "▾" : "▸"}</span>
        <span style={{ fontSize:9, color:"rgba(255,255,255,0.3)", letterSpacing:"0.1em", textTransform:"uppercase" }}>{label}</span>
        <span style={{ marginLeft:"auto", fontSize:9, color:"rgba(255,255,255,0.18)" }}>{fields.length}</span>
      </div>
      {expanded && fields.map(node => {
        const color = TYPE_COLOR[node.type_id] ?? "#475569";
        const icon = TYPE_ICON[node.type_id] ?? "◇";
        const isSel = selectedId === node.id;
        return (
          <div
            key={node.id}
            onClick={() => onFieldClick(node)}
            style={{
              display:"flex", alignItems:"center", gap:6, padding:"4px 8px 4px 20px",
              cursor:"pointer",
              background: isSel ? `${color}18` : "transparent",
              borderLeft: isSel ? `2px solid ${color}` : "2px solid transparent",
            }}
            onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
            onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = "transparent"; }}
          >
            <span style={{ fontSize:12, color, flexShrink:0 }}>{icon}</span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ color: isSel ? "#e2e8f0" : "rgba(255,255,255,0.6)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {node.label}
              </div>
              <div style={{ color:"rgba(255,255,255,0.22)", fontSize:9, marginTop:1 }}>
                {node.kind} · {node.namespace}
              </div>
            </div>
            {node.source === "helm" && <span style={{ fontSize:9, color:"rgba(255,255,255,0.2)" }}>⛵</span>}
            {node.replicas != null && <span style={{ fontSize:9, color:`${color}99` }}>×{node.replicas}</span>}
          </div>
        );
      })}
    </>
  );
}

// ─── ExplorerPanel ────────────────────────────────────────────────────────────

export function ExplorerPanel() {
  const [activeTab, setActiveTab] = useState<"files" | "fields">("files");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [expandedSecs, setExpandedSecs] = useState({ services: true, infra: true });
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");

  const nodes        = useIDEStore(s => s.nodes);
  const projectPath  = useIDEStore(s => s.projectPath);
  const addNode      = useIDEStore(s => s.addNode);
  const openTab      = useIDEStore(s => s.openTab);
  const setSelected  = useIDEStore(s => s.setSelectedEntity);
  const selected     = useIDEStore(s => s.selectedEntity);

  const fileTree = projectPath ? buildTree(nodes, projectPath) : [];

  // auto-expand root folders once
  useEffect(() => {
    if (fileTree.length > 0 && expandedFolders.size === 0) {
      setExpandedFolders(new Set(fileTree.map(n => n.id)));
    }
  }, [fileTree.length]);

  const toggleFolder = (id: string) =>
    setExpandedFolders(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const handleFileClick = (node: FileTreeNode) => {
    setSelected({ type:"file", id:node.id, label:node.name, filePath:node.path });
    openTab({ id:`file-${node.path}`, title:node.name, contentType:"file", filePath:node.path, icon: node.isHelm ? "⛵" : "📄" }, "center");
  };

  const handleFieldClick = (node: YamlNode) => {
    setSelected({ type:"field", id:node.id, label:node.label, filePath:node.file_path, meta:{ kind:node.kind, namespace:node.namespace } });
    if (node.file_path) {
      openTab({ id:`file-${node.file_path}`, title:node.file_path.split("/").pop() ?? node.label, contentType:"file", filePath:node.file_path, icon: node.source==="helm" ? "⛵" : "📄" }, "center");
    }
  };

  const q = search.toLowerCase();
  const serviceNodes = nodes.filter(n => !["gateway","infra","monitoring"].includes(n.type_id) && (!q || n.label.includes(q)));
  const infraNodes   = nodes.filter(n =>  ["gateway","infra","monitoring"].includes(n.type_id) && (!q || n.label.includes(q)));

  const tabStyle = (t: "files" | "fields"): React.CSSProperties => ({
    flex:1, padding:"7px 0", background: activeTab===t ? "rgba(59,130,246,0.08)" : "none",
    border:"none", borderBottom:`2px solid ${activeTab===t ? "rgba(96,165,250,0.7)" : "transparent"}`,
    color: activeTab===t ? "#93c5fd" : "rgba(255,255,255,0.3)",
    fontSize:10, cursor:"pointer", fontFamily:"monospace", letterSpacing:"0.06em", textTransform:"uppercase" as const,
  });

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#070f1e", fontFamily:"'JetBrains Mono', monospace", fontSize:11, color:"#94a3b8" }}>

      {/* Tab switcher: Files / Fields */}
      <div style={{ display:"flex", borderBottom:"1px solid rgba(255,255,255,0.06)", flexShrink:0 }}>
        <button style={tabStyle("files")} onClick={() => setActiveTab("files")}>📁 Files</button>
        <button style={tabStyle("fields")} onClick={() => setActiveTab("fields")}>⬡ Fields</button>
      </div>

      {/* Search bar + add button */}
      <div style={{ padding:"6px 8px", flexShrink:0, borderBottom:"1px solid rgba(255,255,255,0.04)", display:"flex", gap:6, alignItems:"center" }}>
        <div style={{ flex:1, display:"flex", alignItems:"center", gap:5, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:4, padding:"3px 7px" }}>
          <span style={{ color:"rgba(255,255,255,0.2)", fontSize:10 }}>⌕</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={activeTab==="files" ? "Search files…" : "Search fields…"}
            style={{ flex:1, background:"none", border:"none", outline:"none", color:"rgba(255,255,255,0.5)", fontSize:10, fontFamily:"monospace" }}
          />
        </div>
        {activeTab === "fields" && projectPath && (
          <button
            onClick={() => setShowAdd(true)}
            style={{ background:"rgba(59,130,246,0.15)", border:"1px solid rgba(96,165,250,0.3)", borderRadius:4, color:"#60a5fa", fontSize:13, padding:"2px 9px", cursor:"pointer", fontFamily:"monospace", flexShrink:0 }}
          >
            +
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ flex:1, overflowY:"auto", padding:"4px 0" }}>
        {nodes.length === 0 ? (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"80%", color:"rgba(255,255,255,0.12)", gap:8 }}>
            <div style={{ fontSize:24 }}>{activeTab==="files" ? "📁" : "◈"}</div>
            <div style={{ fontSize:10 }}>No project open</div>
          </div>
        ) : activeTab === "files" ? (
          fileTree.length === 0 ? (
            <div style={{ padding:"20px 12px", color:"rgba(255,255,255,0.15)", fontSize:10 }}>No YAML files found</div>
          ) : (
            <FileTreeView
              nodes={fileTree}
              depth={0}
              expanded={expandedFolders}
              onToggle={toggleFolder}
              selectedId={selected?.type==="file" ? selected.id : null}
              onFileClick={handleFileClick}
            />
          )
        ) : (
          <>
            <FieldSection
              label="Services"
              fields={serviceNodes}
              expanded={expandedSecs.services}
              onToggle={() => setExpandedSecs(s => ({ ...s, services:!s.services }))}
              selectedId={selected?.type==="field" ? selected.id : null}
              onFieldClick={handleFieldClick}
            />
            <FieldSection
              label="Infrastructure"
              fields={infraNodes}
              expanded={expandedSecs.infra}
              onToggle={() => setExpandedSecs(s => ({ ...s, infra:!s.infra }))}
              selectedId={selected?.type==="field" ? selected.id : null}
              onFieldClick={handleFieldClick}
            />
          </>
        )}
      </div>

      {showAdd && projectPath && (
        <AddFieldModal
          projectPath={projectPath}
          onAdd={node => { addNode(node); setShowAdd(false); }}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}
