<template>
  <section class="videoFailureNotice" role="status" aria-label="视频失败说明">
    <strong>{{ trackTitle }} · {{ explanation.title }}</strong>
    <p>{{ explanation.reason }}</p>
    <p><b>接下来：</b>{{ explanation.action }}</p>
    <t-button v-if="explanation.editPrompt" size="small" variant="outline" @click="$emit('editPrompt')">编辑本镜提示词</t-button>
    <details><summary>技术详情（排查用）</summary><pre>{{ error || '平台没有返回详细错误' }}</pre></details>
  </section>
</template>
<script setup lang="ts">
import {computed} from 'vue';
import {explainVideoFailure} from '@/utils/videoFailure';
const props=defineProps<{error:string;trackTitle:string;state?:string|null;downloadRetryable?:boolean}>();
defineEmits<{editPrompt:[]}>();
const explanation=computed(()=>explainVideoFailure(props.error,props.state ?? undefined,props.downloadRetryable));
</script>
<style scoped>
.videoFailureNotice{border:1px solid var(--td-error-color-3);background:var(--td-error-color-1);border-radius:6px;padding:12px;margin-bottom:12px;color:var(--td-text-color-primary);font-size:13px;line-height:1.6;overflow-wrap:anywhere}.videoFailureNotice strong{color:var(--td-error-color)}p{margin:6px 0}summary{cursor:pointer;margin-top:8px;color:var(--td-text-color-secondary)}pre{white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto;font-size:12px}
</style>
