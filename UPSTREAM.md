# Upstream 同步约定

上游：https://github.com/HBAI-Ltd/Toonflow-web

Fork：https://github.com/lig9904/Toonflow-web

2026-09-09 拉取基线：

- `upstream/master`: `9c4cb0ec7d4f6b4067c7768e2df8cdc7f8587214`
- `upstream/develop`: `2e3321168884f65649c19b1bc832b1d30746f80b`
- 本地工作分支：`custom/main`，起点为 `origin/master`。
- 本地稳定基线：`upstream-sync/master`；官方 master/develop/solo 历史保留在 upstream 远端跟踪分支。
- 初始 Fork 只复制了 master；定制源码在 custom/main 分支维护，master 保留上游基线。

同步先 `git fetch upstream`，审查 master 的具体变化，再集成到 custom/main。develop 修复须逐项核对、移植并复测，不整体合并分叉分支。保留 LICENSE 与 NOTICES.txt。

定制版关于页面展示我们自己的前后端 Fork 和服务器版本；原项目作为上游来源保留。原版更新源选择、下载安装和隐藏自定义更新地址入口均不再用于这个 Fork。更新通过管理员审查代码、测试、构建和部署进行。

媒体修复来源：后端 PR #245（`ee7eccb1aed069ef9b6eaf6286d28366568a4791`，merge `d92edb5f4112153a2375d2d4c5a9714ff30bc51d`），前端 `cff23f72fccf592e166797417efee1414a3afca5`。保留来源和本地修正，后续上游包含这些改动时优先消除重复补丁。
