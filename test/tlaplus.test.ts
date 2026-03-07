import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import test, { describe } from "node:test";

import {
  extractModuleName,
  generateCfg,
  parseTlcOutput,
  executeSanyParse,
  executePlusCalTranslate,
  executeTlcCheck,
} from "../src/tlaplus.js";

// ─── Unit tests (no Java needed) ────────────────────────────────────────────

describe("extractModuleName", () => {
  test("extracts module name from standard header", () => {
    assert.equal(
      extractModuleName("---- MODULE MySpec ----\nEXTENDS Naturals\n===="),
      "MySpec"
    );
  });

  test("extracts module name with extra dashes", () => {
    assert.equal(
      extractModuleName("-------- MODULE Foo --------\n===="),
      "Foo"
    );
  });

  test("extracts module name with extra spaces", () => {
    assert.equal(
      extractModuleName("----  MODULE  Bar  ----\n===="),
      "Bar"
    );
  });

  test("returns 'Spec' when no module header found", () => {
    assert.equal(extractModuleName("no module here"), "Spec");
  });

  test("returns 'Spec' for empty string", () => {
    assert.equal(extractModuleName(""), "Spec");
  });
});

describe("generateCfg", () => {
  test("generates INIT/NEXT config", () => {
    const cfg = generateCfg({ init: "Init", next: "Next" });
    assert.ok(cfg.includes("INIT Init"));
    assert.ok(cfg.includes("NEXT Next"));
  });

  test("generates SPECIFICATION config", () => {
    const cfg = generateCfg({ specification: "Spec" });
    assert.ok(cfg.includes("SPECIFICATION Spec"));
    assert.ok(!cfg.includes("INIT"));
    assert.ok(!cfg.includes("NEXT"));
  });

  test("SPECIFICATION takes precedence over INIT/NEXT", () => {
    const cfg = generateCfg({
      specification: "Spec",
      init: "Init",
      next: "Next",
    });
    assert.ok(cfg.includes("SPECIFICATION Spec"));
    assert.ok(!cfg.includes("INIT Init"));
  });

  test("generates invariants", () => {
    const cfg = generateCfg({
      init: "Init",
      next: "Next",
      invariants: ["TypeOK", "Safety"],
    });
    assert.ok(cfg.includes("INVARIANT TypeOK"));
    assert.ok(cfg.includes("INVARIANT Safety"));
  });

  test("generates properties", () => {
    const cfg = generateCfg({
      init: "Init",
      next: "Next",
      properties: ["Liveness"],
    });
    assert.ok(cfg.includes("PROPERTY Liveness"));
  });

  test("generates constants", () => {
    const cfg = generateCfg({
      init: "Init",
      next: "Next",
      constants: { N: "3", M: "5" },
    });
    assert.ok(cfg.includes("CONSTANTS"));
    assert.ok(cfg.includes("  N = 3"));
    assert.ok(cfg.includes("  M = 5"));
  });

  test("generates symmetry", () => {
    const cfg = generateCfg({
      init: "Init",
      next: "Next",
      symmetry: "Perms",
    });
    assert.ok(cfg.includes("SYMMETRY Perms"));
  });

  test("generates state constraint", () => {
    const cfg = generateCfg({
      init: "Init",
      next: "Next",
      stateConstraint: "Bounded",
    });
    assert.ok(cfg.includes("CONSTRAINT Bounded"));
  });

  test("generates empty config with just newline", () => {
    const cfg = generateCfg({});
    assert.equal(cfg, "\n");
  });
});

