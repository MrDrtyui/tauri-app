/**
 * ingressStore.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Types and Tauri command wrappers for Ingress Nginx feature.
 * Import this alongside tauriStore.ts.
 */

import { invoke } from "@tauri-apps/api/core";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IngressNginxStatus {
  ingress_class_name: string;
  controller_service_name: string;
  endpoint: string | null;
  ready: boolean;
}

export interface IngressRoute {
  route_id: string;
  field_id: string;
  target_namespace: string;
  target_service: string;
  target_port_number: number | null;
  target_port_name: string | null;
  host: string | null;
  path: string;
  path_type: string;
  tls_secret: string | null;
  tls_hosts: string[] | null;
  annotations: [string, string][] | null;
  ingress_class_name: string;
  ingress_name: string;
  ingress_namespace: string;
}

export interface IngressRouteResult {
  route_id: string;
  ingress_name: string;
  namespace: string;
  stdout: string;
  stderr: string;
  success: boolean;
}

export interface DiscoveredRoute {
  route_id: string;
  field_id: string;
  ingress_name: string;
  ingress_namespace: string;
  host: string | null;
  path: string;
  path_type: string;
  target_service: string;
  target_namespace: string;
  target_port_number: number | null;
  target_port_name: string | null;
  ingress_class_name: string;
  tls_secret: string | null;
  address: string | null;
}

// ─── Tauri command wrappers ───────────────────────────────────────────────────

export async function detectIngressNginx(
  namespace: string,
  releaseName: string,
): Promise<IngressNginxStatus> {
  return invoke("detect_ingress_nginx", {
    namespace,
    releaseName,
  });
}

export async function applyIngressRoute(
  route: IngressRoute,
): Promise<IngressRouteResult> {
  return invoke("apply_ingress_route", { route });
}

export async function getIngressRouteYaml(
  route: IngressRoute,
): Promise<string> {
  return invoke("get_ingress_route_yaml", { route });
}

export async function deleteIngressRoute(
  ingressName: string,
  namespace: string,
): Promise<string> {
  return invoke("delete_ingress_route", { ingressName, namespace });
}

export async function discoverIngressRoutes(): Promise<DiscoveredRoute[]> {
  return invoke("discover_ingress_routes");
}

export async function listServicesInNamespace(
  namespace: string,
): Promise<[string, string[]][]> {
  return invoke("list_services_in_namespace", { namespace });
}

export async function listNamespaces(): Promise<string[]> {
  return invoke("list_namespaces");
}

// ─── Route helpers ────────────────────────────────────────────────────────────

/** Generate a Kubernetes Ingress name from routeId (deterministic) */
export function routeToIngressName(routeId: string): string {
  // Use first 8 chars of route ID for brevity, prefix with "ef-"
  return `ef-route-${routeId.slice(0, 8)}`;
}

/** Format an edge label: host + path + :port */
export function routeEdgeLabel(route: IngressRoute): string {
  const host = route.host ?? "*";
  const port = route.target_port_number
    ? `:${route.target_port_number}`
    : route.target_port_name
      ? `:${route.target_port_name}`
      : ":80";
  return `${host} ${route.path} → ${port}`;
}

/** Build a minimal IngressRoute from a DiscoveredRoute */
export function discoveredToRoute(d: DiscoveredRoute): IngressRoute {
  return {
    route_id: d.route_id,
    field_id: d.field_id,
    target_namespace: d.target_namespace,
    target_service: d.target_service,
    target_port_number: d.target_port_number,
    target_port_name: d.target_port_name,
    host: d.host,
    path: d.path,
    path_type: d.path_type,
    tls_secret: d.tls_secret,
    tls_hosts: null,
    annotations: null,
    ingress_class_name: d.ingress_class_name,
    ingress_name: d.ingress_name,
    ingress_namespace: d.ingress_namespace,
  };
}
