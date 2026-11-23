import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { SERVER_INFO } from "../src/package-info.js";

test("README TLC inputs reproduce the published output excerpts", async () => {
  // Tests are compiled into .test-build/test before execution.
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf-8");
  const section = readme.split("**Reproducible examples: bounded counter**")[1]?.split("## Prompts")[0];
  assert.ok(section, "Missing README TLC examples");
  const blocks = [...section.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]!));
  assert.equal(blocks.length, 4, "Expected two input/output pairs");
  const server = createServer();
  const client = new Client({ name: "readme-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    for (const offset of [0, 2]) {
      const expected = blocks[offset + 1];
      const result = await client.callTool({ name: "tlc_check", arguments: blocks[offset] });
      assert.equal(result.isError, !expected.success);
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0]?.text;
      assert.ok(text, JSON.stringify(result));
      const actual = JSON.parse(text);
      assert.equal(typeof actual.rawOutput, "string");
      delete actual.rawOutput;
      for (const state of actual.trace) {
        assert.equal(typeof state.label, "string");
        delete state.label;
      }
      assert.deepEqual(actual, expected);
    }
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP annotations, schemas, validation and input limits remain consistent", async () => {
  const server = createServer();
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    assert.equal(client.getServerVersion()?.version, SERVER_INFO.version);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(),
      ["pluscal_translate", "sany_parse", "tlc_check"]);
    for (const tool of tools) {
      const readOnly = tool.name !== "tlc_check";
      assert.deepEqual(tool.annotations, {
        readOnlyHint: readOnly,
        destructiveHint: !readOnly,
        idempotentHint: readOnly,
        openWorldHint: !readOnly,
      });
      assert.equal(tool.inputSchema.type, "object");
      assert.deepEqual(tool.inputSchema.required, readOnly ? ["spec"] : ["spec", "config"]);
      assert.deepEqual(tool.inputSchema.properties?.spec, {
        type: "string",
        description: tool.name === "pluscal_translate"
          ? "TLA+ specification containing PlusCal algorithm"
          : "TLA+ specification source code",
      });
      for (const specInput of [{}, { spec: 123 }]) {
        const result = await client.callTool({
          name: tool.name,
          arguments: { ...(readOnly ? {} : { config: {} }), ...specInput },
        });
        assert.equal(result.isError, true);
        assert.match(JSON.stringify(result.content), /Input validation error:.*spec/);
      }
    }
    const tlcSchema = tools.find((tool) => tool.name === "tlc_check")!.inputSchema;
    // Compare the public schema without coupling this test to description wording.
    const schemaShape = JSON.parse(JSON.stringify(tlcSchema, (key, value: unknown) =>
      key === "description" || key === "$schema" ? undefined : value));
    assert.deepEqual(schemaShape, {
      type: "object",
      properties: {
        spec: { type: "string" },
        config: {
          type: "object",
          properties: {
            init: { type: "string" },
            next: { type: "string" },
            specification: { type: "string" },
            checkDeadlock: { type: "boolean", default: true },
            invariants: { type: "array", items: { type: "string" } },
            properties: { type: "array", items: { type: "string" } },
            constants: {
              type: "object",
              propertyNames: { type: "string" },
              additionalProperties: { type: "string" },
            },
            symmetry: { type: "string" },
            stateConstraint: { type: "string" },
          },
        },
        workers: { type: "number", default: 1 },
        dumpTrace: { type: "boolean", default: false },
      },
      required: ["spec", "config"],
    });
    const missingConfig = await client.callTool({
      name: "tlc_check", arguments: { spec: "" },
    });
    assert.equal(missingConfig.isError, true);
    assert.match(JSON.stringify(missingConfig.content), /Input validation error:.*config/);
    const oversized = await client.callTool({
      name: "tlc_check",
      arguments: { spec: "", config: { invariants: Array(10_001).fill("TypeOK") } },
    });
    assert.equal(oversized.isError, true);
    assert.match(JSON.stringify(oversized.content), /maximum of 10000 elements/);

    const result = await client.callTool({
      name: "tlc_check",
      arguments: {
        spec: "---- MODULE Constants ----\nEXTENDS Naturals\nCONSTANT N\nVARIABLE x\nInit == x = 0\nNext == x' = IF x < N THEN x + 1 ELSE x\nTypeOK == x \\in 0..N\n====",
        config: { init: "Init", next: "Next", constants: { N: "3" }, invariants: ["TypeOK"] },
      },
    });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    const invalid = await client.callTool({
      name: "tlc_check",
      arguments: { spec: "", config: { constants: { N: 3 } } },
    });
    assert.equal(invalid.isError, true);
    assert.match(JSON.stringify(invalid.content), /Input validation error:.*constants/);
  } finally {
    await client.close();
    await server.close();
  }
});

test("published examples demonstrate a Mutex design error and valid PlusCal", async () => {
  const server = createServer();
  const client = new Client({ name: "examples-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const resource = await client.readResource({ uri: "tlaplus://examples" });
    const content = resource.contents[0];
    assert.ok(content && "text" in content);
    const sections = String(content.text).split(/^## /m);
    const example = (heading: string) => {
      const section = sections.find((section) => section.startsWith(heading));
      assert.ok(section, `Missing example: ${heading}`);
      const spec = section.match(/```tla\n([\s\S]*?)```/)?.[1];
      const options = section.match(/```json\n([\s\S]*?)```/)?.[1];
      assert.ok(spec && options, `Missing source or configuration: ${heading}`);
      return { spec, ...JSON.parse(options) };
    };
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      const blocks = result.content as Array<{ type: string; text?: string }>;
      const text = blocks[0]?.text;
      assert.ok(text, JSON.stringify(result));
      return { isError: result.isError, body: JSON.parse(text) };
    };

    const mutex = example("Mutex:");
    const parsedMutex = await call("sany_parse", { spec: mutex.spec });
    assert.equal(parsedMutex.body.valid, true, JSON.stringify(parsedMutex));
    const failed = await call("tlc_check", mutex);
    assert.equal(failed.isError, true);
    assert.equal(failed.body.success, false);
    assert.deepEqual(failed.body.violation, { type: "invariant", name: "MutualExclusion" });
    const lastState = failed.body.trace.at(-1);
    assert.ok(lastState, "Expected a counterexample trace");
    assert.match(lastState.variables.pc, /0 :> "critical"/);
    assert.match(lastState.variables.pc, /1 :> "critical"/);

    const dining = example("PlusCal Example: Dining Philosophers");
    const translated = await call("pluscal_translate", { spec: dining.spec });
    assert.equal(translated.isError, false, JSON.stringify(translated));
    assert.equal(translated.body.success, true);
    assert.match(translated.body.translated, /BEGIN TRANSLATION/);
    const parsed = await call("sany_parse", { spec: translated.body.translated });
    assert.equal(parsed.body.valid, true, JSON.stringify(parsed));
    const checked = await call("tlc_check", { ...dining, spec: translated.body.translated });
    assert.equal(checked.isError, false, JSON.stringify(checked));
    assert.equal(checked.body.success, true);
    assert.equal(checked.body.violation, null);
    assert.ok(checked.body.states.distinct > 1);
  } finally {
    await client.close();
    await server.close();
  }
});
