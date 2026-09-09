<template>
  <div class="about">
    <t-card bordered class="editionCard">
      <div class="editionHeader">
        <img src="@/assets/logo.png" alt="ToonFlow Logo" class="logo" />
        <div class="editionInfo">
          <div class="editionName">{{ $t("settings.about.customEdition") }}</div>
          <div class="editionSlogan">{{ $t("settings.about.slogan") }}</div>
          <t-tag v-if="version" theme="primary" shape="round" size="small">v{{ version }}</t-tag>
        </div>
      </div>
    </t-card>

    <t-card bordered class="noticeCard">
      <div class="sectionTitle">{{ $t("settings.about.updateTitle") }}</div>
      <div class="noticeText">{{ $t("settings.about.adminDeploymentNotice") }}</div>
    </t-card>

    <section class="repositorySection">
      <div class="sectionTitle">{{ $t("settings.about.codeRepository") }}</div>
      <t-card bordered class="repositoryCard">
        <button class="repositoryItem" type="button" @click="openLink('https://github.com/lig9904/Toonflow-app')">
          <span class="repositoryIcon"><i-github theme="outline" size="22" /></span>
          <span class="repositoryText">
            <strong>{{ $t("settings.about.backendFork") }}</strong>
            <small>https://github.com/lig9904/Toonflow-app</small>
          </span>
          <i-right theme="outline" size="18" />
        </button>
        <t-divider />
        <button class="repositoryItem" type="button" @click="openLink('https://github.com/lig9904/Toonflow-web')">
          <span class="repositoryIcon"><i-github theme="outline" size="22" /></span>
          <span class="repositoryText">
            <strong>{{ $t("settings.about.frontendFork") }}</strong>
            <small>https://github.com/lig9904/Toonflow-web</small>
          </span>
          <i-right theme="outline" size="18" />
        </button>
      </t-card>
    </section>

    <section class="upstreamSection">
      <div class="sectionTitle">{{ $t("settings.about.upstreamTitle") }}</div>
      <t-card bordered class="repositoryCard">
        <button class="repositoryItem" type="button" @click="openLink('https://github.com/HBAI-Ltd/Toonflow-app')">
          <span class="repositoryIcon"><i-github theme="outline" size="22" /></span>
          <span class="repositoryText">
            <strong>{{ $t("settings.about.upstreamProject") }}</strong>
            <small>https://github.com/HBAI-Ltd/Toonflow-app</small>
          </span>
          <i-right theme="outline" size="18" />
        </button>
        <t-divider />
        <button class="repositoryItem" type="button" @click="openLink('https://github.com/HBAI-Ltd/Toonflow-app?tab=Apache-2.0-1-ov-file')">
          <span class="repositoryIcon"><i-notes theme="outline" size="22" /></span>
          <span class="repositoryText">
            <strong>Apache-2.0</strong>
            <small>{{ $t("settings.about.licenseDesc") }}</small>
          </span>
          <i-right theme="outline" size="18" />
        </button>
      </t-card>
    </section>
  </div>
</template>

<script setup lang="ts">
import axios from "@/utils/axios";
import store from "@/stores/index";
import settingStore from "@/stores/setting";

const { version } = storeToRefs(store());
const { isElectron } = storeToRefs(settingStore());

async function openLink(url: string) {
  if (isElectron.value) {
    await fetch(`toonflow://openurlwithbrowser?url=${encodeURIComponent(url)}`);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

onMounted(async () => {
  const { data } = await axios.get("/other/getVersion");
  version.value = data;
});
</script>

<style lang="scss" scoped>
.about {
  display: flex;
  flex-direction: column;
  gap: 16px;

  .editionCard,
  .noticeCard,
  .repositoryCard {
    width: 100%;
  }

  .editionCard,
  .noticeCard,
  .repositoryCard {
    padding: 16px;
  }

  .editionHeader {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .logo {
    width: 72px;
    height: 72px;
    border-radius: 16px;
    background: #ececec;
  }

  .editionInfo {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }

  .editionName {
    font-size: 20px;
    font-weight: 900;
  }

  .editionSlogan,
  .noticeText,
  .repositoryText small {
    color: var(--td-text-color-secondary);
    font-size: 12px;
  }

  .sectionTitle {
    margin-bottom: 8px;
    font-size: 13px;
    font-weight: 700;
  }

  .noticeText {
    line-height: 1.6;
  }

  .repositorySection,
  .upstreamSection {
    display: flex;
    flex-direction: column;
  }

  .repositoryItem {
    display: flex;
    align-items: center;
    width: 100%;
    gap: 12px;
    padding: 4px 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .repositoryItem:hover .repositoryText strong {
    color: var(--td-brand-color);
  }

  .repositoryIcon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    background: var(--td-bg-color-secondarycontainer);
  }

  .repositoryText {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;
  }

  .repositoryText strong {
    font-size: 14px;
  }
}
</style>
