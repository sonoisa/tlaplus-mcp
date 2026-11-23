import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { SERVER_INFO } from "../src/package-info.js";

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