describe("parseTlcOutput", () => {
  test("parses state statistics", () => {
    const output =
      "123 states generated, 45 distinct states found\nThe depth of the complete state graph search is 10";
    const { states } = parseTlcOutput(output);
    assert.deepEqual(states, { found: 123, distinct: 45, depth: 10 });
  });

  test("parses state statistics without depth", () => {
    const output = "50 states generated, 20 distinct states found";
    const { states } = parseTlcOutput(output);
    assert.deepEqual(states, { found: 50, distinct: 20, depth: 0 });
  });

  test("parses deadlock violation", () => {
    const output = "Error: Deadlock reached.";
    const { violation } = parseTlcOutput(output);
    assert.deepEqual(violation, { type: "deadlock" });
  });

  test("parses invariant violation", () => {
    const output = "Error: Invariant TypeOK is violated.";
    const { violation } = parseTlcOutput(output);
    assert.deepEqual(violation, { type: "invariant", name: "TypeOK" });
  });

  test("parses temporal property violation", () => {
    const output = "Error: Temporal properties were violated.";
    const { violation } = parseTlcOutput(output);
    assert.deepEqual(violation, { type: "property", name: undefined });
  });

  test("parses counterexample trace", () => {
    const output = `State 1: <Initial predicate>
/\\ x = 0
/\\ y = 1
State 2: <Next>
/\\ x = 1
/\\ y = 2`;
    const { trace } = parseTlcOutput(output);
    assert.equal(trace.length, 2);
    const s0 = trace[0]!;
    const s1 = trace[1]!;
    assert.equal(s0.stateNum, 1);
    assert.equal(s0.label, "Initial predicate");
    assert.deepEqual(s0.variables, { x: "0", y: "1" });
    assert.equal(s1.stateNum, 2);
    assert.deepEqual(s1.variables, { x: "1", y: "2" });
  });

  test("returns null states and violation for clean output", () => {
    const output = "Model checking completed. No error has been found.";
    const { states, violation, trace } = parseTlcOutput(output);
    assert.equal(states, null);
    assert.equal(violation, null);
    assert.equal(trace.length, 0);
  });
});

// ─── Integration tests (require Java) ───────────────────────────────────────

let hasJava = false;
try {
  execSync("java -version", { stdio: "pipe" });
  hasJava = true;
} catch {
  // Java not available
}

describe(
  "executeSanyParse integration",
  { skip: !hasJava && "Java not available" },
  () => {
    test("parses a valid spec", () => {
      const spec = `---- MODULE Test ----
EXTENDS Naturals
VARIABLE x
Init == x = 0
Next == x' = x + 1
====`;
      const result = executeSanyParse(spec);
      assert.ok(result.valid, `Expected valid but got errors: ${JSON.stringify(result.errors)}`);
      assert.equal(result.errors.length, 0);
    });

    test("detects syntax error in invalid spec", () => {
      const spec = `---- MODULE Bad ----
EXTENDS Naturals
VARIABLE x
Init == x = = 0
====`;
      const result = executeSanyParse(spec);
      assert.ok(!result.valid, "Expected invalid spec");
      assert.ok(result.errors.length > 0 || result.rawOutput.includes("error") || result.rawOutput.includes("Abort"));
    });
  }
);

describe(
  "executePlusCalTranslate integration",
  { skip: !hasJava && "Java not available" },
  () => {
    test("translates a PlusCal spec", () => {
      const spec = `---- MODULE PCalTest ----
EXTENDS Integers

(* --algorithm SimpleAlg {
  variable x = 0;
  {
    start:
      x := x + 1;
  }
} *)
====`;
      const result = executePlusCalTranslate(spec);
      assert.ok(
        result.success,
        `Expected success but got errors: ${JSON.stringify(result.errors)}\nRaw: ${result.rawOutput}`
      );
      assert.ok(result.translated.length > 0);
      assert.ok(result.translated !== spec, "Translated output should differ from input");
    });
  }
);

describe(
  "executeTlcCheck integration",
  { skip: !hasJava && "Java not available" },
  () => {
    test("checks a passing spec", () => {
      const spec = `---- MODULE Pass ----
EXTENDS Naturals
VARIABLE x
Init == x = 0
Next == x' = IF x < 3 THEN x + 1 ELSE x
Spec == Init /\\ [][Next]_x
TypeOK == x \\in 0..3
====`;
      const result = executeTlcCheck(
        spec,
        { init: "Init", next: "Next", invariants: ["TypeOK"], checkDeadlock: false },
        1,
        false
      );
      assert.ok(
        result.success,
        `Expected success but got violation: ${JSON.stringify(result.violation)}\nRaw: ${result.rawOutput}`
      );
    });

    test("detects invariant violation", () => {
      const spec = `---- MODULE Fail ----
EXTENDS Naturals
VARIABLE x
Init == x = 0
Next == x' = x + 1
Bound == x < 3
SmallState == x < 10
====`;
      const result = executeTlcCheck(
        spec,
        {
          init: "Init",
          next: "Next",
          invariants: ["Bound"],
          checkDeadlock: false,
          stateConstraint: "SmallState",
        },
        1,
        false
      );
      assert.ok(!result.success, "Expected failure due to invariant violation");
      assert.ok(result.violation !== null, "Expected a violation");
      assert.equal(result.violation!.type, "invariant");
    });
  }
);
