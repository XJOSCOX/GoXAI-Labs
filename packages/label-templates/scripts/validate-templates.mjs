import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(packageRoot, "../..");
const templatesRoot = path.join(packageRoot, "templates");
const publicRoot = path.join(workspaceRoot, "apps/web/public");
const requiredFiles = ["groups.txt", "categories.json", "LICENSE.label-studio", "NOTICE.label-studio", "UPSTREAM.md"];
const requiredRecipeFields = ["title", "type", "group", "image", "details", "config"];
const supportedTypes = new Set(["community", "enterprise"]);
const errors = [];

const groups = (await readFile(path.join(templatesRoot, "groups.txt"), "utf8"))
  .split(/\r?\n/)
  .map((group) => group.trim())
  .filter(Boolean);
const groupSet = new Set(groups);
const categories = JSON.parse(await readFile(path.join(templatesRoot, "categories.json"), "utf8"));
const categoryById = new Map(categories.map((category) => [category.id, category]));
const categoryByName = new Map(categories.map((category) => [category.name, category]));
const configFiles = await findFiles(templatesRoot, "config.yml");
const recipeIds = new Set();
const usedGroups = new Set();

for (const fileName of requiredFiles) {
  await assertExists(path.join(templatesRoot, fileName), `${fileName} is required`);
}

for (const group of groups) {
  if (!categoryByName.has(group)) {
    errors.push(`Missing category metadata for group "${group}".`);
  }
}

for (const configPath of configFiles) {
  const relativePath = path.relative(templatesRoot, configPath).replace(/\\/g, "/");
  const [categoryId, templateId] = relativePath.split("/");

  if (!categoryId || !templateId) {
    errors.push(`${relativePath} must be nested as <category>/<template>/config.yml.`);
    continue;
  }

  if (recipeIds.has(`${categoryId}/${templateId}`)) {
    errors.push(`Duplicate recipe id ${categoryId}/${templateId}.`);
  }

  recipeIds.add(`${categoryId}/${templateId}`);

  if (!categoryById.has(categoryId)) {
    errors.push(`${relativePath} uses category folder "${categoryId}" without categories.json metadata.`);
  }

  const recipe = parseRecipe(await readFile(configPath, "utf8"), relativePath);

  for (const field of requiredRecipeFields) {
    if (!isNonEmptyString(recipe[field])) {
      errors.push(`${relativePath} is missing required string field "${field}".`);
    }
  }

  if (isNonEmptyString(recipe.group)) {
    usedGroups.add(recipe.group);

    if (!groupSet.has(recipe.group)) {
      errors.push(`${relativePath} uses group "${recipe.group}" that is not listed in groups.txt.`);
    }
  }

  if (isNonEmptyString(recipe.type) && !supportedTypes.has(recipe.type)) {
    errors.push(`${relativePath} has unsupported type "${recipe.type}".`);
  }

  if (recipe.order !== undefined && (!Number.isInteger(Number(recipe.order)) || Number(recipe.order) < 0)) {
    errors.push(`${relativePath} has invalid order "${recipe.order}".`);
  }

  if (isNonEmptyString(recipe.config) && !/<View\b/.test(recipe.config)) {
    errors.push(`${relativePath} config must include a <View> root.`);
  }

  if (isNonEmptyString(recipe.image)) {
    await validateImageAsset(recipe.image, relativePath);
  }

  if (recipe.source_repo !== undefined && !/^https:\/\/.+/.test(String(recipe.source_repo))) {
    errors.push(`${relativePath} has source_repo that is not an https URL.`);
  }
}

for (const group of usedGroups) {
  if (!categoryByName.has(group)) {
    errors.push(`Used group "${group}" has no categories.json entry.`);
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Validated ${configFiles.length} templates across ${usedGroups.size} groups.`);

async function findFiles(directory, fileName) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return findFiles(fullPath, fileName);
      }

      return entry.isFile() && entry.name === fileName ? [fullPath] : [];
    })
  );

  return files.flat();
}

function parseRecipe(raw, relativePath) {
  try {
    const recipe = parseYaml(raw);

    if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) {
      throw new Error("expected a YAML mapping at the document root");
    }

    return recipe;
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "unknown parse error";
    errors.push(`${relativePath} could not be parsed: ${message}.`);
    return {};
  }
}

async function validateImageAsset(imagePath, relativePath) {
  if (/^https?:\/\//.test(imagePath)) {
    return;
  }

  const assetPath = imagePath.startsWith("/")
    ? path.join(publicRoot, imagePath.slice(1))
    : path.join(publicRoot, imagePath);

  await assertExists(assetPath, `${relativePath} references missing image asset ${imagePath}`);
}

async function assertExists(filePath, message) {
  try {
    await access(filePath);
  } catch {
    errors.push(message);
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
