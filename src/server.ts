import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { SERVER_INFO } from "./package-info.js";
import {
  executeSanyParse,
  executePlusCalTranslate,
  executeTlcCheck,
} from "./tlaplus.js";

export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_INFO.name, version: SERVER_INFO.version },
    { maxToolInputElements: 10_000 },
  );

  // ─── Tool: sany_parse ──────────────────────────────────────────────────────

  server.tool(
    "sany_parse",
    "Parse and syntax-check a TLA+ specification using SANY (Syntactic Analyzer)",
    {
      spec: z.string().describe("TLA+ specification source code"),
    },
    async ({ spec }) => {
      try {
        const result = executeSanyParse(spec);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: !result.valid,
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── Tool: pluscal_translate ───────────────────────────────────────────────

  server.tool(
    "pluscal_translate",
    "Translate a PlusCal algorithm embedded in a TLA+ specification into TLA+",
    {
      spec: z
        .string()
        .describe("TLA+ specification containing PlusCal algorithm"),
    },
    async ({ spec }) => {
      try {
        const result = executePlusCalTranslate(spec);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── Tool: tlc_check ──────────────────────────────────────────────────────

  server.tool(
    "tlc_check",
    "Run the TLC model checker on a TLA+ specification to verify invariants and temporal properties",
    {
      spec: z.string().describe("TLA+ specification source code"),
      config: z
        .object({
          init: z
            .string()
            .optional()
            .describe('Init predicate name (e.g. "Init")'),
          next: z
            .string()
            .optional()
            .describe('Next predicate name (e.g. "Next")'),
          specification: z
            .string()
            .optional()
            .describe(
              'SPECIFICATION name (e.g. "Spec"). Alternative to init/next.'
            ),
          checkDeadlock: z
            .boolean()
            .optional()
            .default(true)
            .describe("Whether to check for deadlock (default: true)"),
          invariants: z
            .array(z.string())
            .optional()
            .describe("Invariant names to check"),
          properties: z
            .array(z.string())
            .optional()
            .describe("Temporal property names to check"),
          constants: z
            .record(z.string(), z.string())
            .optional()
            .describe('CONSTANT assignments (e.g. {"N": "3"})'),
          symmetry: z.string().optional().describe("SYMMETRY set name"),
          stateConstraint: z
            .string()
            .optional()
            .describe("STATE CONSTRAINT expression"),
        })
        .describe("TLC model checking configuration"),
      workers: z
        .number()
        .optional()
        .default(1)
        .describe("Number of worker threads"),
      dumpTrace: z
        .boolean()
        .optional()
        .default(false)
        .describe("Dump counterexample trace as JSON"),
    },
    async ({ spec, config, workers, dumpTrace }) => {
      try {
        const result = executeTlcCheck(spec, config, workers, dumpTrace);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── Prompts ───────────────────────────────────────────────────────────────

  server.prompt(
    "create_tlaplus_spec",
    "Help create a TLA+ specification by guiding through state variables, initial state, transitions, and invariants",
    {
      description: z
        .string()
        .describe("Description of the system to formally specify"),
    },
    ({ description }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Create a TLA+ specification for the following system:

${description}

Please include:
1. MODULE declaration with EXTENDS (Integers, Sequences, FiniteSets, TLC as needed)
2. CONSTANTS declarations (if applicable)
3. VARIABLES declarations for all state variables
4. TypeOK invariant defining the type-correctness of all variables
5. Init predicate defining the initial state
6. Next predicate as a disjunction of all possible actions
7. Spec definition (Init /\\ [][Next]_vars)
8. Safety invariants to verify
9. Comments explaining each part of the specification

Use standard TLA+ conventions:
- CamelCase for predicate names
- ALL_CAPS for constants
- Descriptive variable names`,
          },
        },
      ],
    })
  );

  server.prompt(
    "create_pluscal_algorithm",
    "Help create a PlusCal algorithm for concurrent/distributed systems",
    {
      description: z
        .string()
        .describe("Description of the concurrent algorithm to specify"),
    },
    ({ description }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Create a PlusCal algorithm for the following system:

${description}

Please include:
1. MODULE and EXTENDS declarations
2. CONSTANTS (if applicable)
3. The PlusCal algorithm block between (* --algorithm ... end algorithm; *)
4. Use either p-syntax (begin/end) or c-syntax ({/}) as appropriate
5. Process declarations for concurrent entities
6. Labels for atomic steps
7. Assertions and invariants
8. Comments explaining the algorithm

PlusCal tips:
- Use "either ... or" for non-deterministic choice
- Use "with" for non-deterministic variable selection
- Use "await" for blocking conditions
- Labels define atomicity boundaries
- Variables in "variables" block are global; in "process" are local`,
          },
        },
      ],
    })
  );

  // ─── Resources ─────────────────────────────────────────────────────────────

  server.resource("tlaplus-docs", "tlaplus://docs", async (uri) => ({
    contents: [
      {
        uri: uri.href,
        text: `# TLA+ Quick Reference

## Module Structure
\`\`\`tla
---- MODULE ModuleName ----
EXTENDS Naturals, Sequences, FiniteSets, TLC

CONSTANTS Const1, Const2

VARIABLES var1, var2

\\* Definitions, operators, actions...

====
\`\`\`

## Operators & Syntax

### Logic
- \`/\\\` (conjunction), \`\\/\` (disjunction), \`~\` (negation)
- \`=>\` (implication), \`<=>\` (equivalence)
- \`\\A x \\in S : P(x)\` (for all), \`\\E x \\in S : P(x)\` (exists)
- \`CHOOSE x \\in S : P(x)\` (Hilbert's choice)

### Sets
- \`{1, 2, 3}\` (enumeration), \`{x \\in S : P(x)}\` (filter)
- \`{f(x) : x \\in S}\` (map)
- \`\\union\`, \`\\intersect\`, \`\\\\\` (set difference)
- \`\\subseteq\`, \`\\in\`, \`\\notin\`
- \`SUBSET S\` (power set), \`UNION S\` (distributed union)
- \`Cardinality(S)\` (from FiniteSets)

### Functions
- \`[x \\in S |-> expr]\` (function definition)
- \`[S -> T]\` (set of all functions from S to T)
- \`f[x]\` (function application)
- \`DOMAIN f\` (domain of function)
- \`[f EXCEPT ![a] = b]\` (function update)

### Records
- \`[field1 |-> val1, field2 |-> val2]\` (record)
- \`[field1 : Set1, field2 : Set2]\` (set of records)
- \`r.field\` (field access)
- \`[r EXCEPT !.field = val]\` (record update)

### Sequences (from Sequences module)
- \`<<a, b, c>>\` (sequence literal)
- \`Seq(S)\` (set of all sequences over S)
- \`Len(s)\`, \`Head(s)\`, \`Tail(s)\`
- \`Append(s, e)\`, \`s \\o t\` (concatenation)
- \`SubSeq(s, m, n)\`

### Integers (from Integers module)
- \`Int\`, \`Nat\` (integer and natural number sets)
- \`a..b\` (integer range)
- \`+\`, \`-\`, \`*\`, \`\\div\`, \`%\`

### Temporal Logic
- \`[]\` (always / box), \`<>\` (eventually / diamond)
- \`[]<>P\` (P holds infinitely often)
- \`<>[]P\` (P eventually holds forever)
- \`P ~> Q\` (P leads to Q)
- \`ENABLED A\` (action A is enabled)
- \`UNCHANGED vars\` (stuttering)

### Actions & Priming
- \`x'\` (next-state value of x)
- \`UNCHANGED <<x, y>>\` (variables don't change)
- \`[][A]_vars\` (A or stuttering on vars)
- \`<><<A>>_vars\` (A eventually happens and changes vars)

## Standard Modules
- **Naturals**: Nat, +, -, *, \\div, %, <=, >=, <, >
- **Integers**: Int (extends Naturals with negative numbers)
- **Sequences**: Seq, Len, Head, Tail, Append, \\o, SubSeq
- **FiniteSets**: IsFiniteSet, Cardinality
- **TLC**: Print, PrintT, Assert, :>, @@
- **Bags**: BagIn, BagOfAll, BagUnion, CopiesIn
`,
      },
    ],
  }));

  server.resource(
    "tlaplus-examples",
    "tlaplus://examples",
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: `# TLA+ Example Specifications

## Simple Counter
\`\`\`tla
---- MODULE Counter ----
EXTENDS Naturals

VARIABLE count

Init == count = 0

Increment == count' = count + 1

Next == Increment

Spec == Init /\\ [][Next]_count

TypeOK == count \\in Nat

CountBounded == count <= 10
====
\`\`\`

Config for bounded check:
\`\`\`
INIT Init
NEXT Next
INVARIANT TypeOK
CONSTRAINT CountBounded
\`\`\`

## Mutex (Two-Process Mutual Exclusion)
\`\`\`tla
---- MODULE Mutex ----
EXTENDS Integers

VARIABLES pc, turn

Procs == {0, 1}

Init ==
  /\\ pc = [p \\in Procs |-> "idle"]
  /\\ turn = 0

Request(p) ==
  /\\ pc[p] = "idle"
  /\\ pc' = [pc EXCEPT ![p] = "waiting"]
  /\\ turn' = 1 - p

Enter(p) ==
  /\\ pc[p] = "waiting"
  /\\ \\/ pc[1 - p] /= "waiting"
     \\/ turn = p
  /\\ pc' = [pc EXCEPT ![p] = "critical"]
  /\\ UNCHANGED turn

Exit(p) ==
  /\\ pc[p] = "critical"
  /\\ pc' = [pc EXCEPT ![p] = "idle"]
  /\\ UNCHANGED turn

Next == \\E p \\in Procs : Request(p) \\/ Enter(p) \\/ Exit(p)

Spec == Init /\\ [][Next]_<<pc, turn>>

TypeOK ==
  /\\ pc \\in [Procs -> {"idle", "waiting", "critical"}]
  /\\ turn \\in Procs

MutualExclusion ==
  ~ (pc[0] = "critical" /\\ pc[1] = "critical")
====
\`\`\`

## Producer-Consumer with Bounded Buffer
\`\`\`tla
---- MODULE ProducerConsumer ----
EXTENDS Naturals, Sequences

CONSTANTS BufCapacity, Data

VARIABLES buf, waitP, waitC

Init ==
  /\\ buf = <<>>
  /\\ waitP = FALSE
  /\\ waitC = FALSE

Produce(d) ==
  /\\ Len(buf) < BufCapacity
  /\\ buf' = Append(buf, d)
  /\\ waitP' = FALSE
  /\\ UNCHANGED waitC

Consume ==
  /\\ Len(buf) > 0
  /\\ buf' = Tail(buf)
  /\\ waitC' = FALSE
  /\\ UNCHANGED waitP

WaitProduce ==
  /\\ Len(buf) = BufCapacity
  /\\ waitP' = TRUE
  /\\ UNCHANGED <<buf, waitC>>

WaitConsume ==
  /\\ Len(buf) = 0
  /\\ waitC' = TRUE
  /\\ UNCHANGED <<buf, waitP>>

Next ==
  \\/ \\E d \\in Data : Produce(d)
  \\/ Consume
  \\/ WaitProduce
  \\/ WaitConsume

Spec == Init /\\ [][Next]_<<buf, waitP, waitC>>

TypeOK ==
  /\\ buf \\in Seq(Data)
  /\\ Len(buf) <= BufCapacity
  /\\ waitP \\in BOOLEAN
  /\\ waitC \\in BOOLEAN

NoOverflow == Len(buf) <= BufCapacity
====
\`\`\`

## PlusCal Example: Dining Philosophers
\`\`\`tla
---- MODULE DiningPhilosophers ----
EXTENDS Integers, FiniteSets

CONSTANTS N

ASSUME N \\in Nat \\ {0}

(* --algorithm DiningPhilosophers {
  variables forks = [i \\in 1..N |-> TRUE]; \\* TRUE = available

  process phil \\in 1..N
    variables left = 0, right = 0;
  {
    think:
      skip;
    getLeft:
      await forks[self];
      forks[self] := FALSE;
      left := self;
    getRight:
      await forks[(self % N) + 1];
      forks[(self % N) + 1] := FALSE;
      right := (self % N) + 1;
    eat:
      skip;
    release:
      forks[left] := TRUE;
      forks[right] := TRUE;
      goto think;
  }
} *)
====
\`\`\`
`,
        },
      ],
    })
  );

  server.resource(
    "tlaplus-cfg-format",
    "tlaplus://cfg-format",
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: `# TLC Configuration File (.cfg) Format

The TLC model checker uses a configuration file to specify what to check.

## Basic Structure

\`\`\`
INIT Init
NEXT Next
\`\`\`

## Directives

### INIT / NEXT
Specify the initial state predicate and next-state relation:
\`\`\`
INIT Init
NEXT Next
\`\`\`

### SPECIFICATION (alternative to INIT/NEXT)
Specify a temporal formula:
\`\`\`
SPECIFICATION Spec
\`\`\`

### INVARIANT
Properties that must hold in every reachable state:
\`\`\`
INVARIANT TypeOK
INVARIANT MutualExclusion
INVARIANT NoDeadlock
\`\`\`

### PROPERTY
Temporal properties to check:
\`\`\`
PROPERTY Liveness
PROPERTY EventualConsistency
\`\`\`

### CONSTANTS
Assign values to declared constants:
\`\`\`
CONSTANTS
  N = 3
  Data = {d1, d2, d3}
  MaxLen = 5
\`\`\`

Model values (uninterpreted constants):
\`\`\`
CONSTANTS
  N = 3
  Data = {d1, d2, d3}
\`\`\`

### SYMMETRY
Declare symmetry sets to reduce state space:
\`\`\`
SYMMETRY Perms
\`\`\`
Where \`Perms\` is defined in the spec as \`Permutations(Data)\`.

### CONSTRAINT
State constraint to bound the state space:
\`\`\`
CONSTRAINT StateConstraint
\`\`\`

### ACTION_CONSTRAINT
Restrict which actions TLC explores:
\`\`\`
ACTION_CONSTRAINT ActionConstraint
\`\`\`

### VIEW
Define a view to reduce the state space by treating states
with the same view value as identical:
\`\`\`
VIEW ViewExpr
\`\`\`

## Example: Complete Configuration
\`\`\`
\\* Simple mutex with 3 processes
INIT Init
NEXT Next

CONSTANTS
  N = 3

INVARIANT TypeOK
INVARIANT MutualExclusion

PROPERTY Liveness

CONSTRAINT BoundedState

SYMMETRY ProcessPerms
\`\`\`

## Tips
- File must have \`.cfg\` extension
- Comments start with \`\\*\`
- Each directive is on its own line
- CONSTANTS block can have multiple assignments
- Multiple INVARIANTs and PROPERTYs are allowed
- Use CONSTRAINT to keep state space manageable for model checking
`,
        },
      ],
    })
  );

  return server;
}
