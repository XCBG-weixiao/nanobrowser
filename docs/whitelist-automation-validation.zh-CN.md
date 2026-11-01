# 白名单自动审批验证记录

日期：2026-11-02。以下为本次实际执行结果；不代表已完成长期生产运行验证。

| 检查 | 结果 |
| --- | --- |
| Nanobrowser 类型检查 | `pnpm type-check` 通过 |
| Nanobrowser ESLint | `pnpm lint` 通过 |
| Nanobrowser 格式检查 | `pnpm exec prettier --check .` 通过 |
| Nanobrowser 单元测试 | 74 个测试文件通过，827 项通过，4 项跳过；另有 1 个文件跳过 |
| Chrome：platform-scope | 通过：允许文档、范围外 iframe 排除、截图/键盘/滚轮限制、弹窗内容排除、路径/源/重定向限制 |
| Chrome：platform-notifications | 通过：实际创建 Chrome 通知、服务端确认、重复拉取不重复确认、设置界面渲染 |
| Chrome：platform-chat | 通过：真实 Agent loop 调用业务工具，启用前必须确认，确认后启用模拟服务，平台令牌未进入模型请求 |
| Chrome：permission-warnings | 通过：未增加安装权限警告 |
| dbgpt 业务和 HTTP 测试 | 29 项通过：迁移、存量与新增、同工号多次申请、并发、状态冲突、撤销、幂等、事务回滚、通知、鉴权、启停、重启与实际自定义 lifespan 注册 |
| dbgpt 新增 Python 文件 | Ruff 格式和检查通过；修改的服务入口、鉴权与 API 文件检查 F401/F821 通过 |
| dbgpt 修改页面 | 单独语义类型检查为 0 项错误；开发服务访问白名单页面返回 HTTP 200 |
| dbgpt 全项目 TypeScript | 编译器崩溃：`Debug Failure. No error for last overload signature`；用修改前页面替换虚拟编译源后仍复现，属于既有工作区问题，未宣称全项目类型检查通过 |
| 现有 DeepSeek 模型合成测试 | `deepseek-v4-pro`，查询状态、暂停和开启三项均通过；只使用人工构造数据和模拟回执，未调用真实审批 |
| Linux x64 离线构建 | amd64 容器、`--network none`、Node 24.22.1、pnpm 10.34.7；从离线 store 安装并构建成功，扩展总大小约 4.05 MB |
| dbgpt 补丁 | 在修改前工作区副本实际执行 `git apply --check` 和应用，全部 10 个结果文件 SHA-256 与本地改造结果一致 |
| 实际本机服务 | 后端健康接口 HTTP 200；未登录访问任务接口 HTTP 401；重启后建立业务数据库，任务默认未启用 |

Chrome 测试使用独立 Chrome for Testing，传入 `--use-mock-keychain`，不使用真实用户登录状态。真实模型合成结果见 [model-simulation.json](../integrations/dbgpt/validation/model-simulation.json)。

没有进行 24—72 小时连续运行、生产负载测试或实际内网模型测试。实际系统桌面通知的可见性仍取决于 Chrome 权限、操作系统通知设置和免打扰状态。

本地 dbgpt 原有未提交改动保留；本仓库提供的集成补丁仅包含本次增量，未包含模型配置、令牌或实际业务数据。
