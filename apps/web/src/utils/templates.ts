import type { BuiltInAnnotationTemplateSummary } from "../api";
import type { TemplatePreset } from "@goxai/label-templates";

export function builtInTemplateToPreset(template: BuiltInAnnotationTemplateSummary): TemplatePreset {
  return {
    category: template.category,
    categoryId: template.categoryId,
    configCode: template.configCode,
    configPath: template.configPath,
    dataType: template.dataType,
    description: template.description,
    details: template.details ?? undefined,
    id: template.id,
    image: template.image ?? undefined,
    labels: template.labels,
    name: template.name,
    order: template.order,
    source: "builtin",
    sourceRepo: template.sourceRepo ?? undefined,
    subtype: template.subtype,
    tools: template.tools,
    type: template.type
  };
}
