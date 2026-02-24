/**
 * IngressRouteModal.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Modal dialog for creating and editing Ingress routes.
 * Wired from IngressNginx node context menu and side panel.
 */

import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { AppIcon } from "../ui/AppIcon";
import {
  IngressRoute,
  applyIngressRoute,
  listServicesInNamespace,
  listNamespaces,
  routeToIngressName,
  routeEdgeLabel,
} from "./ingressStore";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function genId(): string {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label
        style={{
          fontSize: "var(--font-size-xs)",
          color: "var(--text-muted)",
          fontFamily: "var(--font-ui)",
          fontWeight: 500,
          letterSpacing: "0.03em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <div
          style={{
            fontSize: 10,
            color: "var(--text-faint)",
            fontFamily: "var(--font-ui)",
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-sm)",
        color: "var(--text-primary)",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)",
        fontSize: "var(--font-size-sm)",
        padding: "5px 8px",
        outline: "none",
        width: "100%",
        boxSizing: "border-box",
      }}
    />
  );
}

function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-sm)",
        color: value ? "var(--text-primary)" : "var(--text-faint)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--font-size-sm)",
        padding: "5px 8px",
        outline: "none",
        width: "100%",
        cursor: "pointer",
      }}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface IngressRouteModalProps {
  fieldId: string;
  ingressClassName: string;
  /** Existing route to edit — null means create new */
  existing?: IngressRoute | null;
  onSave: (route: IngressRoute) => void;
  onClose: () => void;
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function IngressRouteModal({
  fieldId,
  ingressClassName,
  existing,
  onSave,
  onClose,
}: IngressRouteModalProps) {
  const isEdit = !!existing;

  // Form state
  const [targetNs, setTargetNs] = useState(existing?.target_namespace ?? "");
  const [targetSvc, setTargetSvc] = useState(existing?.target_service ?? "");
  const [portNum, setPortNum] = useState(
    existing?.target_port_number?.toString() ?? "",
  );
  const [portName, setPortName] = useState(existing?.target_port_name ?? "");
  const [host, setHost] = useState(existing?.host ?? "");
  const [path, setPath] = useState(existing?.path ?? "/");
  const [pathType, setPathType] = useState(existing?.path_type ?? "Prefix");
  const [tlsSecret, setTlsSecret] = useState(existing?.tls_secret ?? "");
  const [tlsHosts, setTlsHosts] = useState(
    existing?.tls_hosts?.join(", ") ?? "",
  );
  const [annRaw, setAnnRaw] = useState(
    existing?.annotations?.map(([k, v]) => `${k}: ${v}`).join("\n") ?? "",
  );
  const [overrideClass, setOverrideClass] = useState(
    existing?.ingress_class_name ?? ingressClassName,
  );
  const [ingressNs, setIngressNs] = useState(
    existing?.ingress_namespace ?? targetNs,
  );

  // Dynamic data
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [services, setServices] = useState<[string, string[]][]>([]);
  const [selectedSvcPorts, setSelectedSvcPorts] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load namespaces on mount
  useEffect(() => {
    listNamespaces()
      .then(setNamespaces)
      .catch(() => {});
  }, []);

  // Load services when namespace changes
  useEffect(() => {
    if (!targetNs) return;
    setLoading(true);
    listServicesInNamespace(targetNs)
      .then((svcs) => {
        setServices(svcs);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    // Auto-set ingressNs to targetNs (K8s best practice)
    if (!isEdit) setIngressNs(targetNs);
  }, [targetNs, isEdit]);

  // Update available ports when service selection changes
  useEffect(() => {
    const svc = services.find(([name]) => name === targetSvc);
    setSelectedSvcPorts(svc ? svc[1] : []);
  }, [targetSvc, services]);

  const parseAnnotations = (): [string, string][] => {
    return annRaw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && line.includes(":"))
      .map((line) => {
        const idx = line.indexOf(":");
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()] as [
          string,
          string,
        ];
      });
  };

  const validate = (): string | null => {
    if (!targetNs) return "Target namespace is required";
    if (!targetSvc) return "Target service is required";
    if (!portNum && !portName) return "Provide a port number or name";
    if (!path) return "Path is required";
    if (!/^\//.test(path)) return "Path must start with /";
    if (host && !/^[\w.-]+$/.test(host))
      return "Invalid host format (use e.g. app.example.com)";
    return null;
  };

  const handleSave = useCallback(async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setSaving(true);
    setError(null);

    const routeId = existing?.route_id ?? genId();
    const ingressName = existing?.ingress_name ?? routeToIngressName(routeId);
    const parsedTlsHosts = tlsHosts
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);

    const route: IngressRoute = {
      route_id: routeId,
      field_id: fieldId,
      target_namespace: targetNs,
      target_service: targetSvc,
      target_port_number: portNum ? parseInt(portNum, 10) : null,
      target_port_name: portNum ? null : portName || null,
      host: host || null,
      path,
      path_type: pathType,
      tls_secret: tlsSecret || null,
      tls_hosts: parsedTlsHosts.length > 0 ? parsedTlsHosts : null,
      annotations: annRaw.trim() ? parseAnnotations() : null,
      ingress_class_name: overrideClass || ingressClassName,
      ingress_name: ingressName,
      ingress_namespace: ingressNs || targetNs,
    };

    try {
      const result = await applyIngressRoute(route);
      if (!result.success) {
        setError(result.stderr || "Apply failed");
        setSaving(false);
        return;
      }
      onSave(route);
    } catch (e: unknown) {
      setError(String(e));
      setSaving(false);
    }
  }, [
    validate,
    existing,
    fieldId,
    targetNs,
    targetSvc,
    portNum,
    portName,
    host,
    path,
    pathType,
    tlsSecret,
    tlsHosts,
    annRaw,
    overrideClass,
    ingressNs,
    ingressClassName,
    onSave,
  ]);

  const previewLabel = (() => {
    if (!targetSvc) return "";
    const fakeRoute: IngressRoute = {
      route_id: "preview",
      field_id: fieldId,
      target_namespace: targetNs,
      target_service: targetSvc,
      target_port_number: portNum ? parseInt(portNum, 10) : null,
      target_port_name: portNum ? null : portName || null,
      host: host || null,
      path: path || "/",
      path_type: pathType,
      tls_secret: null,
      tls_hosts: null,
      annotations: null,
      ingress_class_name: overrideClass,
      ingress_name: "preview",
      ingress_namespace: ingressNs,
    };
    return routeEdgeLabel(fakeRoute);
  })();

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(4px)",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--bg-modal)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-lg)",
          padding: "24px",
          width: 520,
          maxWidth: "90vw",
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "var(--shadow-lg)",
          fontFamily: "var(--font-ui)",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "#89b4fa", display: "flex" }}>
              <AppIcon name="ingress" size={18} strokeWidth={1.75} />
            </span>
            <div>
              <div
                style={{
                  color: "var(--text-primary)",
                  fontSize: "var(--font-size-md)",
                  fontWeight: 600,
                }}
              >
                {isEdit ? "Edit Ingress Route" : "Create Ingress Route"}
              </div>
              <div
                style={{
                  color: "var(--text-faint)",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                }}
              >
                ingressClassName: {overrideClass}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-faint)",
              cursor: "pointer",
              display: "flex",
            }}
          >
            <AppIcon name="close" size={16} strokeWidth={2} />
          </button>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "var(--border-subtle)" }} />

        {/* Target */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--ctp-blue)",
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            Target Service
          </div>

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <Field label="Namespace" hint="Namespace of the target Service">
              <Select
                value={targetNs}
                onChange={setTargetNs}
                options={namespaces}
                placeholder="Select namespace…"
              />
            </Field>
            <Field label="Service">
              <Select
                value={targetSvc}
                onChange={setTargetSvc}
                options={services.map(([n]) => n)}
                placeholder={loading ? "Loading…" : "Select service…"}
              />
            </Field>
          </div>

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <Field label="Port Number">
              <Select
                value={portNum}
                onChange={(v) => {
                  setPortNum(v);
                  if (v) setPortName("");
                }}
                options={selectedSvcPorts}
                placeholder="Select port…"
              />
            </Field>
            <Field label="Port Name" hint="Alternative to port number">
              <Input
                value={portName}
                onChange={(v) => {
                  setPortName(v);
                  if (v) setPortNum("");
                }}
                placeholder="e.g. http"
              />
            </Field>
          </div>
        </div>

        <div style={{ height: 1, background: "var(--border-subtle)" }} />

        {/* Routing */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--ctp-blue)",
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            Routing Rules
          </div>

          <Field label="Host" hint="Leave empty to match all hosts">
            <Input
              value={host}
              onChange={setHost}
              placeholder="app.example.com"
            />
          </Field>

          <div
            style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}
          >
            <Field label="Path">
              <Input value={path} onChange={setPath} placeholder="/" mono />
            </Field>
            <Field label="Path Type">
              <Select
                value={pathType}
                onChange={setPathType}
                options={["Prefix", "Exact", "ImplementationSpecific"]}
              />
            </Field>
          </div>
        </div>

        <div style={{ height: 1, background: "var(--border-subtle)" }} />

        {/* Advanced */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--ctp-mauve)",
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            Advanced (Optional)
          </div>

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <Field label="TLS Secret Name">
              <Input
                value={tlsSecret}
                onChange={setTlsSecret}
                placeholder="my-tls-secret"
              />
            </Field>
            <Field label="TLS Hosts" hint="Comma separated">
              <Input
                value={tlsHosts}
                onChange={setTlsHosts}
                placeholder="app.example.com"
              />
            </Field>
          </div>

          <Field label="Annotations" hint="One per line: key: value">
            <textarea
              value={annRaw}
              onChange={(e) => setAnnRaw(e.target.value)}
              placeholder="nginx.ingress.kubernetes.io/rewrite-target: /"
              rows={3}
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-primary)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--font-size-xs)",
                padding: "5px 8px",
                outline: "none",
                width: "100%",
                boxSizing: "border-box",
                resize: "vertical",
              }}
            />
          </Field>

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <Field
              label="Ingress Namespace"
              hint="Where Ingress resource lives"
            >
              <Select
                value={ingressNs}
                onChange={setIngressNs}
                options={namespaces}
                placeholder="Same as service…"
              />
            </Field>
            <Field label="IngressClass Override">
              <Input
                value={overrideClass}
                onChange={setOverrideClass}
                placeholder={ingressClassName}
              />
            </Field>
          </div>
        </div>

        {/* Preview */}
        {previewLabel && (
          <div
            style={{
              background: "rgba(137,180,250,0.06)",
              border: "1px solid rgba(137,180,250,0.18)",
              borderRadius: "var(--radius-sm)",
              padding: "8px 12px",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ color: "var(--ctp-blue)", display: "flex" }}>
              <AppIcon name="arrowRight" size={12} strokeWidth={2} />
            </span>
            <span
              style={{
                fontSize: "var(--font-size-xs)",
                color: "var(--text-secondary)",
                fontFamily: "var(--font-mono)",
              }}
            >
              Edge label preview: <strong>{previewLabel}</strong>
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              background: "rgba(243,139,168,0.08)",
              border: "1px solid rgba(243,139,168,0.25)",
              borderRadius: "var(--radius-sm)",
              padding: "8px 12px",
              color: "var(--ctp-red)",
              fontSize: "var(--font-size-xs)",
              fontFamily: "var(--font-ui)",
            }}
          >
            {error}
          </div>
        )}

        {/* Actions */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            paddingTop: 4,
          }}
        >
          <ActionButton onClick={onClose} disabled={saving}>
            Cancel
          </ActionButton>
          <ActionButton onClick={handleSave} primary disabled={saving}>
            {saving ? "Applying…" : isEdit ? "Save Changes" : "Create Route"}
          </ActionButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ActionButton({
  children,
  onClick,
  primary,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        height: 30,
        padding: "0 14px",
        background: primary
          ? hov
            ? "rgba(137,180,250,0.25)"
            : "rgba(137,180,250,0.14)"
          : hov
            ? "var(--bg-elevated)"
            : "transparent",
        border: primary
          ? "1px solid rgba(137,180,250,0.4)"
          : "1px solid var(--border-default)",
        borderRadius: "var(--radius-sm)",
        color: primary ? "#89b4fa" : "var(--text-muted)",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: "var(--font-size-sm)",
        fontFamily: "var(--font-ui)",
        fontWeight: primary ? 500 : 400,
        opacity: disabled ? 0.5 : 1,
        transition: "var(--ease-fast)",
      }}
    >
      {children}
    </button>
  );
}
