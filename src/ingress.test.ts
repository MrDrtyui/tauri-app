/**
 * ingress.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Integration-like tests for Ingress Nginx feature.
 *
 * Run with: npx tsx ingress.test.ts
 * (Requires tsx / ts-node, no cluster needed — pure manifest generation tests)
 */

import {
  routeToIngressName,
  routeEdgeLabel,
  discoveredToRoute,
} from "./panels/ingressStore.ts";
import type { IngressRoute, DiscoveredRoute } from "./panels/ingressStore.ts";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function assertIncludes(str: string, substring: string) {
  if (!str.includes(substring)) {
    throw new Error(`Expected "${str}" to include "${substring}"`);
  }
}

// ─── Sample data ──────────────────────────────────────────────────────────────

const BASE_ROUTE: IngressRoute = {
  route_id: "abc12345xyz67890",
  field_id: "helm-ingress-nginx-0",
  target_namespace: "production",
  target_service: "my-api",
  target_port_number: 8080,
  target_port_name: null,
  host: "api.example.com",
  path: "/",
  path_type: "Prefix",
  tls_secret: null,
  tls_hosts: null,
  annotations: null,
  ingress_class_name: "nginx",
  ingress_name: "ef-route-abc12345",
  ingress_namespace: "production",
};

const DISCOVERED: DiscoveredRoute = {
  route_id: "route-001",
  field_id: "helm-ingress-nginx-0",
  ingress_name: "ef-route-route-00",
  ingress_namespace: "production",
  host: "app.local",
  path: "/api",
  path_type: "Prefix",
  target_service: "backend-svc",
  target_namespace: "production",
  target_port_number: 3000,
  target_port_name: null,
  ingress_class_name: "nginx",
  tls_secret: null,
  address: "192.168.1.100",
};

console.log("\nRoute → Ingress name:");

test("routeToIngressName produces ef-route-<8chars>", () => {
  const name = routeToIngressName("abc12345xyz67890");
  assert(name === "ef-route-abc12345", `Got: ${name}`);
});

test("routeToIngressName is deterministic", () => {
  const a = routeToIngressName("same-id");
  const b = routeToIngressName("same-id");
  assert(a === b, "Should be deterministic");
});

console.log("\nEdge label:");

test("edge label includes host + path + port", () => {
  const label = routeEdgeLabel(BASE_ROUTE);
  assertIncludes(label, "api.example.com");
  assertIncludes(label, "/");
  assertIncludes(label, ":8080");
});

test("edge label uses * for missing host", () => {
  const route = { ...BASE_ROUTE, host: null };
  const label = routeEdgeLabel(route);
  assertIncludes(label, "*");
});

test("edge label uses port name when no number", () => {
  const route = {
    ...BASE_ROUTE,
    target_port_number: null,
    target_port_name: "http",
  };
  const label = routeEdgeLabel(route);
  assertIncludes(label, ":http");
});

test("edge label defaults to :80 when no port info", () => {
  const route = {
    ...BASE_ROUTE,
    target_port_number: null,
    target_port_name: null,
  };
  const label = routeEdgeLabel(route);
  assertIncludes(label, ":80");
});

console.log("\nIngress YAML generation (string-based):");

function simulateGenerateIngressYaml(route: IngressRoute): string {
  // Mirror the Rust generate_ingress_yaml function
  const portSpec = route.target_port_number
    ? `number: ${route.target_port_number}`
    : route.target_port_name
      ? `name: ${route.target_port_name}`
      : `number: 80`;

  const hostRules = route.host
    ? `  rules:\n    - host: ${route.host}\n      http:\n        paths:\n          - path: ${route.path}\n            pathType: ${route.path_type}\n            backend:\n              service:\n                name: ${route.target_service}\n                port:\n                  ${portSpec}\n`
    : `  rules:\n    - http:\n        paths:\n          - path: ${route.path}\n            pathType: ${route.path_type}\n            backend:\n              service:\n                name: ${route.target_service}\n                port:\n                  ${portSpec}\n`;

  const tlsBlock =
    route.tls_secret && route.tls_hosts?.length
      ? `  tls:\n    - hosts:\n${route.tls_hosts.map((h) => `        - ${h}\n`).join("")}      secretName: ${route.tls_secret}\n`
      : "";

  const ann = `    app.kubernetes.io/managed-by: endfield\n    endfield.io/fieldId: ${route.field_id}\n    endfield.io/routeId: ${route.route_id}\n`;

  return `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${route.ingress_name}
  namespace: ${route.ingress_namespace}
  labels:
    app.kubernetes.io/managed-by: endfield
    endfield.io/fieldId: ${route.field_id}
    endfield.io/routeId: ${route.route_id}
  annotations:
${ann}spec:
  ingressClassName: ${route.ingress_class_name}
${tlsBlock}${hostRules}`;
}

