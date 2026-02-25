import { AppIcon } from "../ui/AppIcon";
import React, { useState, useCallback } from "react";
import {
  deployImage,
  DeployImageRequest,
  DeployImageResult,
  EnvVarPlain,
  EnvVarSecret,
  PortMapping,
} from "../store/tauriStore";

// ─── Style helpers ────────────────────────────────────────────────

const inp: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-sm)",
  padding: "6px 10px",
  color: "var(--text-primary)",
  fontSize: "var(--font-size-sm)",
  fontFamily: "var(--font-mono)",
  outline: "none",
  width: "100%",
  transition: "border-color 0.12s ease",
};

const inpErr: React.CSSProperties = {
  ...inp,
  borderColor: "rgba(243,139,168,0.5)",
  background: "rgba(243,139,168,0.04)",
};

const sel: React.CSSProperties = {
  ...inp,
  cursor: "pointer",
};

function labelStyle(): React.CSSProperties {
  return {
    fontSize: "var(--font-size-xs)",
    color: "var(--text-subtle)",
    marginBottom: 5,
    fontFamily: "var(--font-mono)",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  };
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: "var(--font-size-xs)",
        color: "var(--text-subtle)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        fontWeight: 500,
        marginBottom: 12,
        paddingBottom: 6,
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      {children}
    </div>
  );
}

function ErrText({ msg }: { msg?: string | null }) {
  if (!msg) return null;
  return (
    <div
      style={{
        color: "var(--ctp-red)",
        fontSize: "var(--font-size-xs)",
        marginTop: 3,
        fontFamily: "var(--font-mono)",
      }}
    >
      {msg}
    </div>
  );
}

// ─── Validators ───────────────────────────────────────────────────

const DNS1123 = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validateName(v: string): string | null {
  if (!v) return "Required";
  if (!DNS1123.test(v)) return "Lowercase letters, digits, hyphens only";
  return null;
}
function validateImage(v: string): string | null {
  if (!v.trim()) return "Required";
  return null;
}
function validateEnvKey(key: string): string | null {
  if (!key) return "Key is required";
  if (!ENV_KEY.test(key)) return "Invalid key format";
  return null;
}

// ─── EnvEditor ────────────────────────────────────────────────────

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
  const update = (i: number, field: "key" | "value", val: string) =>
    onChange(
      items.map((item, idx) => (idx === i ? { ...item, [field]: val } : item)),
    );

  const usedKeys = items.map((e) => e.key).filter(Boolean);
  const dupKeys = usedKeys.filter((k, i) => usedKeys.indexOf(k) !== i);

  return (
    <div>
      {items.map((item, i) => {
        const keyErr =
          validateEnvKey(item.key) ??
          (dupKeys.includes(item.key) ? "Duplicate key" : null);
        return (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 6,
              marginBottom: 7,
              alignItems: "flex-start",
            }}
          >
            <div style={{ flex: 1 }}>
              <input
                value={item.key}
                onChange={(e) => update(i, "key", e.target.value)}
                placeholder="KEY_NAME"
                style={{
                  ...(keyErr ? inpErr : inp),
                  textTransform: "uppercase" as const,
                }}
              />
              {keyErr && <ErrText msg={keyErr} />}
            </div>
            <input
              value={item.value}
              onChange={(e) => update(i, "value", e.target.value)}
              placeholder={isSecret ? "secret value" : "value"}
              type={isSecret ? "password" : "text"}
              style={{ ...inp, flex: 1 }}
            />
            <button
              onClick={() => remove(i)}
              style={{
                background: "rgba(243,139,168,0.08)",
                border: "1px solid rgba(243,139,168,0.2)",
                borderRadius: "var(--radius-xs)",
                color: "var(--ctp-red)",
                fontSize: 11,
                padding: "5px 8px",
                cursor: "pointer",
                flexShrink: 0,
                transition: "var(--ease-fast)",
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.background =
                  "rgba(243,139,168,0.15)")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background =
                  "rgba(243,139,168,0.08)")
              }
            >
              <AppIcon name="close" size={10} strokeWidth={2.5} />
            </button>
          </div>
        );
      })}
      <button
        onClick={add}
        style={{
          background: "none",
          border: "1px dashed var(--border-default)",
          borderRadius: "var(--radius-sm)",
          color: "var(--text-faint)",
          fontSize: "var(--font-size-xs)",
          cursor: "pointer",
          padding: "5px 10px",
          width: "100%",
          textAlign: "left",
          fontFamily: "var(--font-ui)",
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
        + Add {isSecret ? "secret" : "plain"} env
      </button>
    </div>
  );
}

