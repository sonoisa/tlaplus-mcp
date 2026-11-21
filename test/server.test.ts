import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { SERVER_INFO } from "../src/package-info.js";

test("MCP schemas, validation and input limits survive dependency upgrades", async () => {
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
      assert.equal(tool.inputSchema.type, "object");
      assert.ok(tool.inputSchema.required?.includes("spec"));
      const result = await client.callTool({ name: tool.name, arguments: { spec: 123 } });
      assert.equal(result.isError, true);
    }
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
  } finally {
    await client.close();
    await server.close();
  }
});
