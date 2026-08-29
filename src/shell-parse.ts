/**
 * Quote-aware shell mini-parser, shared by the command-safety layer (5d) and
 * the policy simulation engine (5e). Split out of incident-plane.ts so both
 * depend on one module (no import cycle). It is a deliberate heuristic, not a
 * full shell grammar — see the `ponytail:` note on effectiveCommand.
 */

export interface ShellWordToken {
  /** Unquoted word value (quotes stripped, backslash-escapes kept verbatim). */
  word: string;
  /** Raw offset of the word's first character in the input. */
  start: number;
}

/**
 * Split a command into shell statements, honoring quotes and backslash escapes
 * so separators inside quoted/escaped text are not treated as control operators.
 */
export function splitShellStatements(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaped = false;
  for (const ch of command) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      current += ch;
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "\n" || ch === ";" || ch === "&" || ch === "|") {
      segments.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  segments.push(current.trim());
  return segments.filter((segment) => segment.length > 0);
}

/** Quote-aware shell word tokenizer: a quoted span is one word, spaces inside
 * quotes are not separators, and the value comes back unquoted. */
export function shellWords(input: string): ShellWordToken[] {
  const tokens: ShellWordToken[] = [];
  let current = "";
  let start = -1;
  let inWord = false;
  let quote: string | null = null;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (!inWord) {
        inWord = true;
        start = i;
      }
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      if (!inWord) start = i;
      inWord = true;
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (inWord) {
        tokens.push({ word: current, start });
        current = "";
        start = -1;
        inWord = false;
      }
      continue;
    }
    if (!inWord) {
      inWord = true;
      start = i;
    }
    current += ch;
  }
  if (inWord) tokens.push({ word: current, start });
  return tokens;
}

const ASSIGNMENT_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WRAPPER_WORDS: ReadonlySet<string> = new Set([
  "sudo",
  "env",
  "nohup",
  "time",
  "command",
  "exec",
  "nice",
]);
/** Wrapper options that consume a value token (sudo -u root …, nice -n 5 …). */
const WRAPPER_VALUE_OPTIONS: ReadonlySet<string> = new Set([
  "-u",
  "-g",
  "-C",
  "-n",
  "--user",
  "--group",
]);
const SHELL_LAUNCHERS: ReadonlySet<string> = new Set(["sh", "bash", "zsh", "ksh", "dash", "ash"]);
const executableName = (word: string): string => word.slice(word.lastIndexOf("/") + 1);

/**
 * The effective command of a statement: peel leading environment assignments
 * (NAME=value, export NAME=value) and known wrapper words (sudo, env, nohup,
 * time, command, exec, nice — including their option words), so the
 * start-anchored SAFETY_POLICY regexes see the executable that actually runs
 * instead of a prefix that bypasses them. For `sh -c`/`bash -c`, the -c
 * argument is itself a command and is resolved recursively.
 * ponytail: heuristic word-peeling, not a full shell grammar — redirections
 * and nested substitution can still hide an executable, which a real parser
 * dependency would be needed to fully resolve.
 */
export function effectiveCommand(statement: string): string {
  const tokens = shellWords(statement);
  let i = 0;
  while (i < tokens.length) {
    const { word } = tokens[i];
    if (ASSIGNMENT_PREFIX.test(word)) {
      i += 1;
      continue;
    }
    if (word === "export") {
      if (i + 1 < tokens.length && ASSIGNMENT_PREFIX.test(tokens[i + 1].word)) {
        i += 2;
        continue;
      }
      break;
    }
    if (WRAPPER_WORDS.has(executableName(word))) {
      i += 1;
      while (i < tokens.length && tokens[i].word.startsWith("-")) {
        const flag = tokens[i].word;
        i += WRAPPER_VALUE_OPTIONS.has(flag) && i + 1 < tokens.length ? 2 : 1;
      }
      continue;
    }
    if (SHELL_LAUNCHERS.has(executableName(word))) {
      // sh -c '<cmd>' → the -c argument is the effective command
      let j = i + 1;
      while (j < tokens.length && tokens[j].word.startsWith("-")) {
        const flag = tokens[j].word;
        let cAt = -1;
        for (let k = 1; k < flag.length; k++) {
          if (flag[k] === "c") {
            cAt = k;
            break;
          }
        }
        if (cAt !== -1) {
          if (j + 1 < tokens.length) return effectiveCommand(tokens[j + 1].word);
          break;
        }
        j += 1;
      }
      break; // a bare shell without -c is itself the executable
    }
    break;
  }
  return statement.slice(tokens[i]?.start ?? 0);
}
