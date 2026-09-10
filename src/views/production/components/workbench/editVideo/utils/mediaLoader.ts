import {
  extractVideoThumbnails,
  extractAudioWaveform,
  extractVideoAudioWaveform,
  type MediaClip,
} from "vue-clip-track";

/** 异步加载视频 clip 的缩略图 */
export async function loadVideoClipThumbnails(tracksStore: any, clipId: string, sourceUrl: string) {
  try {
    const result = await extractVideoThumbnails(sourceUrl, { count: 20, width: 120 });
    const clip = tracksStore.getClip(clipId) as MediaClip;
    if (clip && clip.type === "video") {
      clip.thumbnails = result.thumbnails;
      if (result.duration > 0) {
        // Keep the probed source duration separate from the planned timeline
        // interval. Updating endTime here would turn a planned 2/3/4 second
        // shot into the generated source duration (usually 4 seconds).
        (clip as any).sourceDuration = result.duration;
        clip.originalDuration = result.duration;

        // Only fill an unset/invalid trim window. An explicit trim must stay
        // intact after the asynchronous probe completes.
        const trimEnd = Number(clip.trimEnd);
        if (!Number.isFinite(trimEnd) || trimEnd <= 0) {
          clip.trimEnd = result.duration;
        } else if (trimEnd > result.duration) {
          clip.trimEnd = result.duration;
        }

        if (clip.endTime - clip.startTime <= 0) {
          clip.endTime = clip.startTime + result.duration;
        }
      }
    }
  } catch (error) {
    console.error("Failed to load video thumbnails:", error);
  }
}

/** 异步加载音频 clip 的波形数据 */
export async function loadAudioClipWaveform(tracksStore: any, clipId: string, sourceUrl: string) {
  try {
    const isVideo = sourceUrl.match(/\.(mp4|webm|mov|avi)$/i);
    const result = isVideo
      ? await extractVideoAudioWaveform(sourceUrl, { samples: 500 })
      : await extractAudioWaveform(sourceUrl, { samples: 500 });

    const clip = tracksStore.getClip(clipId) as MediaClip;
    if (clip && clip.type === "audio") {
      clip.waveformData = result.waveformData;

      if (result.duration > 0) {
        (clip as any).sourceDuration = result.duration;
        clip.originalDuration = result.duration;
        const clipDuration = clip.endTime - clip.startTime;
        if (clipDuration <= 0) {
          clip.endTime = clip.startTime + result.duration;
          clip.trimEnd = result.duration;
        }
        if (clip.trimEnd > result.duration) {
          clip.trimEnd = result.duration;
        }
      }
    }
  } catch (error) {
    console.error("Failed to load audio waveform:", error);
  }
}

/** 初始化时加载所有音频 clip 的波形数据 */
export async function loadInitialAudioWaveforms(tracksStore: any) {
  for (const track of tracksStore.tracks) {
    for (const clip of track.clips) {
      if (clip.type === "audio") {
        const mediaClip = clip as MediaClip;
        if (!mediaClip.waveformData || mediaClip.waveformData.length === 0) {
          await loadAudioClipWaveform(tracksStore, mediaClip.id, mediaClip.sourceUrl);
        }
      }
    }
  }
}
