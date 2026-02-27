/**
 * PostgresConnectionModal.tsx
 * Triggered from the POSTGRES node. User picks which service to connect to.
 * Patches the service deployment YAML and applies via kubectl.
 */

import React, { useState, useEffect } from "react";
import { AppIcon } from "../ui/AppIcon";
import {
  PostgresConfig,
  buildDbEnvVars,
  renderEnvVarsYaml,
  postgresServiceDns,
  postgresServiceName,
  postgresSecretName,
} from "../store/postgresStore";
import {
  YamlNode,
  readYamlFile,
  saveYamlFile,
  kubectlApply,
} from "../store/tauriStore";

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

const DB_BLUE = "#74c7ec";
const DB_BG = "rgba(116,199,236,0.07)";
const DB_BORDER = "rgba(116,199,236,0.28)";

// ─── YAML env injection ───────────────────────────────────────────────────────

/**
 * Extract all "- name: FOO" keys from a YAML env block (within the existing
 * env: section) so we can skip duplicates when appending new vars.
 */
function extractExistingEnvKeys(
  lines: string[],
  envBlockIdx: number,
): Set<string> {
  const keys = new Set<string>();
  const baseIndent =
    lines[envBlockIdx].length - lines[envBlockIdx].trimStart().length;
  for (let i = envBlockIdx + 1; i < lines.length; i++) {
    const nl = lines[i];
    if (!nl.trim()) continue;
    if (nl.length - nl.trimStart().length <= baseIndent) break;
    const m = nl.trim().match(/^-\s+name:\s+(.+)$/);
    if (m) keys.add(m[1].trim());
  }
  return keys;
}

function patchYamlWithEnvVars(
  yaml: string,
  envSnippet: string,
): { patched: string; ok: boolean } {
  const lines = yaml.split("\n");
  let envBlockIdx = -1;
  let insertBeforeIdx = -1;
  let inContainers = false;
  let containerDepth = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;

    if (trimmed === "containers:") {
      inContainers = true;
      containerDepth = indent;
      continue;
    }

    if (inContainers && containerDepth >= 0) {
      if (trimmed === "env:" && indent > containerDepth + 2) {
        envBlockIdx = i;
        break;
      }
      if (
        (trimmed === "resources:" || trimmed.startsWith("volumeMounts:")) &&
        indent > containerDepth + 2 &&
        insertBeforeIdx === -1
      ) {
        insertBeforeIdx = i;
      }
    }
  }

  // Re-indent snippet preserving relative indentation.
  // Target base = 12 spaces (list item inside container spec: "            - name: ...")
  const snippetRaw = envSnippet.split("\n").filter((l) => l.trim());
  if (snippetRaw.length === 0) return { patched: yaml, ok: false };
  const minIndent = Math.min(
    ...snippetRaw.map((l) => l.length - l.trimStart().length),
  );
  const TARGET_BASE = 12;
  const snippetLines = snippetRaw.map(
    (l) =>
      " ".repeat(TARGET_BASE + (l.length - l.trimStart().length - minIndent)) +
      l.trim(),
  );

  if (envBlockIdx >= 0) {
    // Deduplicate: skip vars that already exist in the env block
    const existingKeys = extractExistingEnvKeys(lines, envBlockIdx);
    const newSnippetLines = filterSnippetByKeys(snippetLines, existingKeys);
    if (newSnippetLines.length === 0) return { patched: yaml, ok: true }; // already up-to-date

    // Append to existing env: block — find where block ends
    let insertAt = envBlockIdx + 1;
    const baseIndent =
      lines[envBlockIdx].length - lines[envBlockIdx].trimStart().length;
    while (insertAt < lines.length) {
      const nl = lines[insertAt];
      if (!nl.trim()) {
        insertAt++;
        continue;
      }
      if (nl.length - nl.trimStart().length <= baseIndent) break;
      insertAt++;
    }
    lines.splice(insertAt, 0, ...newSnippetLines);
    return { patched: lines.join("\n"), ok: true };
  }

  if (insertBeforeIdx >= 0) {
    // Insert env: block before resources:/volumeMounts:
    const refLine = lines[insertBeforeIdx];
    const refIndent = " ".repeat(refLine.length - refLine.trimStart().length);
    lines.splice(insertBeforeIdx, 0, `${refIndent}env:`, ...snippetLines);
    return { patched: lines.join("\n"), ok: true };
  }

  // Fallback: insert after first image: line
  const imageIdx = lines.findIndex((l) => l.trim().startsWith("image:"));
  if (imageIdx >= 0) {
    const refLine = lines[imageIdx];
    const refIndent = " ".repeat(refLine.length - refLine.trimStart().length);
    lines.splice(imageIdx + 1, 0, `${refIndent}env:`, ...snippetLines);
    return { patched: lines.join("\n"), ok: true };
  }

  return { patched: yaml, ok: false };
}

