import { spawnSync } from "node:child_process";
import {
  writeFileSync,
  readFileSync,
  mkdtempSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ─── JAR path resolution ─────────────────────────────────────────────────────

function findJarPath(): string {
  const jarName = "tla2tools.jar";
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "lib", jarName);
    if (existsSync(candidate)) {
      return candidate;
    }
    dir = dirname(dir);
  }
  throw new Error(`TLA+ JAR not found: ${jarName}`);
}

const jarPath = findJarPath();

// ─── Temp directory helper ───────────────────────────────────────────────────

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "tlaplus-"));
  try {
    return fn(dir);
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  }
}

// ─── Result interfaces ──────────────────────────────────────────────────────

export interface SanyResult {
  valid: boolean;
  errors: Array<{ line: number; message: string }>;
  rawOutput: string;
}

export interface PlusCalResult {
  success: boolean;
  translated: string;
  errors: string[];
  rawOutput: string;
}

export interface TlcViolation {
  type: "invariant" | "deadlock" | "property";
  name?: string | undefined;
}

export interface TlcTraceState {
  stateNum: number;
  label?: string | undefined;
  variables: Record<string, string>;
}

export interface TlcResult {
  success: boolean;
  states: { found: number; distinct: number; depth: number } | null;
  violation: TlcViolation | null;
  trace: TlcTraceState[];
  rawOutput: string;
}

export interface TlcConfig {
  init?: string | undefined;
  next?: string | undefined;
  specification?: string | undefined;
  checkDeadlock?: boolean | undefined;
  invariants?: string[] | undefined;
  properties?: string[] | undefined;
  constants?: Record<string, string> | undefined;
  symmetry?: string | undefined;
  stateConstraint?: string | undefined;
}

// ─── Module name extraction ──────────────────────────────────────────────────

export function extractModuleName(spec: string): string {
  const match = spec.match(/----\s*MODULE\s+(\w+)\s*----/);
  return match?.[1] ?? "Spec";
}

// ─── SANY parse ──────────────────────────────────────────────────────────────

export function executeSanyParse(spec: string): SanyResult {
  return withTempDir((dir) => {
    const moduleName = extractModuleName(spec);
    const specFile = join(dir, `${moduleName}.tla`);
    writeFileSync(specFile, spec);

    const result = spawnSync(
      "java",
      ["-XX:+UseParallelGC", "-cp", jarPath, "tla2sany.SANY", specFile],
      { encoding: "utf-8", timeout: 120_000 }
    );

    const rawOutput = [result.stdout ?? "", result.stderr ?? ""]
      .filter(Boolean)
      .join("\n");

    if (result.error) {
      return {
        valid: false,
        errors: [{ line: 0, message: String(result.error) }],
        rawOutput,
      };
    }

    // Parse errors from output
    const errors: Array<{ line: number; message: string }> = [];
    const errorPattern =
      /(?:line (\d+),?\s*col(?:umn)? \d+[^\n]*\n([^\n]+))|(?:Encountered "([^"]*)" at line (\d+),\s*column \d+[^\n]*)/gi;
    let match;

    while ((match = errorPattern.exec(rawOutput)) !== null) {
      const m1 = match[1];
      const m2 = match[2];
      const m3 = match[3];
      const m4 = match[4];
      if (m1 && m2) {
        errors.push({ line: parseInt(m1, 10), message: m2.trim() });
      } else if (m4) {
        errors.push({
          line: parseInt(m4, 10),
          message: `Encountered "${m3 ?? ""}"`,
        });
      }
    }

    // Also catch "***Abort***" or "Semantic error" patterns
    const abortPattern =
      /(?:Semantic errors?|Abort)[^\n]*\n?\s*line (\d+)[^\n]*/gi;
    while ((match = abortPattern.exec(rawOutput)) !== null) {
      const lineNum = match[1];
      if (lineNum) {
        errors.push({
          line: parseInt(lineNum, 10),
          message: match[0].trim(),
        });
      }
    }

    // Check for generic parse errors without line numbers
    if (
      errors.length === 0 &&
      (rawOutput.includes("***Abort***") ||
        rawOutput.includes("Fatal errors") ||
        rawOutput.includes("Parsing error") ||
        rawOutput.includes("Lexical error"))
    ) {
      const genericErrorMatch = rawOutput.match(
        /(?:Fatal errors|Parsing error|Lexical error|Abort)[^\n]*/
      );
      errors.push({
        line: 0,
        message: genericErrorMatch
          ? genericErrorMatch[0].trim()
          : "Parse error",
      });
    }

    const valid = result.status === 0 && errors.length === 0;

    return { valid, errors, rawOutput };
  });
}