// ─── PortsEditor ──────────────────────────────────────────────────

function PortsEditor({
  ports,
  onChange,
}: {
  ports: PortMapping[];
  onChange: (p: PortMapping[]) => void;
}) {
  const add = () => onChange([...ports, { containerPort: 8080, name: "" }]);
  const remove = (i: number) => onChange(ports.filter((_, idx) => idx !== i));
  const update = (i: number, field: keyof PortMapping, val: string | number) =>
    onChange(ports.map((p, idx) => (idx === i ? { ...p, [field]: val } : p)));

  return (
    <div>
      {ports.map((p, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            gap: 6,
            marginBottom: 6,
            alignItems: "center",
          }}
        >
          <input
            type="number"
            value={p.containerPort}
            onChange={(e) =>
              update(i, "containerPort", parseInt(e.target.value) || 0)
            }
            placeholder="Port"
            min={1}
            max={65535}
            style={{ ...inp, width: 80 }}
          />
          <input
            value={p.name ?? ""}
            onChange={(e) => update(i, "name", e.target.value)}
            placeholder="name (optional)"
            style={{ ...inp, flex: 1 }}
          />
          <button
            onClick={() => remove(i)}
            style={{
              background: "rgba(243,139,168,0.08)",
              border: "1px solid rgba(243,139,168,0.2)",
              borderRadius: "var(--radius-xs)",
              color: "var(--ctp-red)",
              fontSize: 11,
              padding: "5px 8px",
              cursor: "pointer",
              transition: "var(--ease-fast)",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.background =
                "rgba(243,139,168,0.15)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.background =
                "rgba(243,139,168,0.08)")
            }
          >
            <AppIcon name="close" size={10} strokeWidth={2.5} />
          </button>
        </div>
      ))}
      <button
        onClick={add}
        style={{
          background: "none",
          border: "1px dashed var(--border-default)",
          borderRadius: "var(--radius-sm)",
          color: "var(--text-faint)",
          fontSize: "var(--font-size-xs)",
          cursor: "pointer",
          padding: "5px 10px",
          width: "100%",
          textAlign: "left",
          fontFamily: "var(--font-ui)",
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
        + Add port
      </button>
    </div>
  );
}

// ─── ManifestPreview ──────────────────────────────────────────────

function ManifestPreview({
  manifests,
}: {
  manifests: DeployImageResult["manifests"];
}) {
  const [open, setOpen] = useState(false);
  const all = [
    manifests.namespace && {
      name: "namespace.yaml",
      content: manifests.namespace,
    },
    manifests.secret && { name: "secret.yaml", content: manifests.secret },
    { name: "deployment.yaml", content: manifests.deployment },
    manifests.service && { name: "service.yaml", content: manifests.service },
  ].filter(Boolean) as Array<{ name: string; content: string }>;
  const [sel, setSel] = useState(0);

  return (
    <div
      style={{
        marginTop: 8,
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: "var(--bg-surface)",
          border: "none",
          borderBottom: open ? "1px solid var(--border-subtle)" : "none",
          color: "var(--text-muted)",
          fontSize: "var(--font-size-xs)",
          padding: "7px 12px",
          cursor: "pointer",
          width: "100%",
          textAlign: "left",
          fontFamily: "var(--font-ui)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <AppIcon
          name={open ? "chevronDown" : "chevronRight"}
          size={11}
          strokeWidth={2}
          style={{ marginRight: 4 }}
        />{" "}
        Generated manifests ({all.length} files)
      </button>
      {open && (
        <>
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid var(--border-subtle)",
              background: "var(--bg-surface)",
            }}
          >
            {all.map((f, i) => (
              <button
                key={f.name}
                onClick={() => setSel(i)}
                style={{
                  padding: "4px 10px",
                  background: "none",
                  border: "none",
                  borderBottom: `2px solid ${sel === i ? "var(--accent)" : "transparent"}`,
                  color: sel === i ? "var(--accent)" : "var(--text-faint)",
                  fontSize: "var(--font-size-xs)",
                  fontFamily: "var(--font-mono)",
                  cursor: "pointer",
                  transition: "var(--ease-fast)",
                }}
              >
                {f.name}
              </button>
            ))}
          </div>
          <pre
            style={{
              padding: "10px 14px",
              fontSize: 11,
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono)",
              overflowX: "auto",
              maxHeight: 260,
              margin: 0,
              background: "rgba(0,0,0,0.15)",
              lineHeight: 1.6,
            }}
          >
            {all[sel]?.content ?? ""}
          </pre>
        </>
      )}
    </div>
  );
}

