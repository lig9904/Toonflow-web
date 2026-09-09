import axios from "@/utils/axios";
import type { TeamCapabilities, TeamListUsersResponse, TeamMeResponse, TeamRole, TeamUser } from "@/types/team";
import { normalizeTeamRole } from "@/types/team";

function unwrap<T>(response: unknown): T {
  const value = response as { data?: unknown } | undefined;
  return (value && value.data !== undefined ? value.data : response) as T;
}

function normalizeUser(value: any): TeamUser {
  return {
    id: Number(value?.id),
    name: String(value?.name ?? ""),
    role: normalizeTeamRole(value?.role),
    enabled: value?.enabled !== false,
    version: Number(value?.version) || 0,
  };
}

export default defineStore("team", () => {
  const user = ref<TeamUser | null>(null);
  const capabilities = ref<TeamCapabilities>({ manageMembers: false, edit: false, review: false });
  const users = ref<TeamUser[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function refreshMe(): Promise<TeamMeResponse> {
    const response = await axios.post("/team/me");
    const data = unwrap<TeamMeResponse>(response);
    user.value = data?.user ? normalizeUser(data.user) : null;
    capabilities.value = {
      manageMembers: data?.capabilities?.manageMembers === true,
      edit: data?.capabilities?.edit === true,
      review: data?.capabilities?.review === true,
    };
    return { user: user.value as TeamUser, capabilities: capabilities.value };
  }

  async function listUsers(): Promise<TeamUser[]> {
    const response = await axios.post("/team/listUsers");
    const data = unwrap<TeamListUsersResponse>(response);
    users.value = Array.isArray(data?.users) ? data.users.map(normalizeUser) : [];
    return users.value;
  }

  async function refresh() {
    loading.value = true;
    error.value = null;
    try {
      await refreshMe();
      if (capabilities.value.manageMembers) await listUsers();
    } catch (reason: any) {
      error.value = reason?.message ?? "团队信息读取失败";
      throw reason;
    } finally {
      loading.value = false;
    }
  }

  async function createUser(input: { name: string; password: string; role: TeamRole }): Promise<TeamUser> {
    const response = await axios.post("/team/createUser", input);
    const data = unwrap<{ user: TeamUser }>(response);
    const created = normalizeUser(data.user);
    users.value = [...users.value.filter((item) => item.id !== created.id), created];
    return created;
  }

  async function updateUser(input: { id: number; expectedVersion: number; name?: string; role?: TeamRole; enabled?: boolean }): Promise<TeamUser> {
    const response = await axios.post("/team/updateUser", input);
    const data = unwrap<{ user: TeamUser }>(response);
    const updated = normalizeUser(data.user);
    users.value = users.value.map((item) => (item.id === updated.id ? updated : item));
    if (user.value?.id === updated.id) user.value = updated;
    return updated;
  }

  function clear() {
    user.value = null;
    users.value = [];
    capabilities.value = { manageMembers: false, edit: false, review: false };
    error.value = null;
  }

  return { user, capabilities, users, loading, error, refreshMe, listUsers, refresh, createUser, updateUser, clear };
});
