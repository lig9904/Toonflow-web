<template>
  <div v-if="review || error" class="imageReview nodrag nopan" @click.stop @mousedown.stop>
    <t-button v-if="review" size="small" variant="text" :theme="review.stale ? 'default' : review.status === 'issues' ? 'warning' : 'primary'" @click="visible = true">{{ label }}</t-button>
    <span v-else class="reviewError" @click="refresh">{{ error }} · 重试</span>
    <t-dialog v-model:visible="visible" header="图片核验" :footer="false" width="640px" attach="body">
      <template v-if="review">
        <p v-if="review.targetKind === 'flow'" class="reviewWarning">核验依据生成时的图片和参考素材。后续编辑或更换参考素材后，请结合当前画布判断。</p>
        <p v-else-if="review.stale" class="reviewWarning">图片、参考素材或文字已发生变化，以下是历史核验结果。</p>
        <p>{{ review.summary || '核验正在进行，结果会自动更新。' }}</p>
        <p v-if="['passed','issues'].includes(review.status)" class="reviewMeta">{{ review.referenceCoverage === 'complete' ? '已检查实际生成图和全部参考图' : review.referenceCoverage === 'partial' ? '已检查生成图，部分参考图未能核验' : '仅检查生成图；参考身份一致性未核验' }}</p>
        <p v-else class="reviewMeta">尚未形成有效视觉核验。</p>
        <ul v-if="review.findings.length"><li v-for="(finding,index) in review.findings" :key="index" :class="finding.severity">{{ finding.message }}</li></ul>
        <p class="reviewMeta">核验不会自动替换或重画；可直接在画布调整。</p>
      </template>
    </t-dialog>
  </div>
</template>
<script setup lang="ts">
import {computed, ref, toRef, watch} from 'vue';
import {useImageReviews, reviewMediaPath} from '@/utils/imageReviews';
const props = defineProps<{projectId?: number | string; scriptId?: number; targetKind: string; targetId?: number | string; src?: string | null; matchByArtifact?: boolean}>();
const {reviews, error, refresh} = useImageReviews(computed(() => Number(props.projectId) || undefined), toRef(props, 'scriptId'));
const visible = ref(false);
watch(() => props.src, () => refresh());
const review = computed(() => {
  if (!props.src) return undefined;
  const artifact = reviewMediaPath(props.src);
  const candidates = reviews.value.filter(item => item.targetKind === props.targetKind && reviewMediaPath(item.artifactPath) === artifact);
  const exact = props.targetId == null ? undefined : candidates.find(item => String(item.targetId) === String(props.targetId));
  // A new Flow may acquire a database id after generation used its node id.
  // Artifact fallback stays inside the hook's project/episode and requested target kind.
  return exact ?? (props.matchByArtifact ? candidates[0] : undefined);
});
const label = computed(() => review.value?.stale && review.value?.targetKind !== 'flow' ? '历史核验' : ({queued:'核验排队中',running:'正在核验图片',passed:'图像核验完成',issues:'图像核验有提示',failed:'图像核验失败',skipped:'图像未核验'}[review.value?.status ?? 'skipped']));
</script>
<style scoped>
.imageReview{font-size:12px}.reviewWarning,.warning{color:#a66b08}.error,.reviewError{color:#c33}.reviewMeta{color:#666;font-size:13px}li{margin:8px 0}.reviewError{cursor:pointer}
</style>
