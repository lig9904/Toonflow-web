export interface SessionUserData {
  authenticated: boolean;
  id: number | string;
  name: string;
  role: string;
}

export function isLegacyExchangePath(path: string): boolean {
  return path.split("?")[0].endsWith("/session/exchange");
}

export function normalizeSessionUser(response: any): SessionUserData | null {
  const value = response?.data ?? response;
  const data = value?.user ? { authenticated: true, ...value.user } : value;
  if (!data?.authenticated || data.id == null || !data.name) return null;
  return { authenticated: true, id: data.id, name: String(data.name), role: String(data.role ?? "viewer") };
}
