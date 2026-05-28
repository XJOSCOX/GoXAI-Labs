import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

const envPaths = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env")
];

for (const path of envPaths) {
  if (existsSync(path)) {
    config({ path, override: false, quiet: true });
  }
}
