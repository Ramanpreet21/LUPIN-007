# Safety, AST Analysis & Policy Governance

The 007 Incident Command Deck prevents accidental or malicious destruction of infrastructure by enforcing a multi-layered verification system before any command executes.

---

## 1. Safety Architecture Overview

```
                      [ Proposed Agent Command ]
                                  │
                                  ▼
                     [ Quote-Aware Tokenizer ]
                     (shell-parse.ts / command-scope.ts)
                                  │
                                  ▼
                      [ Compound Statement Split ]
                      (handles &&, ;, |, $(...), `...`)
                                  │
          ┌───────────────────────┴───────────────────────┐
          ▼                                               ▼
[ Static Safety Policy ]                        [ Dynamic Policy Store ]
(Regex Invariants)                              (SQLite policy_rules table)
  - Destructive (rm *)                            - DESTRUCTIVE_FS
  - Privilege Escalation (sudo rm)                - PRIVILEGE_ESCALATION
  - Dynamic Code (eval, source)                   - NETWORK_EXFIL
          │                                       - PROCESS_TERMINATION
          │                                               │
          └───────────────────────┬───────────────────────┘
                                  │
                                  ▼
                      [ Blast-Radius Analyzer ]
                      - Affected files
                      - Network sockets & ports
                      - Services modified
                                  │
                                  ▼
                       [ Enforcement Mode Check ]
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        ▼                         ▼                         ▼
 [ STRICT_GATED ]          [ AUTONOMOUS ]             [ DRY_RUN ]
(Wait for human)          (Auto-approve)           (Auto-reject & log)
```

---

## 2. AST Tokenization & Command Decomposition

Raw regex matching on unparsed command strings is vulnerable to shell obfuscation. The control plane uses specialized parsing routines:

1. **Quote-Aware Shell Word Tokenizer (`tokenizeShellWords`)**:
   - Accurately tracks single quotes, double quotes, and backslash escape sequences.
   - Splits attached file redirection operators (e.g. `echo text>/etc/shadow` decomposes into argument `text` and destination `>/etc/shadow`).

2. **Compound Statement Splitter (`splitCompoundStatements`)**:
   - Breaks piped and chained commands (`cmd1 && cmd2 || cmd3 ; cmd4`) into isolated statements.
   - Evaluates policy invariants on every sub-statement independently.

3. **Command Substitution Extraction (`extractCommandSubstitutions`)**:
   - Recursively extracts nested subshells (`$(curl ...)`, `<(...)`, `` `...` ``).
   - Guarantees that hidden payload commands embedded inside arguments are surfaced to the policy engine.

4. **Effective Command Extraction (`effectiveCommand`)**:
   - Strips environment assignments (`ENV_VAR=1`) and wrapper binaries (`sudo -u root`, `nohup`, `nice`, `bash -c`).
   - Normalizes executable names to prevent path-based evasion (e.g., `/bin/rm` is evaluated as `rm`).

---

## 3. Policy Categories & Risk Classification

Rules are grouped into 4 distinct categories:

| Category | Typical Binaries | Target Risks | Default Severity |
|---|---|---|---|
| `DESTRUCTIVE_FS` | `rm`, `mkfs`, `dd`, `fdisk` | File deletion, root wiping, disk format | `CRITICAL_BLOCK` |
| `PRIVILEGE_ESCALATION` | `chmod 777`, `sudoers`, `chown` | Insecure permissions, sudo modification | `REQUIRE_APPROVAL` |
| `NETWORK_EXFIL` | `curl -T`, `wget --post-file` | Unapproved outbound data transfers | `REQUIRE_APPROVAL` |
| `PROCESS_TERMINATION` | `systemctl stop`, `kill -9` | Halting critical systemd units | `REQUIRE_APPROVAL` |

### Composite Risk Scoring

The policy simulator calculates a deterministic composite risk score from 0 to 100:

- **Score 80–100 (Critical)**: Matches at least one `CRITICAL_BLOCK` rule.
- **Score 50–79 (High)**: Matches one or more `REQUIRE_APPROVAL` rules.
- **Score 25–49 (Medium)**: Matches `WARN` rules or contains high-risk flag combinations.
- **Score 0–24 (Low)**: Read-only queries or standard state inspection operations.

---

## 4. Blast-Radius Scoping

The blast-radius engine maps shell arguments against known system resources:

- **Files**: Detects file creation, modification, and deletion paths (`/etc/nginx/nginx.conf`, `/tmp/*`).
- **Services**: Maps `systemctl restart <unit>` to associated service units.
- **Ports & Sockets**: Automatically enriches known service targets with their bound ports (e.g., modifying `nginx` flags ports `80` and `443`, plus `/etc/nginx/`).

---

## 5. Enforcement Modes

The control plane can run in three distinct operational modes (configured via `PUT /api/policy/mode` or database settings):

1. **`STRICT_GATED` (Default)**:
   - Every mutating command halts execution and creates a `pending_approval` event.
   - Requires explicit human operator confirmation via `POST /api/approvals`.

2. **`AUTONOMOUS`**:
   - Commands passing all safety invariants are automatically approved.
   - Recommended only for non-destructive testing environments.

3. **`DRY_RUN`**:
   - Commands are simulated, logged, and automatically rejected without executing against target nodes.
