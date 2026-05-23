import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "prisma/config";
import { config } from "dotenv";

const envPaths = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];

for (const path of envPaths) {
  if (existsSync(path)) {
    config({ path, override: false, quiet: true });
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? ""
  }
});
