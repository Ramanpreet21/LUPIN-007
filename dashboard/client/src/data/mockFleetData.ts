import type { TargetNode } from "@/types/operations";

export const mockFleetData: TargetNode[] = [
  {
    id: "node-relay-04", hostname: "relay-04.lupin.internal", ipAddress: "10.42.8.14", osBadge: "Ubuntu 24.04", cloudProvider: "Hetzner Cloud", status: "CONNECTED", latencyMs: 12, runtimeEngine: "DIRECT_SSH", isAgentExecuting: true, environmentTag: "prod", tags: ["env:prod", "region:us-east-1", "role:relay"],
    authConfig: { keyPath: "~/.ssh/lupin_prod_ed25519", user: "ops", port: 22 }, metrics: { cpuPercent: 28, ramPercent: 41, diskAvailableGb: 184, activeProcesses: 214 }, attachedServices: ["lupin-relay.service", "containerd.service", "nginx.service"],
    commandHistory: [{ id: "cmd-1", time: "09:41", command: "systemctl is-active lupin-relay", outcome: "SUCCESS" }, { id: "cmd-2", time: "09:34", command: "journalctl -u lupin-relay --since -5m", outcome: "SUCCESS" }, { id: "cmd-3", time: "09:22", command: "podman ps --format json", outcome: "SUCCESS" }, { id: "cmd-4", time: "08:58", command: "df -h /var/lib", outcome: "SUCCESS" }, { id: "cmd-5", time: "08:41", command: "systemctl stop sshd", outcome: "BLOCKED" }],
  },
  {
    id: "node-edge-17", hostname: "edge-17.lupin.internal", ipAddress: "172.19.20.17", osBadge: "Fedora CoreOS", cloudProvider: "Equinix Metal", status: "RECONNECTING", latencyMs: 86, runtimeEngine: "PODMAN_SOCKET", isAgentExecuting: false, environmentTag: "edge", tags: ["env:prod", "region:eu-west-2", "role:edge"],
    authConfig: { keyPath: "~/.ssh/lupin_edge_ed25519", user: "core", port: 2222 }, metrics: { cpuPercent: 64, ramPercent: 57, diskAvailableGb: 61, activeProcesses: 96 }, attachedServices: ["zincati.service", "podman.socket", "node-exporter.service"],
    commandHistory: [{ id: "cmd-1", time: "09:39", command: "podman info --format json", outcome: "SUCCESS" }, { id: "cmd-2", time: "09:31", command: "curl -fsS localhost:9100/metrics", outcome: "SUCCESS" }, { id: "cmd-3", time: "09:27", command: "ip route", outcome: "SUCCESS" }, { id: "cmd-4", time: "09:18", command: "systemctl restart node-exporter", outcome: "FAILED" }, { id: "cmd-5", time: "09:04", command: "rpm-ostree status", outcome: "SUCCESS" }],
  },
  {
    id: "node-sandbox-a9", hostname: "twin-a9.sandbox.local", ipAddress: "10.88.0.29", osBadge: "Ubuntu 24.04", cloudProvider: "Local Podman", status: "CONNECTED", latencyMs: 3, runtimeEngine: "PODMAN_SOCKET", isAgentExecuting: true, environmentTag: "ephemeral", tags: ["env:ephemeral", "twin:relay-04", "ttl:42m"],
    authConfig: { keyPath: "ephemeral/session-bound", user: "runner", port: 22 }, metrics: { cpuPercent: 16, ramPercent: 24, diskAvailableGb: 18, activeProcesses: 31 }, attachedServices: ["lupin-runner.service", "podman.socket"],
    commandHistory: [{ id: "cmd-1", time: "09:42", command: "lupin verify --policy prod-safe", outcome: "SUCCESS" }, { id: "cmd-2", time: "09:40", command: "podman exec twin-a9 make validate", outcome: "SUCCESS" }, { id: "cmd-3", time: "09:36", command: "git diff --check", outcome: "SUCCESS" }, { id: "cmd-4", time: "09:28", command: "find /srv/app -type f -delete", outcome: "BLOCKED" }, { id: "cmd-5", time: "09:10", command: "podman inspect twin-a9", outcome: "SUCCESS" }],
  },
  {
    id: "node-staging-02", hostname: "staging-02.lupin.internal", ipAddress: "10.52.1.22", osBadge: "Ubuntu 24.04", cloudProvider: "AWS", status: "UNREACHABLE", latencyMs: 0, runtimeEngine: "DOCKER_DAEMON", isAgentExecuting: false, environmentTag: "staging", tags: ["env:staging", "region:us-east-1", "role:api"],
    authConfig: { keyPath: "~/.ssh/lupin_stage_ed25519", user: "deploy", port: 22 }, metrics: { cpuPercent: 0, ramPercent: 0, diskAvailableGb: 0, activeProcesses: 0 }, attachedServices: ["docker.service", "api-preview.service"],
    commandHistory: [{ id: "cmd-1", time: "09:30", command: "ssh staging-02 uptime", outcome: "FAILED" }, { id: "cmd-2", time: "09:25", command: "docker ps", outcome: "FAILED" }, { id: "cmd-3", time: "09:18", command: "systemctl is-system-running", outcome: "FAILED" }, { id: "cmd-4", time: "09:03", command: "ping -c 2 10.52.1.22", outcome: "FAILED" }, { id: "cmd-5", time: "08:55", command: "lupin connection retry", outcome: "FAILED" }],
  },
  {
    id: "node-k3s-01", hostname: "k3s-control-01.lupin.internal", ipAddress: "10.42.5.11", osBadge: "Ubuntu 24.04", cloudProvider: "AWS", status: "CONNECTED", latencyMs: 24, runtimeEngine: "K8S_POD", isAgentExecuting: false, environmentTag: "prod", tags: ["env:prod", "region:us-east-1", "role:k8s-control"],
    authConfig: { keyPath: "~/.ssh/lupin_k3s_ed25519", user: "k3s", port: 22 }, metrics: { cpuPercent: 37, ramPercent: 52, diskAvailableGb: 93, activeProcesses: 178 }, attachedServices: ["k3s.service", "etcd.service", "cilium-agent"],
    commandHistory: [{ id: "cmd-1", time: "09:38", command: "kubectl get nodes", outcome: "SUCCESS" }, { id: "cmd-2", time: "09:26", command: "kubectl get pods -A", outcome: "SUCCESS" }, { id: "cmd-3", time: "09:19", command: "systemctl stop k3s", outcome: "BLOCKED" }, { id: "cmd-4", time: "09:01", command: "kubectl describe node k3s-control-01", outcome: "SUCCESS" }, { id: "cmd-5", time: "08:46", command: "df -h /var/lib/rancher", outcome: "SUCCESS" }],
  },
];
