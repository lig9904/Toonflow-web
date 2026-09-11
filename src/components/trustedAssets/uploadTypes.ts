import type {TrustedAssetType, TrustedTargetScope} from './controller';
export interface TrustedUploadRequest extends TrustedTargetScope {
  remoteProjectName: string; groupId: string; groupType: 'AIGC'; name?: string; assetType: TrustedAssetType;
  mode: 'uploadOnly' | 'uploadAndBind'; expectedSourceVersion: number; expectedSourceFileHash: string; expectedBindingVersion: number | null;
}
export interface TrustedUploadReceipt extends TrustedTargetScope {
  operationId: string; idempotencyKey: string; remoteProjectName: string; groupId: string; assetType: TrustedAssetType;
  mode: 'uploadOnly' | 'uploadAndBind'; expectedBindingVersion: number | null;
  status: 'submission_unknown' | 'processing' | 'active' | 'failed' | 'rejected'; remoteAssetId: string | null;
  remoteName: string; remoteStatus: 'Processing' | 'Active' | 'Failed' | null;
  bindStatus: 'not_requested' | 'pending' | 'bound' | 'conflict' | 'failed'; sourceVersion: number; sourceFileHash: string;
  error: {code: string; message: string} | null; createdAt: number; updatedAt: number;
}
export interface TrustedGroupCreateRequest {projectId: number; remoteProjectName: string; name: string; description?: string; groupType: 'AIGC'}
export interface TrustedGroupCreateReceipt {operationId: string; idempotencyKey: string; projectId: number; remoteProjectName: string; status: 'submission_unknown' | 'created' | 'rejected'; remoteGroupId: string | null; remoteName: string; error: {code: string; message: string} | null; createdAt: number; updatedAt: number}
export const uploadTerminal = (receipt:TrustedUploadReceipt) => ['failed','rejected'].includes(receipt.status) || receipt.status === 'active' && receipt.bindStatus !== 'pending';
export function uploadReceiptLabel(receipt:TrustedUploadReceipt) {
  if(receipt.status === 'submission_unknown') return '上传受理状态待确认';
  if(receipt.status === 'processing') return '火山正在处理素材';
  if(receipt.status === 'failed' || receipt.status === 'rejected') return '上传未完成';
  if(receipt.status !== 'active') return '上传任务状态待确认';
  if(receipt.bindStatus === 'bound') return '素材已 Active，绑定已保存';
  if(receipt.bindStatus === 'pending') return '素材已 Active，正在保存绑定';
  if(receipt.bindStatus === 'conflict') return '上传完成，绑定存在版本冲突';
  if(receipt.bindStatus === 'failed') return '上传完成，绑定未保存';
  return '上传完成，尚未绑定';
}
