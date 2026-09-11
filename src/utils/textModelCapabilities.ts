export interface TextModelCapabilities { name: string; modelName: string; type: "text"; think: boolean; thinkingMode?: "required" | "optional"; [key: string]: unknown }
export const requiresThinking = (model?: { thinkingMode?: string }) => model?.thinkingMode === "required";
/** Editing labels must not erase provider-owned model capabilities or output limits. */
export function updateTextModel(existing: TextModelCapabilities | undefined, form: { name: string; modelName: string; think: boolean }): TextModelCapabilities {
  const known = existing?.modelName === form.modelName.trim() ? existing : undefined;
  return { ...known, name: form.name.trim(), modelName: form.modelName.trim(), type: "text", think: requiresThinking(known) ? true : form.think };
}