/**
 * Given a list of re-indented snippet lines (already at TARGET_BASE indent),
 * remove any env var entries whose key already exists in the provided set.
 * Each env entry is a multi-line block starting with "            - name: KEY".
 */
function filterSnippetByKeys(
  snippetLines: string[],
  existingKeys: Set<string>,
): string[] {
  const result: string[] = [];
  let skipBlock = false;
  for (const line of snippetLines) {
    const m = line.trim().match(/^-\s+name:\s+(.+)$/);
    if (m) {
      skipBlock = existingKeys.has(m[1].trim());
    }
    if (!skipBlock) result.push(line);
  }
  return result;
}

function detectExistingConnection(yaml: string, pg: PostgresConfig) {
  const vars: string[] = [];
  const svcName = postgresServiceName(pg.name);
  const secretName = postgresSecretName(pg.name);
  const dns = postgresServiceDns(pg.name, pg.namespace);
  if (yaml.includes(secretName)) vars.push(`secretRef(${secretName})`);
  if (yaml.includes("DATABASE_URL")) vars.push("DATABASE_URL");
  if (yaml.includes("PGHOST")) vars.push("PGHOST");
  if (
    !vars.includes("DATABASE_URL") &&
    !vars.includes("PGHOST") &&
    (yaml.includes(svcName) || yaml.includes(dns))
  ) {
    vars.push(`host:${svcName}`);
  }
  return { connected: vars.length > 0, vars };
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  postgresNode: YamlNode;
  postgresConfig: PostgresConfig;
  serviceNodes: YamlNode[];
  onClose: () => void;
  onConnect: (
    serviceNodeId: string,
    postgresFieldId: string,
    envVarNames: string[],
  ) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PostgresConnectionModal({
  postgresConfig,
  serviceNodes,
  onClose,
  onConnect,
}: Props) {
  const [selectedServiceId, setSelectedServiceId] = useState<string>(
    serviceNodes[0]?.id ?? "",
  );
  const [useDatabaseUrl, setUseDatabaseUrl] = useState(true);
  const [usePgVars, setUsePgVars] = useState(false);
  const [fullyQualified, setFullyQualified] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">(
    "idle",
  );
  const [statusMsg, setStatusMsg] = useState("");
  const [serviceYaml, setServiceYaml] = useState<string | null>(null);
  const [loadingYaml, setLoadingYaml] = useState(false);

  const selectedService = serviceNodes.find((n) => n.id === selectedServiceId);
  const sameNs = selectedService?.namespace === postgresConfig.namespace;

  useEffect(() => {
    if (!selectedService?.file_path) {
      setServiceYaml(null);
      return;
    }
    setLoadingYaml(true);
    readYamlFile(selectedService.file_path)
      .then(setServiceYaml)
      .catch(() => setServiceYaml(null))
      .finally(() => setLoadingYaml(false));
  }, [selectedServiceId, selectedService?.file_path]);

  const existingConn = serviceYaml
    ? detectExistingConnection(serviceYaml, postgresConfig)
    : null;

  const previewVars = buildDbEnvVars(postgresConfig, {
    useDatabaseUrl,
    usePgVars,
    fullyQualifiedHost: fullyQualified || !sameNs,
    consumerNamespace: selectedService?.namespace ?? postgresConfig.namespace,
  });
  const previewYaml = renderEnvVarsYaml(previewVars);

  const hostDisplay =
    fullyQualified || !sameNs
      ? postgresServiceDns(postgresConfig.name, postgresConfig.namespace)
      : postgresServiceName(postgresConfig.name);

  const handleConnect = async () => {
    if (!selectedService || previewVars.length === 0) return;
    setStatus("saving");
    setStatusMsg("Patching deployment YAML…");
    try {
      const filePath = selectedService.file_path;
      if (!filePath) throw new Error("Service node has no file_path");
      const currentYaml = serviceYaml ?? (await readYamlFile(filePath));
      const { patched, ok } = patchYamlWithEnvVars(currentYaml, previewYaml);
      if (!ok) throw new Error("Could not find container spec in YAML");
      await saveYamlFile(filePath, patched);
      setStatusMsg("Applying to cluster…");
      await kubectlApply(filePath);
      setStatus("done");
      setStatusMsg("Connected!");
      onConnect(
        selectedService.id,
        postgresConfig.fieldId,
        previewVars.map((v) => v.key),
      );
      setTimeout(onClose, 900);
    } catch (e) {
      setStatus("error");
      setStatusMsg(String(e).replace("Error: ", "").split("\n")[0]);
    }
  };

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(17,17,27,0.65)",
          backdropFilter: "var(--blur-md)",
          WebkitBackdropFilter: "var(--blur-md)",
        }}
      />

      <div
        style={{
          position: "relative",
          width: 500,
          maxHeight: "88vh",
          borderRadius: "var(--radius-2xl)",
          background: "var(--bg-modal)",
          border: "1px solid var(--border-default)",
          boxShadow: "var(--shadow-modal)",
          display: "flex",
          flexDirection: "column",
          fontFamily: "var(--font-ui)",
          overflow: "hidden",
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
            <AppIcon
              name="database"
              size={15}
              strokeWidth={1.5}
              style={{ color: DB_BLUE }}
            />
            <span
              style={{
                color: "var(--text-primary)",
                fontWeight: 500,
                fontSize: "var(--font-size-md)",
              }}
            >
              Connect PostgreSQL
            </span>
            <span
              style={{
                color: DB_BLUE,
                fontSize: "var(--font-size-xs)",
                padding: "1px 7px",
                borderRadius: "var(--radius-full)",
                background: DB_BG,
                border: `1px solid ${DB_BORDER}`,
                fontFamily: "var(--font-mono)",
              }}
            >
              {postgresConfig.name}
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
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <AppIcon name="close" size={10} strokeWidth={2.5} />
          </button>
        </div>

        {/* Body */}
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
          {serviceNodes.length === 0 ? (
            <div
              style={{
                padding: "20px",
                textAlign: "center",
                color: "var(--text-faint)",
                fontSize: "var(--font-size-sm)",
              }}
            >
              No service/deployment nodes found.
              <br />
              Add a service first, then connect it to this database.
            </div>
          ) : (
            <>
              {/* Service selector */}
              <div>
                <label style={LBL}>Target Service / Deployment</label>
                <select
                  value={selectedServiceId}
                  onChange={(e) => {
                    setSelectedServiceId(e.target.value);
                    setStatus("idle");
                  }}
                  style={{
                    ...INP,
                    cursor: "pointer",
                    appearance: "none",
                    WebkitAppearance: "none",
                  }}
                >
                  {serviceNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label} ({n.namespace}) — {n.kind}
                    </option>
                  ))}
                </select>
              </div>

              {/* Already connected warning */}
              {existingConn?.connected && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    padding: "8px 11px",
                    background: "rgba(249,226,175,0.07)",
                    border: "1px solid rgba(249,226,175,0.22)",
                    borderRadius: "var(--radius-md)",
                  }}
                >
                  <AppIcon
                    name="warning"
                    size={13}
                    strokeWidth={2}
                    style={{
                      color: "var(--ctp-yellow)",
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  />
                  <div>
                    <div
                      style={{
                        color: "var(--ctp-yellow)",
                        fontSize: "var(--font-size-xs)",
                        fontWeight: 500,
                      }}
                    >
                      Already connected
                    </div>
                    <div
                      style={{
                        color: "var(--text-faint)",
                        fontSize: "var(--font-size-xs)",
                        marginTop: 2,
                      }}
                    >
                      Detected: {existingConn.vars.join(", ")}. Connecting again
                      will add duplicate vars.
                    </div>
                  </div>
                </div>
              )}

              {/* Connection info */}
              {selectedService && (
                <div
                  style={{
                    padding: "10px 12px",
                    background: DB_BG,
                    border: `1px solid ${DB_BORDER}`,
                    borderRadius: "var(--radius-lg)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 5,
                  }}
                >
                  <div
                    style={{
                      color: DB_BLUE,
                      fontSize: "var(--font-size-xs)",
                      fontWeight: 500,
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                      marginBottom: 2,
                    }}
                  >
                    Connection Details
                  </div>
                  {[
                    ["Host", hostDisplay],
                    ["Port", String(postgresConfig.port)],
                    ["Database", postgresConfig.databaseName],
                    ["User", postgresConfig.username],
                    ["Secret", postgresSecretName(postgresConfig.name)],
                    [
                      "Patching file",
                      selectedService.file_path
                        ? selectedService.file_path
                            .split("/")
                            .slice(-2)
                            .join("/")
                        : "(no file)",
                    ],
                  ].map(([k, v]) => (
                    <div
                      key={k}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          color: "var(--text-subtle)",
                          fontSize: "var(--font-size-xs)",
                          flexShrink: 0,
                        }}
                      >
                        {k}
                      </span>
                      <span
                        style={{
                          color: "var(--text-secondary)",
                          fontSize: "var(--font-size-xs)",
                          fontFamily: "var(--font-mono)",
                          textAlign: "right",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {v}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Env var options */}
              <div>
                <label style={LBL}>Inject into service env</label>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 7 }}
                >
                  <Toggle
                    checked={useDatabaseUrl}
                    onChange={setUseDatabaseUrl}
                    label="DATABASE_URL"
                    sub="Single composite connection string (recommended)"
                    color={DB_BLUE}
                  />
                  <Toggle
                    checked={usePgVars}
                    onChange={setUsePgVars}
                    label="PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE"
                    sub="Individual libpq environment variables"
                    color={DB_BLUE}
                  />
                  <Toggle
                    checked={fullyQualified || !sameNs}
                    onChange={sameNs ? setFullyQualified : () => {}}
                    label="Fully-qualified DNS host"
                    sub={
                      sameNs
                        ? "Same namespace — short name works, FQDN is more portable"
                        : "Different namespace — FQDN required"
                    }
                    color={DB_BLUE}
                    disabled={!sameNs}
                  />
                </div>
              </div>

              {/* YAML preview */}
              {previewVars.length > 0 && (
                <div>
                  <label style={LBL}>
                    Env vars →{" "}
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        textTransform: "none",
                      }}
                    >
                      {selectedService?.label}
                    </span>
                  </label>
                  <pre
                    style={{
                      margin: 0,
                      padding: "10px 12px",
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "var(--radius-md)",
                      color: "var(--text-secondary)",
                      fontSize: "var(--font-size-xs)",
                      fontFamily: "var(--font-mono)",
                      overflowX: "auto",
                      lineHeight: 1.6,
                      whiteSpace: "pre",
                    }}
                  >
                    {previewYaml}
                  </pre>
                  <div
                    style={{
                      marginTop: 5,
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      color: "var(--text-faint)",
                      fontSize: "var(--font-size-xs)",
                    }}
                  >
                    <AppIcon
                      name="secret"
                      size={11}
                      strokeWidth={1.75}
                      style={{ color: "var(--ctp-red)" }}
                    />
                    Password via secretKeyRef — never plain text in YAML
                  </div>
                </div>
              )}

              {/* Status */}
              {status !== "idle" && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "7px 10px",
                    borderRadius: "var(--radius-md)",
                    background:
                      status === "error"
                        ? "rgba(243,139,168,0.07)"
                        : status === "done"
                          ? "rgba(166,227,161,0.07)"
                          : "rgba(116,199,236,0.07)",
                    border: `1px solid ${status === "error" ? "rgba(243,139,168,0.25)" : status === "done" ? "rgba(166,227,161,0.25)" : "rgba(116,199,236,0.25)"}`,
                    color:
                      status === "error"
                        ? "var(--ctp-red)"
                        : status === "done"
                          ? "var(--ctp-green)"
                          : DB_BLUE,
                    fontSize: "var(--font-size-xs)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {status === "saving" && (
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        border: `1.5px solid ${DB_BLUE}44`,
                        borderTopColor: DB_BLUE,
                        animation: "ef-spin 0.7s linear infinite",
                        flexShrink: 0,
                      }}
                    />
                  )}
                  {statusMsg}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "11px 16px",
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            gap: 8,
            flexShrink: 0,
          }}
        >
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
            }}
          >
            Cancel
          </button>
          <button
            onClick={
              status === "error" ? () => setStatus("idle") : handleConnect
            }
            disabled={
              !selectedService ||
              previewVars.length === 0 ||
              status === "saving" ||
              status === "done" ||
              loadingYaml
            }
            style={{
              flex: 2.5,
              background:
                status === "done"
                  ? "rgba(166,227,161,0.10)"
                  : status === "error"
                    ? "rgba(243,139,168,0.10)"
                    : DB_BG,
              border: `1px solid ${status === "done" ? "rgba(166,227,161,0.30)" : status === "error" ? "rgba(243,139,168,0.30)" : DB_BORDER}`,
              borderRadius: "var(--radius-md)",
              color:
                status === "done"
                  ? "var(--ctp-green)"
                  : status === "error"
                    ? "var(--ctp-red)"
                    : DB_BLUE,
              fontSize: "var(--font-size-sm)",
              fontWeight: 500,
              padding: "8px 0",
              cursor:
                status === "saving"
                  ? "wait"
                  : status === "done"
                    ? "default"
                    : "pointer",
              fontFamily: "var(--font-ui)",
              opacity:
                !selectedService || previewVars.length === 0 || loadingYaml
                  ? 0.5
                  : 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              transition: "var(--ease-fast)",
            }}
          >
            {status === "saving" && (
              <div
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: "50%",
                  border: `1.5px solid ${DB_BLUE}44`,
                  borderTopColor: DB_BLUE,
                  animation: "ef-spin 0.7s linear infinite",
                }}
              />
            )}
            <AppIcon name="database" size={13} strokeWidth={1.75} />
            {status === "done"
              ? "Connected!"
              : status === "error"
                ? "Retry"
                : "Connect & Patch YAML"}
          </button>
        </div>
      </div>

      <style>{`@keyframes ef-fadein { from { opacity:0; transform:scale(0.97); } to { opacity:1; transform:scale(1); } } @keyframes ef-spin { to { transform:rotate(360deg); } }`}</style>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  sub,
  color,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sub: string;
  color: string;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 9,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        padding: "7px 9px",
        borderRadius: "var(--radius-md)",
        background: checked ? "rgba(116,199,236,0.05)" : "transparent",
        border: `1px solid ${checked ? "rgba(116,199,236,0.20)" : "var(--border-subtle)"}`,
        transition: "all 0.12s ease",
        userSelect: "none",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: color, cursor: "pointer", marginTop: 2 }}
      />
      <div>
        <div
          style={{
            color: checked ? color : "var(--text-secondary)",
            fontSize: "var(--font-size-xs)",
            fontFamily: "var(--font-mono)",
            fontWeight: 500,
          }}
        >
          {label}
        </div>
        <div
          style={{
            color: "var(--text-faint)",
            fontSize: "var(--font-size-xs)",
            marginTop: 2,
          }}
        >
          {sub}
        </div>
      </div>
    </label>
  );
}
