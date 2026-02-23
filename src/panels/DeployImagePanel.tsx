import React, { useState, useCallback } from "react";
import {
  deployImage,
  DeployImageRequest,
  DeployImageResult,
  EnvVarPlain,
  EnvVarSecret,
  PortMapping,
} from "../store/tauriStore";

// ─── Style helpers ────────────────────────────────────────────────────────────

const S = {
  panel: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100%",
    background: "#070f1e",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    color: "#94a3b8",
    overflowY: "auto" as const,
  },
  header: {
    padding: "12px 16px",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0 as const,
  },
  section: {
    padding: "12px 16px",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
  },
  sectionTitle: {
    fontSize: 9,
    color: "rgba(255,255,255,0.25)",
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    marginBottom: 10,
  },
  row: {
    display: "flex",
    gap: 8,
    marginBottom: 8,
  },
  field: {
    display: "flex",
    flexDirection: "column" as const,
    flex: 1,
  },
  label: {
    fontSize: 9,
    color: "rgba(255,255,255,0.3)",
    marginBottom: 4,
    letterSpacing: "0.05em",
  },
  input: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 4,
    padding: "5px 8px",
    color: "rgba(255,255,255,0.75)",
    fontSize: 11,
    fontFamily: "monospace",
    outline: "none",
    width: "100%",
  } as React.CSSProperties,
  inputError: {
    border: "1px solid rgba(239,68,68,0.5)",
    background: "rgba(239,68,68,0.05)",
  } as React.CSSProperties,
  select: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 4,
    padding: "5px 8px",
    color: "rgba(255,255,255,0.75)",
    fontSize: 11,
    fontFamily: "monospace",
    outline: "none",
    width: "100%",
    cursor: "pointer",
  } as React.CSSProperties,
  checkbox: {
    accentColor: "#3b82f6",
    cursor: "pointer",
    width: 13,
    height: 13,
  } as React.CSSProperties,
  btn: (variant: "primary" | "ghost" | "danger") => ({
    padding: "5px 12px",
    borderRadius: 4,
    fontSize: 10,
    fontFamily: "monospace",
    cursor: "pointer",
    border: variant === "primary"
      ? "1px solid rgba(96,165,250,0.4)"
      : variant === "danger"
      ? "1px solid rgba(239,68,68,0.3)"
      : "1px solid rgba(255,255,255,0.1)",
    background: variant === "primary"
      ? "rgba(59,130,246,0.18)"
      : variant === "danger"
      ? "rgba(239,68,68,0.1)"
      : "rgba(255,255,255,0.04)",
    color: variant === "primary"
      ? "#93c5fd"
      : variant === "danger"
      ? "#fca5a5"
      : "rgba(255,255,255,0.45)",
  } as React.CSSProperties),
  addBtn: {
    background: "none",
    border: "1px dashed rgba(255,255,255,0.12)",
    borderRadius: 4,
    color: "rgba(255,255,255,0.3)",
    fontSize: 10,
    fontFamily: "monospace",
    cursor: "pointer",
    padding: "4px 10px",
    width: "100%",
    textAlign: "left" as const,
  } as React.CSSProperties,
  errorText: { color: "#fca5a5", fontSize: 10 },
  successText: { color: "#6ee7b7", fontSize: 10 },
};

// ─── Validators ───────────────────────────────────────────────────────────────

const DNS1123 = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validateName(v: string): string | null {
  if (!v) return "Required";
  if (!DNS1123.test(v)) return "Must be DNS-1123: lowercase letters, digits, hyphens only, no leading/trailing hyphens";
  return null;
}

function validateImage(v: string): string | null {
  if (!v.trim()) return "Required";
  return null;
}

