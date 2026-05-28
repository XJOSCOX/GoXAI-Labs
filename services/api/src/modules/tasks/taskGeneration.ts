import { isPlainJsonObject } from "./taskValidation.js";

export function getDatasetGenerationConfigIssue(dataset: {
  labelingConfig: unknown;
  labels: unknown[];
  metadata: unknown;
  tools: { enabled: boolean }[];
}) {
  const hasControllerConfig = isPlainJsonObject(dataset.metadata) && isPlainJsonObject(dataset.metadata.taskWorkflowDefaults);
  const hasTemplateConfig = dataset.labels.length > 0 && dataset.tools.some((tool) => tool.enabled) && isPlainJsonObject(dataset.labelingConfig);

  if (!hasControllerConfig && !hasTemplateConfig) {
    return "Apply a controller and template config before generating tasks.";
  }

  if (!hasControllerConfig) {
    return "Apply a controller config before generating tasks.";
  }

  if (!hasTemplateConfig) {
    return "Apply a template config before generating tasks.";
  }

  return null;
}
