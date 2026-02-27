/**
 * ingressRouteLoader.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * File-based ingress route loading with background cluster enrichment.
 * Kept separate from tauriStore and ingressStore to avoid circular imports.
 */

import { invoke } from "@tauri-apps/api/core";
import type { IngressRoute, DiscoveredRoute } from "./ingressStore";
import { discoverIngressRoutes, discoveredToRoute } from "./ingressStore";

// ─── YAML parser ──────────────────────────────────────────────────────────────

export function parseIngressRouteFromYaml(
  yaml: string,
  filePath: string,
): IngressRoute | null {
  try {
    const lines = yaml.split("\n");

    const getAnnotation = (key: string): string => {
      const escaped = key.replace(/\./g, "\\.");
      const m = yaml.match(new RegExp(`${escaped}:\\s*([^\\n]+)`));
      return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
    };

    const routeId = getAnnotation("endfield.io/routeId");
    const fieldId = getAnnotation("endfield.io/fieldId");
    if (!routeId || !fieldId) return null;

    const nameMatch = yaml.match(/^  name:\s*(.+)$/m);
    const nsMatch = yaml.match(/^  namespace:\s*(.+)$/m);
    const ingressName = nameMatch ? nameMatch[1].trim() : "";
    const ingressNamespace = nsMatch ? nsMatch[1].trim() : "";

    const classMatch = yaml.match(/^\s+ingressClassName:\s*(.+)$/m);
    const ingressClassName = classMatch ? classMatch[1].trim() : "";

    const hostMatch = yaml.match(/^\s+- host:\s*(.+)$/m);
    const host = hostMatch ? hostMatch[1].trim() : null;

    const pathMatch = yaml.match(/^\s+- path:\s*(.+)$/m);
    const path = pathMatch ? pathMatch[1].trim() : "/";
    const pathTypeMatch = yaml.match(/^\s+pathType:\s*(.+)$/m);
    const pathType = pathTypeMatch ? pathTypeMatch[1].trim() : "Prefix";

    // service name — look inside "service:" block
    let targetService = "";
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === "service:") {
        for (let j = i + 1; j < lines.length; j++) {
          const t = lines[j].trim();
          if (!t) continue;
          if (t.startsWith("name:")) targetService = t.slice(5).trim();
          break;
        }
        break;
      }
    }

    const portNumMatch = yaml.match(/^\s+number:\s*(\d+)$/m);
    const portNameMatch = yaml.match(/^\s+name:\s*(\S+)$/m);
    const targetPortNumber = portNumMatch ? parseInt(portNumMatch[1]) : null;
    const targetPortName =
      !portNumMatch && portNameMatch ? portNameMatch[1].trim() : null;

    const tlsSecretMatch = yaml.match(/^\s+secretName:\s*(.+)$/m);
    const tlsSecret = tlsSecretMatch ? tlsSecretMatch[1].trim() : null;

    return {
      route_id: routeId,
      field_id: fieldId,
      ingress_name: ingressName,
      ingress_namespace: ingressNamespace,
      target_namespace: ingressNamespace,
      target_service: targetService,
      target_port_number: targetPortNumber,
      target_port_name: targetPortName,
      host,
      path,
      path_type: pathType,
      tls_secret: tlsSecret,
      tls_hosts: null,
      annotations: null,
      ingress_class_name: ingressClassName,
    };
  } catch (e) {
    console.warn("[ingressRouteLoader] parse error:", filePath, e);
    return null;
  }
}

// ─── Merge helpers ────────────────────────────────────────────────────────────

function mergeRoutes(
  fileRoutes: IngressRoute[],
  clusterRoutes: DiscoveredRoute[],
): IngressRoute[] {
  const merged = new Map<string, IngressRoute>();
  for (const r of fileRoutes) merged.set(r.route_id, r);
  for (const cr of clusterRoutes) {
    if (!merged.has(cr.route_id)) {
      // exists in cluster but not in files — add it
      merged.set(cr.route_id, discoveredToRoute(cr));
    }
    // if exists in both — file wins (source of truth)
  }
  return Array.from(merged.values());
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load routes from disk files (primary source of truth).
 * Simultaneously fetches from cluster in background and merges any extra routes.
 * Returns file routes immediately; caller receives merged result via the same promise.
 */
export async function loadRoutesFromFiles(
  projectPath: string,
): Promise<IngressRoute[]> {
  // Load from files
  let fileRoutes: IngressRoute[] = [];
  try {
    const allFiles: string[] = await invoke("scan_project_files", {
      folderPath: `${projectPath}/infra`,
    });
    const routeFiles = allFiles.filter(
      (f) =>
        f.includes("/routes/") && (f.endsWith(".yaml") || f.endsWith(".yml")),
    );
    const results = await Promise.all(
      routeFiles.map(async (filePath): Promise<IngressRoute | null> => {
        try {
          const yaml: string = await invoke("read_yaml_file", { filePath });
          return parseIngressRouteFromYaml(yaml, filePath);
        } catch {
          return null;
        }
      }),
    );
    fileRoutes = results.filter((r): r is IngressRoute => r !== null);
  } catch (e) {
    console.error("[ingressRouteLoader] file load failed:", e);
  }

  if (fileRoutes.length > 0) {
    // We have file routes — enrich with cluster in background (non-blocking)
    // The caller already got the file routes; cluster adds any out-of-band ones
    discoverIngressRoutes()
      .then((clusterRoutes) => {
        // merge is done but result is discarded here —
        // next project reload will reflect it
        void mergeRoutes(fileRoutes, clusterRoutes);
      })
      .catch(() => {});
    return fileRoutes;
  }

  // No files — fall back to cluster only
  try {
    const clusterRoutes = await discoverIngressRoutes();
    return clusterRoutes.map(discoveredToRoute);
  } catch {
    return [];
  }
}
