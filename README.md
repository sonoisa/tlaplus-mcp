# tlaplus-mcp

[![M8ven Verified](https://m8ven.ai/badge/mcp/tlaplus-mcp-eypuyk?variant=verified)](https://m8ven.ai/mcp/tlaplus-mcp-eypuyk?s=readme)

A TLA+ model checking MCP server that provides syntax checking (SANY), PlusCal translation, and TLC model checking via the Model Context Protocol.

## Requirements

- Node.js >= 18
- pnpm 10.30.3 (for development)
- Java >= 17 (required to run `tla2tools.jar`)

## Setup

```bash
pnpm install
pnpm run build
```

## Development Commands

```bash
pnpm run dev        # Development mode (tsx watch)
pnpm run build      # TypeScript build
pnpm test           # Run tests
pnpm run pack:check  # Check package contents
```

## MCP Client Configuration

Local build:

```json
{
  "mcpServers": {
    "tlaplus": {
      "command": "node",
      "args": ["/absolute/path/to/tlaplus-mcp/build/index.js"]
    }
  }
}
```

Via pnpm:

```json
{
  "mcpServers": {
    "tlaplus": {
      "command": "pnpm",
      "args": ["dlx", "tlaplus-mcp"]
    }
  }
}
```

## Tools

Tool arguments are limited to 10,000 total object keys and array elements per call.
Calls exceeding this limit are rejected before schema validation or tool execution.

### `sany_parse`

Parse and syntax-check a TLA+ specification using SANY.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `spec` | `string` (required) | TLA+ specification source code |

**Example input:**

```tla
---- MODULE Counter ----
EXTENDS Naturals
VARIABLE count
Init == count = 0
Next == count' = count + 1
====
```

**Example output (abbreviated; `...` marks omitted text):**

```json
{
  "valid": true,
  "errors": [],
  "rawOutput": "..."
}
```

### `pluscal_translate`

Translate a PlusCal algorithm embedded in a TLA+ specification into TLA+.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `spec` | `string` (required) | TLA+ specification containing PlusCal algorithm |

**Example input:**

```tla
---- MODULE SimpleAlg ----
EXTENDS Integers
(* --algorithm SimpleAlg {
  variable x = 0;
  { start: x := x + 1; }
} *)
====
```

**Example output (abbreviated; `...` marks omitted text):**

```json
{
  "success": true,
  "translated": "---- MODULE SimpleAlg ----\n...",
  "errors": [],
  "rawOutput": "..."
}
```

### `tlc_check`

Run the TLC model checker on a TLA+ specification to verify invariants and temporal properties.

Specifications can use modules such as `Json` to read and overwrite host files accessible to the Java process, including files outside the temporary working directory. Repeating the same call can cause additional changes. Accordingly, `tlc_check` declares `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`, and `openWorldHint: true`. These annotations describe behavior; they do not restrict file access.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `spec` | `string` (required) | TLA+ specification source code |
| `config` | `object` (required) | TLC model checking configuration |
| `config.init` | `string` | Init predicate name (e.g. `"Init"`) |
| `config.next` | `string` | Next predicate name (e.g. `"Next"`) |
| `config.specification` | `string` | SPECIFICATION name (alternative to init/next) |
| `config.checkDeadlock` | `boolean` | Whether to check for deadlock (default: `true`) |
| `config.invariants` | `string[]` | Invariant names to check |
| `config.properties` | `string[]` | Temporal property names to check |
| `config.constants` | `Record<string, string>` | CONSTANT assignments (e.g. `{"N": "3"}`) |
| `config.symmetry` | `string` | SYMMETRY set name |
| `config.stateConstraint` | `string` | State constraint expression |
| `workers` | `number` | Number of worker threads (default: `1`) |
| `dumpTrace` | `boolean` | Dump counterexample trace as JSON (default: `false`) |

**Reproducible examples: bounded counter**

The same model is checked in both examples. It starts at zero, increments to
three, and then stays at three. `TypeOK` holds in every reachable state;
`BelowThree` deliberately fails when `x = 3`.

Pass each JSON object below as the arguments to `tlc_check`. The `spec` field
contains the complete TLA+ source; no separate file is needed. Both examples use
one worker and keep the default deadlock check enabled.

The outputs are actual results from the bundled TLC, shown as excerpts of the
JSON inside the MCP response's `content[0].text`. `rawOutput` and trace `label`
fields are omitted. The MCP response has `isError: false` for the successful
check and `isError: true` for the intentional invariant violation. State counts
and diagnostic labels may change with TLC versions or execution settings.

**Example input (success):**

```json
{
  "spec": "---- MODULE BoundedCounter ----\nEXTENDS Naturals\nVARIABLE x\nInit == x = 0\nNext == x' = IF x < 3 THEN x + 1 ELSE x\nTypeOK == x \\in 0..3\nBelowThree == x < 3\n====",
  "config": {
    "init": "Init",
    "next": "Next",
    "invariants": [
      "TypeOK"
    ]
  },
  "workers": 1,
  "dumpTrace": false
}
```

**Example output (success, excerpt):**

```json
{
  "success": true,
  "states": {
    "found": 5,
    "distinct": 4,
    "depth": 4
  },
  "violation": null,
  "trace": []
}
```

**Example input (intentional violation):**

Only the invariant changes to `BelowThree`. The expected counterexample is
`x = 0 → 1 → 2 → 3`, showing why `x < 3` does not hold.

```json
{
  "spec": "---- MODULE BoundedCounter ----\nEXTENDS Naturals\nVARIABLE x\nInit == x = 0\nNext == x' = IF x < 3 THEN x + 1 ELSE x\nTypeOK == x \\in 0..3\nBelowThree == x < 3\n====",
  "config": {
    "init": "Init",
    "next": "Next",
    "invariants": [
      "BelowThree"
    ]
  },
  "workers": 1,
  "dumpTrace": false
}
```

**Example output (violation, excerpt):**

```json
{
  "success": false,
  "states": {
    "found": 4,
    "distinct": 4,
    "depth": 4
  },
  "violation": {
    "type": "invariant",
    "name": "BelowThree"
  },
  "trace": [
    {
      "stateNum": 1,
      "variables": {
        "x": "0"
      }
    },
    {
      "stateNum": 2,
      "variables": {
        "x": "1"
      }
    },
    {
      "stateNum": 3,
      "variables": {
        "x": "2"
      }
    },
    {
      "stateNum": 4,
      "variables": {
        "x": "3"
      }
    }
  ]
}
```

## Prompts

- **`create_tlaplus_spec`** — Guides creation of a TLA+ specification with state variables, init, next, and invariants.
- **`create_pluscal_algorithm`** — Guides creation of a PlusCal algorithm for concurrent/distributed systems.

## Resources

- **`tlaplus://docs`** — TLA+ quick reference (operators, syntax, standard modules)
- **`tlaplus://examples`** — Example TLA+ specifications (Counter, an intentionally incorrect Mutex design with a counterexample, Producer-Consumer, and a valid Dining Philosophers PlusCal model)
- **`tlaplus://cfg-format`** — TLC configuration file (.cfg) format reference

## License

MIT