// ─── DeployImagePanel ─────────────────────────────────────────────

export function DeployImagePanel() {
  const [namespace, setNamespace] = useState("apps");
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [replicas, setReplicas] = useState(1);
  const [env, setEnv] = useState<EnvVarPlain[]>([]);
  const [secretEnv, setSecretEnv] = useState<EnvVarSecret[]>([]);
  const [ports, setPorts] = useState<PortMapping[]>([]);
  const [serviceType, setServiceType] = useState<
    "ClusterIP" | "NodePort" | "LoadBalancer"
  >("ClusterIP");
  const [imagePullSecret, setImagePullSecret] = useState("");
  const [createNamespace, setCreateNamespace] = useState(false);
  const [showResources, setShowResources] = useState(false);
  const [cpuReq, setCpuReq] = useState("100m");
  const [memReq, setMemReq] = useState("128Mi");
  const [cpuLim, setCpuLim] = useState("500m");
  const [memLim, setMemLim] = useState("512Mi");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DeployImageResult | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    const ne = validateName(name);
    if (ne) errs.name = ne;
    if (!namespace.trim()) errs.namespace = "Required";
    const ie = validateImage(image);
    if (ie) errs.image = ie;
    if (replicas < 1 || replicas > 99) errs.replicas = "Must be 1–99";
    const allEnvKeys = [
      ...env.map((e) => e.key),
      ...secretEnv.map((e) => e.key),
    ];
    const hasBadEnvKey = [...env, ...secretEnv].some(
      (e) => validateEnvKey(e.key) !== null || !e.key,
    );
    if (hasBadEnvKey) errs.env = "Fix invalid env keys";
    const dupKeys = allEnvKeys.filter(
      (k, i) => k && allEnvKeys.indexOf(k) !== i,
    );
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
        env: env.filter((e) => e.key),
        secretEnv: secretEnv.filter((e) => e.key),
        ports,
        serviceType,
        resources: showResources
          ? {
              cpuRequest: cpuReq,
              memRequest: memReq,
              cpuLimit: cpuLim,
              memLimit: memLim,
            }
          : undefined,
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

  const section: React.CSSProperties = {
    padding: "14px 16px",
    borderBottom: "1px solid var(--border-subtle)",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg-primary)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--font-size-sm)",
        color: "var(--text-secondary)",
        overflowY: "auto",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
          background: "var(--bg-surface)",
        }}
      >
        <AppIcon
          name="deployImage"
          size={18}
          strokeWidth={1.5}
          style={{ color: "var(--ctp-sapphire)" }}
        />
        <div>
          <div
            style={{
              color: "var(--text-primary)",
              fontWeight: 500,
              fontSize: "var(--font-size-lg)",
            }}
          >
            Deploy Image
          </div>
          <div
            style={{
              color: "var(--text-faint)",
              fontSize: "var(--font-size-xs)",
              marginTop: 1,
            }}
          >
            Deploy a Docker image directly to Kubernetes — no YAML required
          </div>
        </div>
      </div>

      {/* Basic */}
      <div style={section}>
        <SectionTitle>Basic</SectionTitle>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle()}>Namespace</div>
            <input
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              placeholder="default"
              style={errors.namespace ? inpErr : inp}
            />
            <ErrText msg={errors.namespace} />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              paddingBottom: errors.namespace ? 16 : 2,
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                cursor: "pointer",
                color: "var(--text-faint)",
                fontSize: "var(--font-size-xs)",
                whiteSpace: "nowrap",
              }}
            >
              <input
                type="checkbox"
                checked={createNamespace}
                onChange={(e) => setCreateNamespace(e.target.checked)}
                style={{ accentColor: "var(--accent)", cursor: "pointer" }}
              />
              create if not exists
            </label>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle()}>App Name</div>
            <input
              value={name}
              onChange={(e) =>
                setName(
                  e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
                )
              }
              placeholder="my-app"
              style={errors.name ? inpErr : inp}
            />
            <ErrText msg={errors.name} />
          </div>
          <div style={{ width: 80 }}>
            <div style={labelStyle()}>Replicas</div>
            <input
              type="number"
              min={1}
              max={99}
              value={replicas}
              onChange={(e) => setReplicas(parseInt(e.target.value) || 1)}
              style={errors.replicas ? inpErr : inp}
            />
            <ErrText msg={errors.replicas} />
          </div>
        </div>
        <div>
          <div style={labelStyle()}>Image</div>
          <input
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="registry.example.com/repo:tag"
            style={errors.image ? inpErr : inp}
          />
          <ErrText msg={errors.image} />
          <div
            style={{
              color: "var(--text-faint)",
              fontSize: "var(--font-size-xs)",
              marginTop: 4,
              lineHeight: 1.5,
            }}
          >
            Endfield does not build images — use an existing registry image.
          </div>
        </div>
      </div>

      {/* Env vars */}
      <div style={section}>
        <SectionTitle>Environment Variables</SectionTitle>
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              color: "var(--text-faint)",
              fontSize: "var(--font-size-xs)",
              marginBottom: 7,
            }}
          >
            Plain — stored in Deployment
          </div>
          <EnvEditor items={env} onChange={setEnv} />
        </div>
        <div>
          <div
            style={{
              color: "var(--text-faint)",
              fontSize: "var(--font-size-xs)",
              marginBottom: 7,
            }}
          >
            Secret — stored in a Kubernetes Secret, mounted via{" "}
            <code
              style={{
                fontSize: "var(--font-size-xs)",
                color: "var(--accent-alt)",
                fontFamily: "var(--font-mono)",
              }}
            >
              secretKeyRef
            </code>
          </div>
          <EnvEditor items={secretEnv} onChange={setSecretEnv} isSecret />
        </div>
        {errors.env && (
          <div
            style={{
              color: "var(--ctp-yellow)",
              fontSize: "var(--font-size-xs)",
              marginTop: 6,
              display: "flex",
              gap: 5,
            }}
          >
            <AppIcon
              name="warning"
              size={11}
              strokeWidth={2}
              style={{ marginRight: 4 }}
            />
            {errors.env}
          </div>
        )}
      </div>

      {/* Ports */}
      <div style={section}>
        <SectionTitle>Ports & Service</SectionTitle>
        <div
          style={{
            color: "var(--text-faint)",
            fontSize: "var(--font-size-xs)",
            marginBottom: 8,
          }}
        >
          Leave empty to skip Service creation.
        </div>
        <PortsEditor ports={ports} onChange={setPorts} />
        {ports.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={labelStyle()}>Service Type</div>
            <select
              value={serviceType}
              onChange={(e) =>
                setServiceType(e.target.value as typeof serviceType)
              }
              style={sel}
            >
              <option value="ClusterIP">ClusterIP (internal)</option>
              <option value="NodePort">NodePort</option>
              <option value="LoadBalancer">LoadBalancer</option>
            </select>
          </div>
        )}
      </div>

      {/* Resources */}
      <div style={section}>
        <button
          onClick={() => setShowResources(!showResources)}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            fontSize: "var(--font-size-sm)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: 0,
            fontFamily: "var(--font-ui)",
            marginBottom: showResources ? 12 : 0,
          }}
        >
          <AppIcon
            name={showResources ? "chevronDown" : "chevronRight"}
            size={11}
            strokeWidth={2}
            style={{ marginRight: 4 }}
          />{" "}
          Resource Requests / Limits
        </button>
        {showResources && (
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
          >
            {(
              [
                ["CPU Request", cpuReq, setCpuReq, "100m"],
                ["Mem Request", memReq, setMemReq, "128Mi"],
                ["CPU Limit", cpuLim, setCpuLim, "500m"],
                ["Mem Limit", memLim, setMemLim, "512Mi"],
              ] as const
            ).map(([lbl, val, setter, ph]) => (
              <div key={lbl}>
                <div style={labelStyle()}>{lbl}</div>
                <input
                  value={val}
                  onChange={(e) =>
                    (setter as React.Dispatch<React.SetStateAction<string>>)(
                      e.target.value,
                    )
                  }
                  placeholder={ph}
                  style={inp}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Advanced */}
      <div style={section}>
        <SectionTitle>Advanced</SectionTitle>
        <div style={labelStyle()}>Image Pull Secret (optional)</div>
        <input
          value={imagePullSecret}
          onChange={(e) => setImagePullSecret(e.target.value)}
          placeholder="my-registry-secret"
          style={inp}
        />
        <div
          style={{
            color: "var(--text-faint)",
            fontSize: "var(--font-size-xs)",
            marginTop: 4,
          }}
        >
          Must exist in the target namespace.
        </div>
      </div>

      {/* Deploy button */}
      <div style={{ padding: "14px 16px", flexShrink: 0 }}>
        <button
          onClick={handleDeploy}
          disabled={busy}
          style={{
            width: "100%",
            padding: "9px 0",
            background: busy
              ? "rgba(180,190,254,0.08)"
              : "rgba(180,190,254,0.12)",
            border: "1px solid var(--border-accent)",
            borderRadius: "var(--radius-md)",
            color: "var(--accent-alt)",
            fontSize: "var(--font-size-md)",
            fontFamily: "var(--font-ui)",
            fontWeight: 500,
            cursor: busy ? "wait" : "pointer",
            transition: "var(--ease-fast)",
            opacity: busy ? 0.6 : 1,
          }}
          onMouseEnter={(e) => {
            if (!busy)
              (e.currentTarget as HTMLElement).style.background =
                "rgba(180,190,254,0.22)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background =
              "rgba(180,190,254,0.12)";
          }}
        >
          {busy ? "Deploying…" : "Deploy"}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div style={{ ...section, flexShrink: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <AppIcon
              name={result.success ? "success" : "error"}
              size={14}
              strokeWidth={2}
              style={{
                color: result.success
                  ? "var(--status-ok)"
                  : "var(--status-error)",
              }}
            />
            <span
              style={{
                color: result.success ? "var(--ctp-green)" : "var(--ctp-red)",
                fontSize: "var(--font-size-sm)",
              }}
            >
              {result.success
                ? `Deployed ${result.deploymentName} to ${result.namespace}`
                : `Deploy failed: ${result.error}`}
            </span>
          </div>

          {result.success && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap" as const,
                gap: 6,
                marginBottom: 10,
              }}
            >
              {(
                [
                  ["Deployment", result.deploymentName],
                  result.serviceName && ["Service", result.serviceName],
                  result.secretName && ["Secret", result.secretName],
                ] as const
              )
                .filter(Boolean)
                .map(([kind, res]) => (
                  <div
                    key={kind as string}
                    style={{
                      background: "rgba(180,190,254,0.08)",
                      border: "1px solid var(--border-accent)",
                      borderRadius: "var(--radius-sm)",
                      padding: "3px 8px",
                      fontSize: "var(--font-size-xs)",
                      color: "var(--accent-alt)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    <span style={{ color: "var(--text-faint)" }}>
                      {kind as string}/
                    </span>
                    {res as string}
                  </div>
                ))}
              <span
                style={{
                  color: "var(--text-faint)",
                  fontSize: "var(--font-size-xs)",
                  alignSelf: "center",
                  fontFamily: "var(--font-mono)",
                }}
              >
                in{" "}
                <span style={{ color: "var(--accent-alt)" }}>
                  {result.namespace}
                </span>
              </span>
            </div>
          )}

          {(result.stdout || result.stderr) && (
            <pre
              style={{
                background: "rgba(0,0,0,0.2)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)",
                padding: "8px 12px",
                fontSize: 11,
                color: result.stderr ? "var(--ctp-red)" : "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                overflowX: "auto",
                maxHeight: 140,
                margin: "0 0 8px",
                whiteSpace: "pre-wrap" as const,
                wordBreak: "break-all" as const,
                lineHeight: 1.6,
              }}
            >
              {result.stdout || result.stderr}
            </pre>
          )}

          {result.success && <ManifestPreview manifests={result.manifests} />}

          {result.success && (
            <div
              style={{
                marginTop: 8,
                color: "var(--text-faint)",
                fontSize: "var(--font-size-xs)",
                lineHeight: 2,
                fontFamily: "var(--font-mono)",
              }}
            >
              Check status:
              <code style={{ color: "var(--accent-alt)", display: "block" }}>
                kubectl rollout status deployment/{result.deploymentName} -n{" "}
                {result.namespace}
              </code>
              <code style={{ color: "var(--accent-alt)", display: "block" }}>
                kubectl get pods -n {result.namespace} -l
                app.kubernetes.io/name={result.deploymentName}
              </code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