function validateEnvKey(key: string): string | null {
  if (!key) return "Key is required";
  if (!ENV_KEY.test(key)) return "Invalid key (letters, digits, underscores; must not start with digit)";
  return null;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EnvEditor({
  items,
  onChange,
  isSecret,
}: {
  items: (EnvVarPlain | EnvVarSecret)[];
  onChange: (items: (EnvVarPlain | EnvVarSecret)[]) => void;
  isSecret?: boolean;
}) {
  const add = () => onChange([...items, { key: "", value: "" }]);
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const update = (i: number, field: "key" | "value", val: string) => {
    const next = items.map((item, idx) => idx === i ? { ...item, [field]: val } : item);
    onChange(next);
  };

  const usedKeys = items.map(e => e.key).filter(Boolean);
  const dupKeys = usedKeys.filter((k, i) => usedKeys.indexOf(k) !== i);

  return (
    <div>
      {items.map((item, i) => {
        const keyErr = validateEnvKey(item.key) ?? (dupKeys.includes(item.key) ? "Duplicate key" : null);
        return (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <input
                value={item.key}
                onChange={e => update(i, "key", e.target.value)}
                placeholder="KEY_NAME"
                style={{ ...S.input, ...(keyErr ? S.inputError : {}), fontFamily: "monospace", textTransform: "uppercase" as const }}
              />
              {keyErr && <div style={{ ...S.errorText, marginTop: 2 }}>{keyErr}</div>}
            </div>
            <input
              value={item.value}
              onChange={e => update(i, "value", e.target.value)}
              placeholder={isSecret ? "secret value" : "value"}
              type={isSecret ? "password" : "text"}
              style={{ ...S.input, flex: 1, fontFamily: "monospace" }}
            />
            <button onClick={() => remove(i)} style={{ ...S.btn("danger"), padding: "5px 8px", flexShrink: 0 }}>✕</button>
          </div>
        );
      })}
      <button onClick={add} style={S.addBtn}>
        + Add {isSecret ? "secret" : "plain"} env
      </button>
    </div>
  );
}

function PortsEditor({ ports, onChange }: { ports: PortMapping[]; onChange: (p: PortMapping[]) => void }) {
  const add = () => onChange([...ports, { containerPort: 8080, name: "" }]);
  const remove = (i: number) => onChange(ports.filter((_, idx) => idx !== i));
  const update = (i: number, field: keyof PortMapping, val: string | number) => {
    onChange(ports.map((p, idx) => idx === i ? { ...p, [field]: val } : p));
  };

  return (
    <div>
      {ports.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
          <input
            type="number"
            value={p.containerPort}
            onChange={e => update(i, "containerPort", parseInt(e.target.value) || 0)}
            placeholder="Port"
            min={1} max={65535}
            style={{ ...S.input, width: 80 }}
          />
          <input
            value={p.name ?? ""}
            onChange={e => update(i, "name", e.target.value)}
            placeholder="name (opt)"
            style={{ ...S.input, flex: 1 }}
          />
          <button onClick={() => remove(i)} style={{ ...S.btn("danger"), padding: "5px 8px" }}>✕</button>
        </div>
      ))}
      <button onClick={add} style={S.addBtn}>+ Add port</button>
    </div>
  );
}