// ─── PlusCal translate ───────────────────────────────────────────────────────

export function executePlusCalTranslate(spec: string): PlusCalResult {
  return withTempDir((dir) => {
    const moduleName = extractModuleName(spec);
    const specFile = join(dir, `${moduleName}.tla`);
    writeFileSync(specFile, spec);

    const result = spawnSync(
      "java",
      ["-XX:+UseParallelGC", "-cp", jarPath, "pcal.trans", specFile],
      { encoding: "utf-8", timeout: 120_000 }
    );

    const rawOutput = [result.stdout ?? "", result.stderr ?? ""]
      .filter(Boolean)
      .join("\n");

    if (result.error) {
      return {
        success: false,
        translated: "",
        errors: [String(result.error)],
        rawOutput,
      };
    }

    // Read the translated file (PlusCal translator modifies in-place)
    let translated = "";
    if (existsSync(specFile)) {
      translated = readFileSync(specFile, "utf-8");
    }

    // Parse errors
    const errors: string[] = [];
    const errorPattern = /(?:Unrecoverable error|error:)[^\n]*/gi;
    let match;
    while ((match = errorPattern.exec(rawOutput)) !== null) {
      errors.push(match[0].trim());
    }

    // Check if translation actually happened
    const success =
      errors.length === 0 &&
      result.status === 0 &&
      translated !== spec &&
      translated.length > 0;

    return { success, translated, errors, rawOutput };
  });
}

// ─── TLC config generation ──────────────────────────────────────────────────

export function generateCfg(config: TlcConfig): string {
  const lines: string[] = [];

  if (config.specification) {
    lines.push(`SPECIFICATION ${config.specification}`);
  } else {
    if (config.init) lines.push(`INIT ${config.init}`);
    if (config.next) lines.push(`NEXT ${config.next}`);
  }

  if (config.invariants) {
    for (const inv of config.invariants) {
      lines.push(`INVARIANT ${inv}`);
    }
  }

  if (config.properties) {
    for (const prop of config.properties) {
      lines.push(`PROPERTY ${prop}`);
    }
  }

  if (config.constants) {
    lines.push("CONSTANTS");
    for (const [name, value] of Object.entries(config.constants)) {
      lines.push(`  ${name} = ${value}`);
    }
  }

  if (config.symmetry) {
    lines.push(`SYMMETRY ${config.symmetry}`);
  }

  if (config.stateConstraint) {
    lines.push(`CONSTRAINT ${config.stateConstraint}`);
  }

  return lines.join("\n") + "\n";
}

// ─── TLC output parsing ─────────────────────────────────────────────────────

