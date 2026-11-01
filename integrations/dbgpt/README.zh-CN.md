# dbgpt 配套改造

本目录的 `whitelist-automation.patch` 只包含本次新增的自动审批改造，基于用户现有 dbgpt 工作区；不包含其已有的其他改动、模型配置、登录令牌或申请数据。`file-hashes.json` 记录本次修改前后各文件的 SHA-256。

这是与本次工作区版本匹配的集成补丁，不是通用于所有上游 DB-GPT 版本的插件。应用前执行：

```bash
cd /path/to/dbgpt
git apply --check /path/to/nanobrowser/integrations/dbgpt/whitelist-automation.patch
git apply /path/to/nanobrowser/integrations/dbgpt/whitelist-automation.patch
```

若上下文不匹配，先核对版本与文件差异，不使用强制应用。已有改动应先保留。补丁已在本次修改前的工作区副本上实际应用，并核对全部 10 个结果文件的哈希。

停止后端后备份原申请与白名单 JSON；重启时自动在同目录建立 `expert_mode.sqlite3` 并导入，原 JSON 不修改。正式使用后备份 SQLite，此后不要通过编辑旧 JSON 更改运行数据。

按项目 PROJECT.md 启动服务。本次未新增 Python 依赖；存储使用标准库 SQLite，服务运行在原应用内。后台任务默认关闭，使用插件的 **平台与自动审批** 页面登录管理员后启用。

相关验证：

```bash
uv run pytest \
  packages/dbgpt-app/src/dbgpt_app/tests/test_expert_mode_access.py \
  packages/dbgpt-app/src/dbgpt_app/tests/test_expert_whitelist_store.py \
  packages/dbgpt-app/src/dbgpt_app/tests/test_expert_whitelist_http.py -q
```

完整配置、范围限制、任务恢复及桌面通知行为见 [使用说明](../../docs/whitelist-automation-usage.zh-CN.md)。
