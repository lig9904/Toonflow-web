export interface AuthUser {
  id: number;
  name: string;
  role: "admin" | "editor" | "viewer" | string;
}

const AUTH_MARKER = "toonflow.authenticated";
const AUTH_USER = "toonflow.user";

function readUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(AUTH_USER);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<AuthUser>;
    if (!Number.isFinite(Number(value.id)) || !value.name) return null;
    return { id: Number(value.id), name: String(value.name), role: String(value.role ?? "viewer") };
  } catch {
    return null;
  }
}

export default defineStore("user", () => {
  const user = ref<AuthUser | null>(readUser());
  const authenticated = ref(localStorage.getItem(AUTH_MARKER) === "1" && Boolean(user.value));

  function setSession(value: { authenticated?: boolean; id: number | string; name: string; role: string }) {
    const next: AuthUser = { id: Number(value.id), name: value.name, role: value.role };
    user.value = next;
    authenticated.value = value.authenticated !== false;
    if (authenticated.value) {
      localStorage.setItem(AUTH_MARKER, "1");
      localStorage.setItem(AUTH_USER, JSON.stringify(next));
      localStorage.removeItem("userId");
      // A successful login or exchange is the only point where a legacy token is removed.
      localStorage.removeItem("token");
    }
  }

  function clearSession(options: { removeLegacyToken?: boolean; reason?: string } = {}) {
    user.value = null;
    authenticated.value = false;
    localStorage.removeItem(AUTH_MARKER);
    localStorage.removeItem(AUTH_USER);
    localStorage.removeItem("userId");
    if (options.removeLegacyToken !== false) localStorage.removeItem("token");
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("toonflow:auth-cleared", { detail: { reason: options.reason ?? "expired" } }));
  }

  function hasSessionMarker(): boolean {
    return authenticated.value && Boolean(user.value);
  }

  return { user, authenticated, setSession, clearSession, hasSessionMarker };
}, { persist: false });
