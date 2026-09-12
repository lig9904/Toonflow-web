import { h } from "vue";
import { DialogPlugin } from "tdesign-vue-next";
import router from "@/router";

export interface CreativeDraftRegistration {
  id: string;
  scope?: string | (() => string);
  label: string;
  isDirty(): boolean;
  save(): Promise<boolean>;
  discard(): void | Promise<void>;
}
export interface CreativeDraftDecision { scope?: string; action?: string; ids?: string[] }
const drafts = new Map<string, CreativeDraftRegistration>();
let pendingDecision: Promise<boolean> | undefined;
let guardsInstalled = false;
export function registerCreativeDraft(draft: CreativeDraftRegistration): () => void {
  drafts.set(draft.id, draft);
  if (!guardsInstalled) {
    guardsInstalled = true;
    router.beforeEach(async (to, from) => to.fullPath === from.fullPath || await confirmCreativeDrafts({ action: "离开当前页面" }));
    window.addEventListener("beforeunload", event => { if ([...drafts.values()].some(entry => entry.isDirty())) { event.preventDefault(); event.returnValue = ""; } });
  }
  return () => { if (drafts.get(draft.id) === draft) drafts.delete(draft.id); };
}
export function hasCreativeDrafts(options: CreativeDraftDecision = {}): boolean { return selectedDrafts(options).length > 0; }
function selectedDrafts(options: CreativeDraftDecision) {
  return [...drafts.values()].filter(entry => {
    const scope = typeof entry.scope === "function" ? entry.scope() : entry.scope;
    return entry.isDirty() && (!options.ids || options.ids.includes(entry.id)) && (!options.scope || scope === options.scope || scope?.startsWith(`${options.scope}:`));
  });
}
export async function confirmCreativeDrafts(options: CreativeDraftDecision = {}): Promise<boolean> {
  const selected = selectedDrafts(options); if (!selected.length) return true;
  if (pendingDecision) { if(!(await pendingDecision))return false; return confirmCreativeDrafts(options); }
  pendingDecision = new Promise<boolean>(resolve => {
    let settled = false, busy = false;
    const finish = (value: boolean) => { if (settled) return; settled = true; dialog.destroy(); resolve(value); };
    const button = (text: string, onClick: () => unknown, primary = false) => h("button", { type: "button", class: `t-button t-button--${primary ? "primary" : "default"}`, style: { marginLeft: "8px" }, onClick }, text);
    const dialog = DialogPlugin.confirm({
      header: "有未保存的创作草稿",
      body: `${selected.map(entry => entry.label).join("、")}尚未保存。${options.action || "继续当前操作"}前，请选择保存、放弃或继续编辑。`,
      closeOnOverlayClick: false, closeOnEscKeydown: false,
      onClose: () => { if (!busy) finish(false); },
      footer: () => h("div", [
        button("继续编辑", () => { if (!busy) finish(false); }),
        button("放弃修改", async () => { if (busy) return; busy = true; try { for (const entry of selected) await entry.discard(); finish(true); } catch { window.$message.error("放弃草稿失败，草稿仍保留"); } finally { busy = false; } }),
        button("保存并继续", async () => { if (busy) return; busy = true; try { for (const entry of selected) if (!(await entry.save()) || entry.isDirty()) return; finish(true); } catch (error) { window.$message.error((error as Error)?.message || "保存失败，草稿仍保留"); } finally { busy = false; } }, true),
      ]),
    });
  }).finally(() => { pendingDecision = undefined; });
  return pendingDecision;
}
