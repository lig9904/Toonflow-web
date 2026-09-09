# 分镜协作状态

分镜编辑使用 `/production/storyboard/getState` 获取服务器内容和协作状态。保存内容时必须把打开编辑时读取到的 `state.version` 作为 `expectedVersion`，前端不会在提交前自动读取最新版本覆盖草稿。

状态变更接口如下：

- `POST /production/storyboard/editStoryboardInfo`：`projectId`、`id`、`expectedVersion`、`prompt`、`videoDesc`
- `POST /production/storyboard/updateStoryboardUrl`：`projectId`、`id`、`expectedVersion`、`url`、`flowId`
- `POST /production/storyboard/setReviewState`：`projectId`、`id`、`expectedVersion`、`reviewState`
- `POST /production/storyboard/setLock`：`projectId`、`id`、`expectedVersion`、`locked`

删除接口使用同一版本门禁：单条 `removeFrame` 接收 `expectedVersion`，批量 `batchDelete` 接收按 storyboard id 对应的 `expectedVersions`。

接口成功返回 `{ data: { storyboard, state } }` 时，工作流中的对应分镜会以返回值更新。`409`、`423`、`403` 会保留当前草稿并在编辑框中提示，用户可以明确点击“重新载入”取得新的服务器基线。未成功读取状态或状态为锁定时，内容、审核和图片写入会被门禁。

工作流数据中的分镜可带有 `collaboration` 状态快照；前端仍以打开编辑时的 `getState` 返回值作为提交基线。

production agent socket 的 `productionStateChanged` 事件只接受当前项目、当前剧本和事件中的 `storyboardId`，随后请求该分镜状态；打开编辑框期间该分镜不会被事件刷新覆盖。

工作流规划保存使用 `getFlowData` 返回的 `planningVersion`。保存请求串行发送并只排队最新快照，携带 `expectedPlanningVersion`；成功后用返回的 `planningVersion` 和 `storyboardVersions` 更新本地状态。规划冲突只提示并保留本地草稿，显式重新载入前不会覆盖。

## 最小验证矩阵

1. 打开已有分镜编辑框，确认表单来自状态接口返回的服务器内容，并记录版本号。
2. 在另一个会话修改同一分镜后提交，确认当前草稿保留并显示冲突；点击“重新载入”后表单才改变。
3. 锁定分镜后确认内容提交、审核按钮和图片保存被禁止；解锁成功后版本号更新。
4. 发送 `productionStateChanged` 时确认只有对应分镜刷新，打开编辑框中的草稿不被覆盖。