export function parseTlcOutput(rawOutput: string): {
  states: TlcResult["states"];
  violation: TlcResult["violation"];
  trace: TlcTraceState[];
} {
  let states: TlcResult["states"] = null;
  let violation: TlcResult["violation"] = null;
  const trace: TlcTraceState[] = [];

  // Parse state statistics
  const statsMatch = rawOutput.match(
    /(\d+) states generated, (\d+) distinct states found/
  );
  if (statsMatch) {
    const depthMatch = rawOutput.match(
      /The depth of the complete state graph search is (\d+)/
    );
    states = {
      found: parseInt(statsMatch[1] ?? "0", 10),
      distinct: parseInt(statsMatch[2] ?? "0", 10),
      depth: depthMatch ? parseInt(depthMatch[1] ?? "0", 10) : 0,
    };
  }

  // Parse violations
  if (rawOutput.includes("Deadlock reached")) {
    violation = { type: "deadlock" };
  } else {
    const invMatch = rawOutput.match(/Invariant (\w+) is violated/);
    if (invMatch?.[1]) {
      violation = { type: "invariant", name: invMatch[1] };
    } else if (rawOutput.includes("Temporal properties were violated")) {
      const propMatch = rawOutput.match(
        /(?:Temporal property|Property) (\w+) is violated/
      );
      violation = {
        type: "property",
        name: propMatch?.[1],
      };
    }
  }

  // Parse counterexample trace
  // TLC output format: "State N: <label>\n/\ var1 = val1\n/\ var2 = val2\n"
  const stateBlocks = rawOutput.split(/(?=State \d+:)/);

  for (const block of stateBlocks) {
    const headerMatch = block.match(/State (\d+): <([^>]+)>/);
    if (!headerMatch?.[1] || !headerMatch[2]) continue;

    const stateNum = parseInt(headerMatch[1], 10);
    const label = headerMatch[2].trim();
    const variables: Record<string, string> = {};

    // Parse variable assignments
    const varPattern = /(?:\/\\\s+)?(\w+)\s*=\s*(.+)/g;
    const body = block.substring(block.indexOf("\n") + 1);
    let varMatch;
    while ((varMatch = varPattern.exec(body)) !== null) {
      const varName = varMatch[1];
      const varValue = varMatch[2];
      if (!varName || !varValue) continue;
      if (varName === "State" || varName === "Error") continue;
      variables[varName] = varValue.trim();
    }

    if (Object.keys(variables).length > 0) {
      trace.push({ stateNum, label, variables });
    }
  }

  return { states, violation, trace };
}

// ─── TLC model check ────────────────────────────────────────────────────────

export function executeTlcCheck(
  spec: string,
  config: TlcConfig,
  workers: number,
  dumpTrace: boolean
): TlcResult {
  return withTempDir((dir) => {
    const moduleName = extractModuleName(spec);
    const specFile = join(dir, `${moduleName}.tla`);
    const cfgFile = join(dir, `${moduleName}.cfg`);

    writeFileSync(specFile, spec);
    writeFileSync(cfgFile, generateCfg(config));

    const args = [
      "-XX:+UseParallelGC",
      "-cp",
      jarPath,
      "tlc2.TLC",
      "-workers",
      String(workers),
      "-cleanup",
    ];

    if (config.checkDeadlock === false) {
      args.push("-deadlock");
    }

    if (dumpTrace) {
      args.push("-dumpTrace", "json", join(dir, "trace.json"));
    }

    args.push(specFile);

    const result = spawnSync("java", args, {
      encoding: "utf-8",
      timeout: 120_000,
      cwd: dir,
    });

    const rawOutput = [result.stdout ?? "", result.stderr ?? ""]
      .filter(Boolean)
      .join("\n");

    if (result.error) {
      return {
        success: false,
        states: null,
        violation: null,
        trace: [],
        rawOutput: String(result.error),
      };
    }

    const parsed = parseTlcOutput(rawOutput);

    // If dumpTrace was requested, try to read the trace JSON
    if (dumpTrace) {
      const traceFile = join(dir, "trace.json");
      if (existsSync(traceFile)) {
        try {
          const traceJson = JSON.parse(readFileSync(traceFile, "utf-8"));
          return {
            success: parsed.violation === null && result.status === 0,
            ...parsed,
            rawOutput:
              rawOutput +
              "\n\n--- Trace JSON ---\n" +
              JSON.stringify(traceJson, null, 2),
          };
        } catch {
          /* ignore JSON parse errors */
        }
      }
    }

    const success =
      parsed.violation === null &&
      (result.status === 0 || rawOutput.includes("Model checking completed"));

    return { success, ...parsed, rawOutput };
  });
}
