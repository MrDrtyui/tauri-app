import React, { useState, useEffect, useRef } from "react";
import { AppIcon } from "../ui/AppIcon";
import { useIDEStore } from "../store/ideStore";
import {
  deployImage,
  generateField,
  deployResource,
  saveYamlFile,
  type YamlNode,
  type EnvVarPlain,
  type PortMapping,
} from "../store/tauriStore";

// ─── Style helpers ────────────────────────────────────────────────────────────

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
  boxSizing: "border-box",
};

const LBL: React.CSSProperties = {
  display: "block",
  color: "var(--text-subtle)",
  fontSize: "var(--font-size-xs)",
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  fontWeight: 500,
  marginBottom: 5,
  fontFamily: "var(--font-ui)",
};

const SECTION: React.CSSProperties = {
  padding: "14px 16px",
  borderBottom: "1px solid var(--border-subtle)",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: "var(--font-size-xs)",
        color: "var(--text-subtle)",
        letterSpacing: "0.08em",
        textTransform: "uppercase" as const,
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

function EnvEditor({
  items,
  onChange,
  isSecret,
}: {
  items: EnvVarPlain[];
  onChange: (items: EnvVarPlain[]) => void;
  isSecret?: boolean;
}) {
  return (
    <div>
      {items.map((item, i) => (
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
            value={item.key}
            onChange={(e) =>
              onChange(
                items.map((x, j) =>
                  j === i ? { ...x, key: e.target.value } : x,
                ),
              )
            }
            placeholder="KEY_NAME"
            style={{
              ...INP,
              flex: "0 0 44%",
              fontSize: "var(--font-size-xs)",
              padding: "4px 8px",
            }}
          />
          <input
            value={item.value}
            onChange={(e) =>
              onChange(
                items.map((x, j) =>
                  j === i ? { ...x, value: e.target.value } : x,
                ),
              )
            }
            placeholder={isSecret ? "secret value" : "value"}
            type={isSecret ? "password" : "text"}
            style={{
              ...INP,
              flex: 1,
              fontSize: "var(--font-size-xs)",
              padding: "4px 8px",
              ...(isSecret
                ? {
                    background: "rgba(243,139,168,0.04)",
                    borderColor: "rgba(243,139,168,0.20)",
                  }
                : {}),
            }}
          />
          <button
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            style={{
              background: "none",
              border: "none",
              color: "var(--ctp-red)",
              cursor: "pointer",
              opacity: 0.6,
              padding: "0 2px",
              flexShrink: 0,
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
        onClick={() => onChange([...items, { key: "", value: "" }])}
        style={{
          background: "none",
          border: `1px dashed ${isSecret ? "rgba(243,139,168,0.25)" : "var(--border-default)"}`,
          borderRadius: "var(--radius-xs)",
          color: isSecret ? "rgba(243,139,168,0.50)" : "var(--text-faint)",
          fontSize: "var(--font-size-xs)",
          padding: "4px 10px",
          cursor: "pointer",
          fontFamily: "var(--font-ui)",
          textAlign: "left",
          marginTop: 2,
          transition: "var(--ease-fast)",
        }}
      >
        + add {isSecret ? "secret" : "plain"} env
      </button>
    </div>
  );
}

function PortsEditor({
  ports,
  onChange,
}: {
  ports: PortMapping[];
  onChange: (p: PortMapping[]) => void;
}) {
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
              onChange(
                ports.map((x, j) =>
                  j === i
                    ? { ...x, containerPort: parseInt(e.target.value) || 0 }
                    : x,
                ),
              )
            }
            min={1}
            max={65535}
            style={{ ...INP, width: 80, textAlign: "center" }}
          />
          <input
            value={p.name ?? ""}
            onChange={(e) =>
              onChange(
                ports.map((x, j) =>
                  j === i ? { ...x, name: e.target.value } : x,
                ),
              )
            }
            placeholder="name (optional)"
            style={{ ...INP, flex: 1, fontSize: "var(--font-size-xs)" }}
          />
          <button
            onClick={() => onChange(ports.filter((_, j) => j !== i))}
            style={{
              background: "none",
              border: "none",
              color: "var(--ctp-red)",
              cursor: "pointer",
              opacity: 0.6,
              padding: "0 2px",
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
        onClick={() => {
          const used = new Set(ports.map((p) => p.containerPort));
          let next = 8080;
          while (used.has(next)) next++;
          onChange([...ports, { containerPort: next, name: "" }]);
        }}
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
        }}
      >
        + port
      </button>
    </div>
  );
}

// ─── Parse env vars from YAML image string ────────────────────────────────────
// node.image might be "myapp:v2" — we can't read env from it, user provides fresh

// ─── EditFieldModal ───────────────────────────────────────────────────────────

interface Props {
  node: YamlNode;
  onClose: () => void;
}

export function EditFieldModal({ node, onClose }: Props) {
  const projectPath = useIDEStore((s) => s.projectPath);
  const updateNodeFromFile = useIDEStore((s) => s.updateNodeFromFile);

  // Pre-populate from node
  const [image, setImage] = useState(node.image ?? "");
  const [replicas, setReplicas] = useState(node.replicas ?? 1);
  const [namespace, setNamespace] = useState(node.namespace ?? "default");
  const [env, setEnv] = useState<EnvVarPlain[]>([]);
  const [secretEnv, setSecretEnv] = useState<EnvVarPlain[]>([]);
  const [ports, setPorts] = useState<PortMapping[]>([]);
  const [serviceType, setServiceType] = useState<
    "ClusterIP" | "NodePort" | "LoadBalancer"
  >("ClusterIP");
  const [imagePullSecret, setImagePullSecret] = useState("");

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(
    null,
  );
  const imageRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => imageRef.current?.focus(), 60);
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const isImageDeploy =
    node.source === "raw" && !node.file_path?.includes("statefulset");

  const handleUpdate = async () => {
    if (!image.trim() || busy) return;
    setBusy(true);
    setStatus(null);

    try {
      if (isImageDeploy) {
        // For image-deployed services: re-run deployImage (idempotent kubectl apply)
        setStatus({ ok: true, msg: "Updating cluster…" });
        const result = await deployImage({
          namespace,
          name: node.label,
          image: image.trim(),
          replicas,
          env: env.filter((e) => e.key.trim()),
          secretEnv: secretEnv.filter((e) => e.key.trim()),
          ports: ports.filter((p) => p.containerPort > 0),
          serviceType,
          imagePullSecret: imagePullSecret.trim() || undefined,
          createNamespace: false,
        });

        if (result.success) {
          // Overwrite manifests on disk so file_path stays valid
          const fieldDir = node.file_path
            ? node.file_path.substring(0, node.file_path.lastIndexOf("/"))
            : `${projectPath}/apps/${node.label}`;
          const saves: Promise<void>[] = [];
          if (result.manifests.namespace) {
            saves.push(
              saveYamlFile(
                `${fieldDir}/namespace.yaml`,
                result.manifests.namespace,
              ).catch(() => {}),
            );
          }
          if (result.manifests.secret) {
            saves.push(
              saveYamlFile(
                `${fieldDir}/${node.label}-secret.yaml`,
                result.manifests.secret,
              ).catch(() => {}),
            );
          }
          saves.push(
            saveYamlFile(
              `${fieldDir}/deployment.yaml`,
              result.manifests.deployment,
            ).catch(() => {}),
          );
          if (result.manifests.service) {
            saves.push(
              saveYamlFile(
                `${fieldDir}/service.yaml`,
                result.manifests.service,
              ).catch(() => {}),
            );
          }
          await Promise.all(saves);

          setStatus({ ok: true, msg: `Updated — ${node.label} redeployed` });
          setTimeout(onClose, 1000);
        } else {
          setStatus({
            ok: false,
            msg:
              result.error ?? result.stderr.split("\n")[0] ?? "Deploy failed",
          });
        }
      } else {
        // For raw YAML services: re-generate files with new config, then redeploy
        if (!projectPath || !node.file_path) {
          setStatus({ ok: false, msg: "No project path or file_path on node" });
          setBusy(false);
          return;
        }
        setStatus({ ok: true, msg: "Regenerating manifests…" });
        const fieldDir = node.file_path.substring(
          0,
          node.file_path.lastIndexOf("/"),
        );
        const fieldId = node.label;

        const genResult = await generateField({
          id: fieldId,
          label: fieldId,
          namespace,
          image: image.trim(),
          replicas,
          port: ports[0]?.containerPort ?? 8080,
          env: env
            .filter((e) => e.key.trim())
            .map((e) => ({ key: e.key, value: e.value })),
          project_path: projectPath,
        });

        if (genResult.error) {
          setStatus({ ok: false, msg: genResult.error });
          setBusy(false);
          return;
        }

        setStatus({ ok: true, msg: "Deploying to cluster…" });
        const deployResult = await deployResource(
          fieldId,
          "raw",
          fieldDir,
          namespace,
        );

        if (deployResult.success) {
          setStatus({ ok: true, msg: `Updated — ${fieldId} redeployed` });
          setTimeout(onClose, 1000);
        } else {
          setStatus({
            ok: false,
            msg: deployResult.stderr?.split("\n")[0] ?? "kubectl apply failed",
          });
        }
      }
    } catch (e) {
      setStatus({ ok: false, msg: String(e) });
    }

    setBusy(false);
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "var(--blur-sm)",
        WebkitBackdropFilter: "var(--blur-sm)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "var(--bg-modal)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-2xl)",
          width: 480,
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          fontFamily: "var(--font-ui)",
          overflow: "hidden",
          boxShadow:
            "0 24px 64px rgba(0,0,0,0.75), 0 0 0 1px var(--border-subtle)",
          animation: "ef-fadein 0.12s ease-out",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AppIcon
              name="deployImage"
              size={15}
              strokeWidth={1.5}
              style={{ color: "var(--ctp-sapphire)" }}
            />
            <div>
              <span
                style={{
                  color: "var(--text-primary)",
                  fontWeight: 500,
                  fontSize: "var(--font-size-md)",
                }}
              >
                Edit Service
              </span>
              <span
                style={{
                  marginLeft: 8,
                  color: "var(--text-faint)",
                  fontSize: "var(--font-size-xs)",
                  fontFamily: "var(--font-mono)",
                  padding: "1px 6px",
                  borderRadius: "var(--radius-full)",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                {node.label}
              </span>
            </div>
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
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <AppIcon name="close" size={10} strokeWidth={2.5} />
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
          {/* Basic */}
          <div style={SECTION}>
            <SectionTitle>Basic</SectionTitle>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 72px",
                gap: 8,
                marginBottom: 10,
              }}
            >
              <div>
                <label style={LBL}>Image</label>
                <input
                  ref={imageRef}
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleUpdate();
                  }}
                  placeholder="registry.io/repo:tag"
                  style={{
                    ...INP,
                    borderColor: !image.trim()
                      ? "rgba(243,139,168,0.40)"
                      : undefined,
                  }}
                  onFocus={(e) =>
                    ((e.target as HTMLInputElement).style.borderColor =
                      "var(--border-accent)")
                  }
                  onBlur={(e) =>
                    ((e.target as HTMLInputElement).style.borderColor =
                      image.trim()
                        ? "var(--border-default)"
                        : "rgba(243,139,168,0.40)")
                  }
                />
              </div>
              <div>
                <label style={LBL}>Replicas</label>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={replicas}
                  onChange={(e) => setReplicas(parseInt(e.target.value) || 1)}
                  style={{ ...INP, textAlign: "center" }}
                />
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              <div>
                <label style={LBL}>Namespace</label>
                <input
                  value={namespace}
                  onChange={(e) => setNamespace(e.target.value)}
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
                <label style={LBL}>Image Pull Secret</label>
                <input
                  value={imagePullSecret}
                  onChange={(e) => setImagePullSecret(e.target.value)}
                  placeholder="optional"
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
            </div>
          </div>

          {/* Env */}
          <div style={SECTION}>
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
                Secret — stored in K8s Secret
              </div>
              <EnvEditor items={secretEnv} onChange={setSecretEnv} isSecret />
            </div>
          </div>

          {/* Ports */}
          <div style={SECTION}>
            <SectionTitle>Ports & Service</SectionTitle>
            <PortsEditor ports={ports} onChange={setPorts} />
            {ports.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <label style={LBL}>Service Type</label>
                <select
                  value={serviceType}
                  onChange={(e) =>
                    setServiceType(e.target.value as typeof serviceType)
                  }
                  style={{
                    ...INP,
                    cursor: "pointer",
                  }}
                >
                  <option value="ClusterIP">ClusterIP (internal)</option>
                  <option value="NodePort">NodePort</option>
                  <option value="LoadBalancer">LoadBalancer</option>
                </select>
              </div>
            )}
          </div>

          {/* Info about current state */}
          <div
            style={{
              padding: "10px 16px",
              display: "flex",
              gap: 6,
              alignItems: "flex-start",
              background: "rgba(180,190,254,0.04)",
            }}
          >
            <AppIcon
              name="warning"
              size={11}
              strokeWidth={2}
              style={{
                color: "var(--text-faint)",
                marginTop: 1,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                color: "var(--text-faint)",
                fontSize: "var(--font-size-xs)",
                lineHeight: 1.5,
              }}
            >
              Env vars are not pre-filled from existing manifests — set all
              values you need. Empty env will remove existing vars on redeploy.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid var(--border-subtle)",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {status && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                borderRadius: "var(--radius-sm)",
                background: status.ok
                  ? "rgba(166,227,161,0.07)"
                  : "rgba(243,139,168,0.07)",
                border: `1px solid ${status.ok ? "rgba(166,227,161,0.20)" : "rgba(243,139,168,0.20)"}`,
              }}
            >
              <AppIcon
                name={status.ok ? "success" : "error"}
                size={12}
                strokeWidth={2}
                style={{
                  color: status.ok ? "var(--ctp-green)" : "var(--ctp-red)",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: "var(--font-size-xs)",
                  fontFamily: "var(--font-mono)",
                  color: status.ok ? "var(--ctp-green)" : "var(--ctp-red)",
                }}
              >
                {status.msg}
              </span>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                flex: 1,
                padding: "8px 0",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-md)",
                color: "var(--text-muted)",
                fontSize: "var(--font-size-sm)",
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
              onClick={handleUpdate}
              disabled={busy || !image.trim()}
              style={{
                flex: 2.5,
                padding: "8px 0",
                background: busy
                  ? "rgba(180,190,254,0.06)"
                  : "rgba(180,190,254,0.12)",
                border: "1px solid var(--border-accent)",
                borderRadius: "var(--radius-md)",
                color: "var(--accent-alt)",
                fontSize: "var(--font-size-sm)",
                fontWeight: 500,
                cursor: busy || !image.trim() ? "not-allowed" : "pointer",
                fontFamily: "var(--font-ui)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                opacity: busy || !image.trim() ? 0.6 : 1,
                transition: "var(--ease-fast)",
              }}
              onMouseEnter={(e) => {
                if (!busy && image.trim())
                  (e.currentTarget as HTMLElement).style.background =
                    "rgba(180,190,254,0.22)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background =
                  "rgba(180,190,254,0.12)";
              }}
            >
              {busy && (
                <div
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: "50%",
                    border: "1.5px solid rgba(180,190,254,0.3)",
                    borderTopColor: "var(--accent-alt)",
                    animation: "ef-spin 0.7s linear infinite",
                  }}
                />
              )}
              {busy ? "Updating…" : "Update & Redeploy"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
