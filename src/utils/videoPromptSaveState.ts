import {reactive} from 'vue';
import type {VideoPromptDraftRecord,VideoPromptServerBaseline} from '../views/production/components/workbench/generate/utils/videoPromptDraft';
/** Saved values must invalidate computed dirty badges even when the editor text is unchanged. */
export function createSavedVideoPromptStore(){return reactive(new Map<number,string>());}
export function draftAfterPromptSave(currentText:string,submittedText:string,baseline:VideoPromptServerBaseline):VideoPromptDraftRecord|undefined{return currentText===submittedText?undefined:{text:currentText,baseVersion:baseline.version,baseModeIntentRevision:baseline.modeIntentRevision,baseSavedPrompt:baseline.savedPrompt};}