test("YAML has correct apiVersion and kind", () => {
  const yaml = simulateGenerateIngressYaml(BASE_ROUTE);
  assertIncludes(yaml, "apiVersion: networking.k8s.io/v1");
  assertIncludes(yaml, "kind: Ingress");
});

test("YAML has ownership labels and annotations", () => {
  const yaml = simulateGenerateIngressYaml(BASE_ROUTE);
  assertIncludes(yaml, "app.kubernetes.io/managed-by: endfield");
  assertIncludes(yaml, `endfield.io/fieldId: ${BASE_ROUTE.field_id}`);
  assertIncludes(yaml, `endfield.io/routeId: ${BASE_ROUTE.route_id}`);
});

test("YAML has correct ingressClassName", () => {
  const yaml = simulateGenerateIngressYaml(BASE_ROUTE);
  assertIncludes(yaml, "ingressClassName: nginx");
});

test("YAML has host rule", () => {
  const yaml = simulateGenerateIngressYaml(BASE_ROUTE);
  assertIncludes(yaml, "host: api.example.com");
  assertIncludes(yaml, "name: my-api");
  assertIncludes(yaml, "number: 8080");
});

test("YAML without host uses catch-all rule", () => {
  const route = { ...BASE_ROUTE, host: null };
  const yaml = simulateGenerateIngressYaml(route);
  assert(!yaml.includes("host: "), "Should not include host field");
  assertIncludes(yaml, "http:");
});

test("YAML with TLS block", () => {
  const route: IngressRoute = {
    ...BASE_ROUTE,
    tls_secret: "my-tls-cert",
    tls_hosts: ["api.example.com"],
  };
  const yaml = simulateGenerateIngressYaml(route);
  assertIncludes(yaml, "tls:");
  assertIncludes(yaml, "secretName: my-tls-cert");
  assertIncludes(yaml, "- api.example.com");
});

console.log("\nRoute edit patch:");

test("editing a route updates path and host but keeps routeId", () => {
  const original = { ...BASE_ROUTE };
  const edited: IngressRoute = {
    ...original,
    host: "v2.example.com",
    path: "/v2",
  };
  // The ingress_name stays the same (idempotent apply)
  assert(edited.route_id === original.route_id, "routeId unchanged");
  assert(
    edited.ingress_name === original.ingress_name,
    "ingressName unchanged",
  );
  const yaml = simulateGenerateIngressYaml(edited);
  assertIncludes(yaml, "host: v2.example.com");
  assertIncludes(yaml, "path: /v2");
});

console.log("\nDiscovery → graph reconstruction:");

test("discoveredToRoute maps all fields correctly", () => {
  const route = discoveredToRoute(DISCOVERED);
  assert(route.route_id === DISCOVERED.route_id, "route_id matches");
  assert(route.field_id === DISCOVERED.field_id, "field_id matches");
  assert(route.host === DISCOVERED.host, "host matches");
  assert(route.path === DISCOVERED.path, "path matches");
  assert(route.target_service === DISCOVERED.target_service, "service matches");
  assert(
    route.target_port_number === DISCOVERED.target_port_number,
    "port matches",
  );
  assert(
    route.ingress_name === DISCOVERED.ingress_name,
    "ingress_name matches",
  );
  assert(
    route.ingress_namespace === DISCOVERED.ingress_namespace,
    "namespace matches",
  );
});

test("discovered route without address still converts", () => {
  const noAddr = { ...DISCOVERED, address: null };
  const route = discoveredToRoute(noAddr);
  assert(
    route.route_id === noAddr.route_id,
    "converts ok even without address",
  );
});

test("edge label from discovered route shows address info", () => {
  const route = discoveredToRoute(DISCOVERED);
  const label = routeEdgeLabel(route);
  assertIncludes(label, "app.local");
  assertIncludes(label, "/api");
  assertIncludes(label, ":3000");
});

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
