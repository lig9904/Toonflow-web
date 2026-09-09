import axios from "axios";
import router from "@/router/index";
import { storeToRefs } from "pinia";
import { MessagePlugin, NotifyPlugin, type TNode } from "tdesign-vue-next";
import settingStore from "@/stores/setting";
import userStore from "@/stores/user";
import { h } from "vue";
import { isLegacyExchangePath } from "@/utils/sessionContract";
const instance = axios.create();

instance.interceptors.request.use(function (config) {
  const { baseUrl, otherSetting } = storeToRefs(settingStore());
  config.baseURL = baseUrl.value;
  config.timeout = otherSetting.value.axiosTimeOut;
  config.withCredentials = true;
  const requestPath = String(config.url ?? "").split("?")[0];
  const legacyToken = localStorage.getItem("token");
  // Legacy bearer migration is the sole request allowed to carry the old token.
  if (legacyToken && isLegacyExchangePath(requestPath)) config.headers.Authorization = legacyToken;

  return config;
});

instance.interceptors.response.use(
  function (response) {
    return response.data;
  },
  function (error) {
    const httpStatus = error?.status ?? error?.response?.status;
    if (httpStatus === 401 || ["USER_DISABLED", "SESSION_REVOKED", "SESSION_INVALID"].includes(error?.response?.data?.code)) {
      const requestPath = String(error?.config?.url ?? "").split("?")[0];
      const isExchange = isLegacyExchangePath(requestPath);
      // A legacy token is deleted only by a successful exchange or explicit logout.
      userStore().clearSession({ removeLegacyToken: false, reason: isExchange ? "exchange-failed" : "expired" });
      if (!isExchange && router.currentRoute.value.path !== "/login") {
        router.push("/login");
        MessagePlugin.error(window.$t("common.sessionExpired"));
      }
    }
    if (error?.message?.includes("Network Error") || error?.response?.data?.message === "Network Error") {
      NotifyPlugin.error({
        title: "Network Error",
        closeBtn: true,
        duration: 3000, // 不自动关闭，让用户有时间看
        className: "customNotifyFull", // 自定义类名
        content: () =>
          h("div", [
            h("div", { style: { marginBottom: "8px" } }, "网络连接失败，请依次尝试："),
            h("div", { style: { marginBottom: "4px" } }, "1. 右键程序图标 → 以管理员身份运行"),
            h("div", { style: { marginBottom: "4px" } }, "2. 检查后端服务是否已正常启动"),
            h("div", [
              "3. 安装 Visual C++ 运行库：",
              h("div", { style: { display: "flex", gap: "8px", marginTop: "4px" } }, [
                h(
                  "a",
                  {
                    href: "https://aka.ms/vs/17/release/vc_redist.x86.exe",
                    target: "_blank",
                    rel: "noopener noreferrer",
                    style: { color: "#0052d9" },
                  },
                  "32位下载",
                ),
                h(
                  "a",
                  {
                    href: "https://aka.ms/vs/17/release/vc_redist.x64.exe",
                    target: "_blank",
                    rel: "noopener noreferrer",
                    style: { color: "#0052d9" },
                  },
                  "64位下载",
                ),
              ]),
            ]),
          ]),
      });
    }

    const responseData = error?.response?.data;
    const responseStatus = error?.response?.status;
    if (responseData && typeof responseData === "object") {
      return Promise.reject({ ...responseData, status: responseData.status ?? responseStatus });
    }
    if (responseStatus != null) {
      return Promise.reject({ ...error, status: responseStatus });
    }
    return Promise.reject(error);
  },
);

export default instance;
