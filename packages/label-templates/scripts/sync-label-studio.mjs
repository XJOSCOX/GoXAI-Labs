import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const labelStudioRepo = "https://github.com/HumanSignal/label-studio.git";
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(packageRoot, "../..");
const templatesRoot = path.join(packageRoot, "templates");
const publicTemplatesRoot = path.join(workspaceRoot, "apps/web/public/static/templates");

const upstreamReadme = (commit) => `# Label Studio Template Catalog

This directory mirrors Label Studio annotation template artifacts from:

https://github.com/HumanSignal/label-studio/tree/develop/label_studio/annotation_templates

Last synced from upstream commit:

\`${commit}\`

Mirrored exactly:

- \`groups.txt\`
- every upstream \`config.yml\`
- upstream auxiliary \`config.xml\`, \`example.json\`, \`README.md\`, and \`CONTRIBUTING.md\` files
- preview assets under \`apps/web/public/static/templates\`
- \`LICENSE.label-studio\` and \`NOTICE.label-studio\`

GoXAI-owned metadata:

- \`categories.json\`

Run \`pnpm --filter @goxai/label-templates validate\` after editing or syncing templates.
`;

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "goxai-label-studio-"));

try {
  await execFileAsync("git", ["clone", "--depth", "1", "--filter=blob:none", "--sparse", labelStudioRepo, tempRoot]);
  await execFileAsync("git", [
    "-C",
    tempRoot,
    "sparse-checkout",
    "set",
    "--skip-checks",
    "label_studio/annotation_templates",
    "label_studio/core/static/templates",
    "LICENSE",
    "NOTICE"
  ]);

  const { stdout } = await execFileAsync("git", ["-C", tempRoot, "rev-parse", "HEAD"]);
  const commit = stdout.trim();

  await cleanDirectory(templatesRoot, new Set(["categories.json"]));
  await copyContents(path.join(tempRoot, "label_studio/annotation_templates"), templatesRoot);
  await cp(path.join(tempRoot, "LICENSE"), path.join(templatesRoot, "LICENSE.label-studio"));
  await cp(path.join(tempRoot, "NOTICE"), path.join(templatesRoot, "NOTICE.label-studio"));
  await writeFile(path.join(templatesRoot, "UPSTREAM.md"), upstreamReadme(commit), "utf8");

  await cleanDirectory(publicTemplatesRoot);
  await copyContents(path.join(tempRoot, "label_studio/core/static/templates"), publicTemplatesRoot);

  console.log(`Synced Label Studio templates from ${commit}.`);
  console.log("Run pnpm --filter @goxai/label-templates validate to verify the catalog.");
} finally {
  await rm(tempRoot, { force: true, recursive: true });
}

async function cleanDirectory(directory, preserveNames = new Set()) {
  await mkdir(directory, { recursive: true });

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (preserveNames.has(entry.name)) {
      continue;
    }

    await rm(path.join(directory, entry.name), { force: true, recursive: true });
  }
}

async function copyContents(sourceDirectory, targetDirectory) {
  await mkdir(targetDirectory, { recursive: true });

  for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
    await cp(path.join(sourceDirectory, entry.name), path.join(targetDirectory, entry.name), { recursive: true });
  }
}
