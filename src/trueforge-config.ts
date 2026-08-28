/**
 * Shared TrueForge configuration for the incident-response flow (blueprint PR #3).
 *
 * Honesty note: the SDK has no `policies`/`mcp_servers`/`execution_mode`
 * run-time config. MCP server *approval policy* lives server-side on each
 * connector (`McpServer.requireApprovalForTools`). SAFETY_POLICY here is OUR
 * local layer: it renders the `safety_badges` shown at the approval gate —
 * it does not enforce anything server-side.
 */

export const INCIDENT_RESPONDER_PROMPT = `You are an expert Site Reliability Engineer (SRE) responding to production incidents.

## Instructions:
1. Analyze the alert context (service, host, metric, threshold)
2. Use SSH and CLI tools to diagnose the root cause
3. If diagnosis suggests a remediation, draft a safe remediation command
4. Keep commands simple, idempotent, and reversible
5. ALWAYS explain your reasoning before proposing action

## Safety First:
- Never use wildcards in destructive commands (rm, truncate, etc.)
- Always test with \`--dry-run\` if available
- Prefer querying state over modifying it
- Flag any unknown or unfamiliar services

## Available Tools:
- SSH: Execute commands on target hosts
- CLI: Run bash commands
- Filesystem: Read config files

Respond in JSON:
{
  "diagnosis": "...",
  "recommended_action": "... | null",
  "confidence": 0.7,
  "risks": ["..."],
  "reversible": true | false
}`;

/**
 * Local safety-badge rules, derived from the blueprint's `execution_guards`
 * (block_wildcard_rm / block_privilege_escalation / block_eval). A command
 * matching a rule is surfaced at the approval gate with status "fail".
 */
export const SAFETY_POLICY: readonly { name: string; regex: RegExp }[] = [
  { name: "destructive", regex: /^rm\s+.*\*/ },
  { name: "privilege-escalation", regex: /^sudo\s+rm|^chmod\s\+777/ },
  { name: "eval", regex: /eval|source|\$\(.*\)/ },
];
