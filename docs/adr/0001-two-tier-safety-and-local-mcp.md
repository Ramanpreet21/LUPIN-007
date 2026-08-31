# 0001. Two-Tier Safety Architecture and Local Read-Only MCP Provider

Date: 2026-08-31

## Status

Accepted

## Context

Autonomous SRE agents have access to shell tools with potential root execution privileges across target infrastructure. Direct LLM execution of unverified shell scripts risks severe outages, destructive disk overwrites (`rm -rf *`, `mkfs`), and security exfiltration.

We needed an architecture that satisfies three constraints:
1. Gives the AI agent sufficient visibility to diagnose incidents without write privileges.
2. Formulates safe remediation commands grounded in live telemetry.
3. Guarantees that no mutating command executes without deterministic safety verification and operator sign-off.

## Decision

We implemented a two-tier safety and tool separation architecture:

1. **Read-Only Model Context Protocol (MCP) Server**:
   - The control plane exposes an embedded JSON-RPC endpoint at `POST /mcp` implementing the MCP standard (`2025-03-26`).
   - The tool catalog (`system_snapshot`, `process_tree`, `net_connections`, `service_status`, `journal_logs`, `file_read`, `dns_lookup`) is strictly read-only.
   - Filesystem reads are restricted to an allowlist (`/etc/nginx/`, `/opt/`, `/usr/local/etc/`) and protected against directory traversal attacks (`..` checks and symlink resolution via `realpath`).

2. **AST Command Scoping & Human Approval Gate**:
   - Remediation commands proposed by the agent are not executed immediately.
   - The control plane parses shell commands into AST tokens, extracts nested command substitutions, checks regex guardrails, and evaluates blast-radius impact.
   - The TrueForge session halts at a `tool.approval_required` gate. The turn only resumes when an operator issues `POST /api/approvals`.

## Alternatives Considered

### 1. Direct LLM Shell Execution with Regex Filtering
- **Description**: Allow the LLM to execute shell commands directly through standard bash tools, running regex filters on the command string.
- **Why it was rejected**: Direct string regex matching is easily bypassed via shell obfuscation, quotes, subshells (`$(...)`), and chained statements. Giving the LLM write tools during the diagnostic phase creates risk before the problem is even understood.

### 2. Sandbox-Only Execution (No Live Target Inspection)
- **Description**: Run diagnosis entirely inside a generic ephemeral container without live host telemetry.
- **Why it was rejected**: Synthetic sandboxes lack real host telemetry (such as specific process PIDs, active network connections, and systemd logs). Diagnoses produced without live telemetry were inaccurate or produced irrelevant remediation scripts.

## Consequences

### Positive
- The agent has full diagnostic visibility with zero write risk during investigation.
- Shell command evaluation is robust against obfuscation and nested substitutions.
- Every state mutation requires explicit operator approval or verified policy pass.
- Rejected turns cleanly cancel active TrueForge sessions, preventing orphaned background tasks.

### Negative
- Human operators must remain available to sign off on approval gates in `STRICT_GATED` mode.
- Additional latency introduced during AST parsing and host telemetry capture.

## Related

- [Architecture Overview](../architecture.md)
- [Safety & Policy Governance](../safety-and-policy.md)
- [API Reference](../api-reference.md)
