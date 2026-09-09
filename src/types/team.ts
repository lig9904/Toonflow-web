export const teamRoles = ["admin", "editor", "viewer"] as const;
export type TeamRole = (typeof teamRoles)[number];

export interface TeamUser {
  id: number;
  name: string;
  role: TeamRole;
  enabled: boolean;
  version: number;
}

export interface TeamCapabilities {
  manageMembers: boolean;
  edit: boolean;
  review: boolean;
}

export interface TeamMeResponse {
  user: TeamUser;
  capabilities: TeamCapabilities;
}

export interface TeamListUsersResponse {
  users: TeamUser[];
}

export function normalizeTeamRole(value: unknown): TeamRole {
  return value === "admin" || value === "editor" || value === "viewer" ? value : "viewer";
}
