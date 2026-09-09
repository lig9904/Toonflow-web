import axios from "@/utils/axios";
import userStore from "@/stores/user";
import { normalizeSessionUser } from "@/utils/sessionContract";

/** Restore the HttpOnly cookie session, migrating one legacy bearer token if present. */
export async function bootstrapSession(): Promise<boolean> {
  const store = userStore();
  const legacyToken = localStorage.getItem("token");
  if (legacyToken) {
    try {
      const data = normalizeSessionUser(await axios.post("/session/exchange"));
      if (!data) throw new Error("会话迁移响应无效");
      store.setSession(data);
      return true;
    } catch {
      // The token is deliberately retained: it may only be deleted after a successful exchange.
      store.clearSession({ removeLegacyToken: false, reason: "exchange-failed" });
      return false;
    }
  }

  try {
    const data = normalizeSessionUser(await axios.post("/team/me"));
    if (!data?.id || !data?.name) throw new Error("会话响应无效");
    store.setSession({ authenticated: true, id: data.id, name: data.name, role: data.role ?? "viewer" });
    return true;
  } catch {
    store.clearSession({ removeLegacyToken: false, reason: "session-invalid" });
    return false;
  }
}

export async function logoutSession(): Promise<void> {
  try {
    await axios.post("/session/logout");
  } finally {
    userStore().clearSession({ removeLegacyToken: true, reason: "logout" });
  }
}
