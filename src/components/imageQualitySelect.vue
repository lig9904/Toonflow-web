<template>
  <t-select v-model="quality" :loading="loading" :disabled="loading || !options.length" :placeholder="loading ? '读取模型能力' : '清晰度'">
    <t-option v-for="value in options" :key="value" :label="value" :value="value" />
  </t-select>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import axios from "@/utils/axios";
const props = defineProps<{ modelKey?: string }>();
const quality = defineModel<string>({ default: "" });
const options = ref<string[]>([]);
const loading = ref(false);
let sequence = 0;
watch(() => props.modelKey, async (modelKey) => {
  const requestSequence = ++sequence;
  options.value = [];
  if (!modelKey) { loading.value = false; return; }
  loading.value = true;
  try {
    const { data } = await axios.post("/modelSelect/getModelDetail", { modelId: modelKey });
    if (requestSequence !== sequence) return;
    options.value = data?.type === "image" && Array.isArray(data.resolutions) ? data.resolutions : [];
    if (options.value.length && !options.value.includes(quality.value)) quality.value = options.value.at(-1)!;
  } catch { /* An unavailable capability response must not offer guessed options. */ }
  finally { if (requestSequence === sequence) loading.value = false; }
}, { immediate: true });
watch(quality, (value) => {
  if (!loading.value && options.value.length && !options.value.includes(value)) quality.value = options.value.at(-1)!;
});
</script>