function ManifestPreview({ manifests }: { manifests: DeployImageResult["manifests"] }) {
  const [open, setOpen] = useState(false);
  const all = [
    manifests.namespace && { name: "namespace.yaml", content: manifests.namespace },
    manifests.secret    && { name: "secret.yaml",    content: manifests.secret },
    { name: "deployment.yaml", content: manifests.deployment },
    manifests.service   && { name: "service.yaml",   content: manifests.service },
  ].filter(Boolean) as Array<{ name: string; content: string }>;
  const [sel, setSel] = useState(0);

  return (
    <div style={{ marginTop: 8, border: "1px solid rgba(255,255,255,0.07)", borderRadius: 5, overflow: "hidden" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ ...S.btn("ghost"), width: "100%", textAlign: "left", borderRadius: 0, border: "none", borderBottom: open ? "1px solid rgba(255,255,255,0.06)" : "none", padding: "7px 12px" }}
      >
        {open ? "▾" : "▸"} Generated manifests ({all.length} files)
      </button>
      {open && (
        <>
          <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            {all.map((f, i) => (
              <button
                key={f.name}
                onClick={() => setSel(i)}
                style={{
                  padding: "4px 10px",
                  background: sel === i ? "rgba(59,130,246,0.12)" : "none",
                  border: "none",
                  borderBottom: `2px solid ${sel === i ? "#60a5fa" : "transparent"}`,
                  color: sel === i ? "#93c5fd" : "rgba(255,255,255,0.3)",
                  fontSize: 9,
                  fontFamily: "monospace",
                  cursor: "pointer",
                }}
              >
                {f.name}
              </button>
            ))}
          </div>
          <pre style={{
            padding: "10px 12px",
            fontSize: 10,
            color: "rgba(255,255,255,0.55)",
            overflowX: "auto",
            maxHeight: 260,
            margin: 0,
            background: "rgba(0,0,0,0.2)",
          }}>
            {all[sel]?.content ?? ""}
          </pre>
        </>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function DeployImagePanel() {
  // Form state
  const [namespace,       setNamespace]       = useState("default");
  const [name,            setName]            = useState("");
  const [image,           setImage]           = useState("");
  const [replicas,        setReplicas]        = useState(1);
  const [env,             setEnv]             = useState<EnvVarPlain[]>([]);
  const [secretEnv,       setSecretEnv]       = useState<EnvVarSecret[]>([]);
  const [ports,           setPorts]           = useState<PortMapping[]>([]);
  const [serviceType,     setServiceType]     = useState<"ClusterIP" | "NodePort" | "LoadBalancer">("ClusterIP");
  const [imagePullSecret, setImagePullSecret] = useState("");
  const [createNamespace, setCreateNamespace] = useState(false);
  // Resources
  const [showResources,   setShowResources]   = useState(false);
  const [cpuReq,          setCpuReq]          = useState("100m");
  const [memReq,          setMemReq]          = useState("128Mi");
  const [cpuLim,          setCpuLim]          = useState("500m");
  const [memLim,          setMemLim]          = useState("512Mi");

  // UI state
  const [busy,    setBusy]    = useState(false);
  const [result,  setResult]  = useState<DeployImageResult | null>(null);
  const [errors,  setErrors]  = useState<Record<string, string>>({});

  const validate = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    const ne = validateName(name);
    if (ne) errs.name = ne;
    if (!namespace.trim()) errs.namespace = "Required";
    const ie = validateImage(image);
    if (ie) errs.image = ie;
    if (replicas < 1 || replicas > 99) errs.replicas = "Must be 1–99";
    // env keys
    const allEnvKeys = [...env.map(e => e.key), ...secretEnv.map(e => e.key)];
    const hasBadEnvKey = [...env, ...secretEnv].some(e => validateEnvKey(e.key) !== null || !e.key);
    if (hasBadEnvKey) errs.env = "Fix invalid env keys";
    const dupKeys = allEnvKeys.filter((k, i) => k && allEnvKeys.indexOf(k) !== i);
    if (dupKeys.length) errs.env = `Duplicate env keys: ${dupKeys.join(", ")}`;
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [name, namespace, image, replicas, env, secretEnv]);

  const handleDeploy = async () => {
    if (!validate()) return;
    setBusy(true);
    setResult(null);
    try {
      const request: DeployImageRequest = {
        namespace,
        name,
        image: image.trim(),
        replicas,
        env: env.filter(e => e.key),
        secretEnv: secretEnv.filter(e => e.key),
        ports,
        serviceType,
        resources: showResources ? {
          cpuRequest: cpuReq,
          memRequest: memReq,
          cpuLimit: cpuLim,
          memLimit: memLim,
        } : undefined,
        imagePullSecret: imagePullSecret.trim() || undefined,
        createNamespace,
      };
      const res = await deployImage(request);
      setResult(res);
    } catch (e: unknown) {
      setResult({
        success: false,
        deploymentName: name,
        secretName: null,
        serviceName: null,
        namespace,
        stdout: "",
        stderr: "",
        error: e instanceof Error ? e.message : String(e),
        manifests: { deployment: "" },
      });
    } finally {
      setBusy(false);
    }
  };

  const inp = (extraErr?: string): React.CSSProperties =>
    ({ ...S.input, ...(extraErr ? S.inputError : {}) });

  return (
    <div style={S.panel}>
      {/* Header */}
      <div style={S.header}>
        <span style={{ fontSize: 16 }}>🚀</span>
        <div>
          <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 13 }}>Deploy Image</div>
          <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 9, marginTop: 1 }}>
            Deploy a Docker image directly to Kubernetes — no YAML required
          </div>
        </div>
      </div>

      {/* ── Basic ── */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Basic</div>
        <div style={S.row}>
          <div style={S.field}>
            <div style={S.label}>NAMESPACE</div>
            <input value={namespace} onChange={e => setNamespace(e.target.value)} placeholder="default" style={inp(errors.namespace)} />
            {errors.namespace && <div style={S.errorText}>{errors.namespace}</div>}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: errors.namespace ? 16 : 2 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", color: "rgba(255,255,255,0.35)", fontSize: 10, whiteSpace: "nowrap" }}>
              <input
                type="checkbox"
                checked={createNamespace}
                onChange={e => setCreateNamespace(e.target.checked)}
                style={S.checkbox}
              />
              create if not exists
            </label>
          </div>
        </div>
        <div style={S.row}>
          <div style={S.field}>
            <div style={S.label}>APP NAME</div>
            <input value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="my-app" style={inp(errors.name)} />
            {errors.name && <div style={S.errorText}>{errors.name}</div>}
          </div>
          <div style={{ ...S.field, maxWidth: 80 }}>
            <div style={S.label}>REPLICAS</div>
            <input type="number" min={1} max={99} value={replicas} onChange={e => setReplicas(parseInt(e.target.value) || 1)} style={inp(errors.replicas)} />
            {errors.replicas && <div style={S.errorText}>{errors.replicas}</div>}
          </div>
        </div>
        <div style={S.row}>
          <div style={S.field}>
            <div style={S.label}>IMAGE</div>
            <input
              value={image}
              onChange={e => setImage(e.target.value)}
              placeholder="registry.example.com/repo:tag"
              style={inp(errors.image)}
            />
            {errors.image && <div style={S.errorText}>{errors.image}</div>}
            <div style={{ color: "rgba(255,255,255,0.18)", fontSize: 9, marginTop: 3 }}>
              Endfield does not build images — use an existing registry image.
            </div>
          </div>
        </div>
      </div>

      {/* ── Env ── */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Environment Variables</div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 9, marginBottom: 6 }}>
            PLAIN — stored directly in Deployment
          </div>
          <EnvEditor items={env} onChange={setEnv} />
        </div>
        <div>
          <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 9, marginBottom: 6 }}>
            SECRET — stored in a Kubernetes Secret, mounted via <code style={{ fontSize: 9, color: "#93c5fd" }}>secretKeyRef</code>
          </div>
          <EnvEditor items={secretEnv} onChange={setSecretEnv} isSecret />
        </div>
        {errors.env && <div style={{ ...S.errorText, marginTop: 6 }}>⚠ {errors.env}</div>}
      </div>

      {/* ── Ports / Service ── */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Ports & Service</div>
        <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 9, marginBottom: 8 }}>
          Leave empty to skip Service creation.
        </div>
        <PortsEditor ports={ports} onChange={setPorts} />
        {ports.length > 0 && (
          <div style={{ ...S.row, marginTop: 10 }}>
            <div style={S.field}>
              <div style={S.label}>SERVICE TYPE</div>
              <select value={serviceType} onChange={e => setServiceType(e.target.value as typeof serviceType)} style={S.select}>
                <option value="ClusterIP">ClusterIP (internal)</option>
                <option value="NodePort">NodePort</option>
                <option value="LoadBalancer">LoadBalancer</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* ── Resources ── */}
      <div style={S.section}>
        <button
          onClick={() => setShowResources(!showResources)}
          style={{ ...S.btn("ghost"), marginBottom: showResources ? 10 : 0, width: "auto" }}
        >
          {showResources ? "▾" : "▸"} Resource Requests / Limits
        </button>
        {showResources && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              ["CPU REQUEST",    cpuReq, setCpuReq, "100m"],
              ["MEM REQUEST",    memReq, setMemReq, "128Mi"],
              ["CPU LIMIT",      cpuLim, setCpuLim, "500m"],
              ["MEM LIMIT",      memLim, setMemLim, "512Mi"],
            ].map(([lbl, val, setter, ph]) => (
              <div key={lbl as string} style={S.field}>
                <div style={S.label}>{lbl as string}</div>
                <input
                  value={val as string}
                  onChange={e => (setter as React.Dispatch<React.SetStateAction<string>>)(e.target.value)}
                  placeholder={ph as string}
                  style={S.input}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Advanced ── */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Advanced</div>
        <div style={S.field}>
          <div style={S.label}>IMAGE PULL SECRET (optional)</div>
          <input
            value={imagePullSecret}
            onChange={e => setImagePullSecret(e.target.value)}
            placeholder="my-registry-secret"
            style={S.input}
          />
          <div style={{ color: "rgba(255,255,255,0.18)", fontSize: 9, marginTop: 3 }}>
            Must exist in the target namespace. Used for private registries.
          </div>
        </div>
      </div>

      {/* ── Deploy button ── */}
      <div style={{ padding: "12px 16px", flexShrink: 0 }}>
        <button
          onClick={handleDeploy}
          disabled={busy}
          style={{
            ...S.btn("primary"),
            width: "100%",
            padding: "9px 0",
            fontSize: 12,
            opacity: busy ? 0.6 : 1,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? "⏳ Deploying…" : "🚀 Deploy"}
        </button>
      </div>

      {/* ── Result ── */}
      {result && (
        <div style={{ ...S.section, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 14 }}>{result.success ? "✅" : "❌"}</span>
            <span style={result.success ? S.successText : S.errorText}>
              {result.success
                ? `Deployed ${result.deploymentName} → ${result.namespace}`
                : `Deploy failed: ${result.error}`}
            </span>
          </div>

          {result.success && (
            <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6, marginBottom: 10 }}>
              {[
                ["Deployment", result.deploymentName],
                result.serviceName && ["Service", result.serviceName],
                result.secretName  && ["Secret",  result.secretName],
              ].filter(Boolean).map(([kind, res]) => (
                <div
                  key={kind as string}
                  style={{
                    background: "rgba(59,130,246,0.1)",
                    border: "1px solid rgba(59,130,246,0.25)",
                    borderRadius: 4,
                    padding: "3px 8px",
                    fontSize: 10,
                    color: "#93c5fd",
                    fontFamily: "monospace",
                  }}
                >
                  <span style={{ color: "rgba(255,255,255,0.3)" }}>{kind as string}/</span>
                  {res as string}
                </div>
              ))}
              <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 10, alignSelf: "center" }}>
                in <span style={{ color: "#93c5fd" }}>{result.namespace}</span>
              </div>
            </div>
          )}

          {(result.stdout || result.stderr) && (
            <pre style={{
              background: "rgba(0,0,0,0.3)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 4,
              padding: "8px 10px",
              fontSize: 10,
              color: result.stderr ? "#fca5a5" : "rgba(255,255,255,0.5)",
              overflowX: "auto",
              maxHeight: 140,
              margin: 0,
              marginBottom: 8,
              whiteSpace: "pre-wrap" as const,
              wordBreak: "break-all" as const,
            }}>
              {result.stdout || result.stderr}
            </pre>
          )}

          {result.success && <ManifestPreview manifests={result.manifests} />}

          {result.success && (
            <div style={{ marginTop: 8, color: "rgba(255,255,255,0.2)", fontSize: 9, lineHeight: 1.7 }}>
              Check status:
              <code style={{ color: "#93c5fd", display: "block", marginTop: 2 }}>
                kubectl rollout status deployment/{result.deploymentName} -n {result.namespace}
              </code>
              <code style={{ color: "#93c5fd", display: "block" }}>
                kubectl get pods -n {result.namespace} -l app.kubernetes.io/name={result.deploymentName}
              </code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
