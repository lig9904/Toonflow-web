import axios from "@/utils/axios";

export type StoryboardReviewState = "draft" | "pending" | "approved" | "revision";

export interface StoryboardState {
  entityType: "storyboard";
  entityId: number;
  projectId: number | string;
  version: number;
  reviewState: StoryboardReviewState;
  locked: boolean;
  lockedBy: string | null;
  updatedBy: string | null;
  updatedAt: number | null;
}

export interface StoryboardStateRecord {
  id: number;
  prompt?: string | null;
  videoDesc?: string | null;
  src?: string | null;
  [key: string]: unknown;
}

export interface StoryboardStateResponse {
  storyboard: StoryboardStateRecord;
  state: StoryboardState;
}

export class ProductionStateError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ProductionStateError";
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

/** Axios interceptor returns the API body; accept both body and { data } wrappers. */
export function unwrapProductionStateResponse(value: unknown): StoryboardStateResponse {
  const body = isRecord(value) && isRecord(value.data) ? value.data : value;
  if (!isRecord(body) || !isRecord(body.storyboard) || !isRecord(body.state)) {
    throw new ProductionStateError("分镜状态响应格式无效");
  }
  return body as unknown as StoryboardStateResponse;
}

export function getProductionStateErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const response = isRecord(error.response) ? error.response : undefined;
  const responseData = response && isRecord(response.data) ? response.data : undefined;
  const candidates = [error.status, error.statusCode, error.code, response?.status, responseData?.status, responseData?.statusCode, responseData?.code];
  const status = candidates.find((candidate) => typeof candidate === "number" || (typeof candidate === "string" && /^\d{3}$/.test(candidate)));
  return status == null ? undefined : Number(status);
}

export function getProductionStateErrorMessage(error: unknown, fallback = "分镜状态操作失败"): string {
  if (!isRecord(error)) return fallback;
  const responseData = isRecord(error.response) && isRecord(error.response.data) ? error.response.data : undefined;
  const message = error.message ?? responseData?.message;
  return typeof message === "string" && message.trim() ? message : fallback;
}

function unwrapRequest(value: unknown): StoryboardStateResponse {
  const response = unwrapProductionStateResponse(value);
  if (response.state.entityType !== "storyboard") {
    throw new ProductionStateError("分镜状态实体类型无效");
  }
  return response;
}

export async function getStoryboardState(projectId: number | string, id: number): Promise<StoryboardStateResponse> {
  const response = await axios.post("/production/storyboard/getState", { projectId, id });
  return unwrapRequest(response);
}

export async function editStoryboardInfo(
  projectId: number | string,
  id: number,
  expectedVersion: number,
  prompt: string,
  videoDesc: string,
): Promise<StoryboardStateResponse> {
  const response = await axios.post("/production/storyboard/editStoryboardInfo", {
    projectId,
    id,
    expectedVersion,
    prompt,
    videoDesc,
  });
  return unwrapRequest(response);
}

export async function updateStoryboardUrl(
  projectId: number | string,
  id: number,
  expectedVersion: number,
  url: string,
  flowId: number,
): Promise<StoryboardStateResponse | undefined> {
  const response = await axios.post("/production/storyboard/updateStoryboardUrl", { projectId, id, expectedVersion, url, flowId });
  if (response == null) return undefined;
  try {
    return unwrapRequest(response);
  } catch {
    return undefined;
  }
}

export async function setStoryboardReviewState(
  projectId: number | string,
  id: number,
  expectedVersion: number,
  reviewState: StoryboardReviewState,
): Promise<StoryboardStateResponse> {
  const response = await axios.post("/production/storyboard/setReviewState", { projectId, id, expectedVersion, reviewState });
  return unwrapRequest(response);
}

export async function setStoryboardLock(
  projectId: number | string,
  id: number,
  expectedVersion: number,
  locked: boolean,
): Promise<StoryboardStateResponse> {
  const response = await axios.post("/production/storyboard/setLock", { projectId, id, expectedVersion, locked });
  return unwrapRequest(response);
}
