import { createRequire } from "node:module";

type PackageInfo = {
  name: string;
  version: string;
  description?: string;
};

const require = createRequire(import.meta.url);
const packageInfo = require("../package.json") as PackageInfo;

export const SERVER_INFO = {
  name: packageInfo.name,
  version: packageInfo.version,
  description:
    packageInfo.description ?? "A TLA+ model checking MCP server"
} as const;
