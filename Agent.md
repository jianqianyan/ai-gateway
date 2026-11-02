# Agent 维护与回归规范

> 本文件是 AI Gateway 项目的强制维护规范。任何 Agent / 开发者修改功能后，都必须按本文件执行回归测试，不能只验证接口，也不能只验证页面。

---

## 1. 项目事实

- 后端：NestJS 11 + Prisma + MySQL 8.0 + Redis
- 前端：Vue 3 + Element Plus + Element Plus X（`vue-element-plus-x`）
- 部署：Docker Compose（MySQL、Redis、API、Node Web、可选 Mock 上游）
- Web 入口：http://localhost:8080
- API：http://localhost:3000
- Mock 上游：http://localhost:4010（`--profile test`）
- 测试账号：`admin / Admin@123456`、`viewer / Viewer@123456`

### 镜像强制规则

所有 Docker 镜像必须使用国内镜像前缀：

```text
docker.m.daocloud.io/
```

包括：

- `docker-compose.yml` 中的 `image:`
- 所有 Dockerfile 的 `FROM`
- 新增服务、基础镜像、Sidecar 均遵守此规则

`pnpm test:regression` 会静态检查该规则；不合规会直接失败。

---

## 2. 测试分层

| 层级 | 位置 | 要求 |
|---|---|---|
| 单元测试 | `apps/api/src/**/*.spec.ts` | 纯逻辑必须单测：敏感匹配、IP/CIDR、限流算法、密钥处理等 |
| API 功能回归 | `scripts/regression-api.mjs` | 每个后端功能点至少一个正向 + 一个反向/边界用例 |
| 页面回归 | `scripts/regression-ui.mjs` | 每个页面必须真实浏览器打开；核心页面必须操作表单/按钮，不能只看标题 |
| 核心验收 | `scripts/smoke-test.mjs` | 从 Docker Web 入口走完整用户链路 |
| UI 冒烟 | `scripts/ui-smoke.mjs` | 全部页面渲染、管理员/只读账号切换 |
| 一键回归 | `scripts/regression.mjs` | 镜像检查 + 健康检查 + 单元 + API + 页面 |

### 不允许的“测试”

- 只 curl 一个接口就宣称功能完成。
- 只打开页面截图，不验证交互。
- 只测管理员，不测 `viewer` 只读权限。
- 只测非流式，不测 SSE 流式。
- 只测正常路径，不测拦截、限流、配额、过期/吊销。
- 修改后不跑全量回归。

---

## 3. 必跑命令

### 启动全栈

```bash
docker compose --profile test up -d --build
```

### 一键全量回归（提交/交付前必须绿）

```bash
# Windows PowerShell
$env:BASE_URL='http://localhost:8080'
$env:MOCK_ORIGIN='http://mock-upstream:4010'
pnpm test:regression
```

它依次执行：

1. Docker 镜像前缀检查
2. `/health`（DB + Redis）
3. 后端单元测试
4. API 功能回归（当前 153 项断言）
5. 浏览器页面回归（当前 23 项断言）

### 分项执行

```bash
pnpm test             # 后端单元测试
pnpm test:api         # API 功能回归
pnpm test:ui          # 页面/浏览器回归
pnpm test:ui:smoke    # 页面渲染 + 账号切换冒烟
pnpm smoke            # 核心链路验收
```

### 页面测试环境

- 需要本机 Chrome；默认路径：
  `C:\Program Files\Google\Chrome\Application\chrome.exe`
- 可用 `CHROME_PATH` 覆盖。
- 可用 `UI_BASE` 覆盖 Web 地址。
- 页面测试会真实登录、创建/删除临时 Provider/Model/Key、执行敏感规则测试、发送流式对话、验证 `viewer` 只读。

---

## 4. 功能点 → 测试映射

| 功能点 | 自动化覆盖 |
|---|---|
| 健康检查 / DB / Redis | `regression.mjs`、`smoke-test.mjs` |
| 管理员 / 只读账号登录 | API: login group；UI: 管理员 + viewer 登录 |
| Refresh Token 旋转 / Logout 吊销 | API: `auth refresh rotation + logout revocation` |
| 修改密码 | API: `user CRUD + password change` |
| 账号 CRUD / 角色 / 状态 | API: user group；UI: 账号管理页 |
| 上游 CRUD / 凭证加密与掩码 | API: provider group；UI: 上游新建/删除 |
| 上游连通性测试 / 模型同步 | API: provider group；UI: 上游页 |
| 上游模型手工添加/修改/删除 | API: provider group |
| 公共模型 CRUD | API: model group；UI: 模型新建/删除 |
| 模型路由优先级/权重/删除 | API: model group |
| Key 签发 / 列表 / 详情 / 编辑 | API: key group；UI: Key 向导 |
| Key 轮换 / 禁用 / 启用 / 吊销 / 删除 | API: key group |
| Key 模型白名单 | API: `/v1/models`、model deny case |
| Key 用量统计 | API: `key usage` |
| OpenAI 兼容非流式/流式 | API: gateway protocols；UI: 在线调试 |
| Anthropic / Gemini 适配 | API: gateway protocols |
| IP 白名单 | API: IP deny case |
| RPM 限流 | API: RPM case |
| 每日请求限制 | API: daily case |
| TPM 限制 | API: TPM case |
| 请求配额 | API: quota case |
| 输入敏感阻断 | API: sensitive group；UI: 规则测试器 |
| 输出敏感阻断（含流式跨 chunk） | API: sensitive group |
| 脱敏 MASK | API: sensitive group + builtin PII |
| 仅记录 LOG | API: sensitive group + 日志验证 |
| 敏感规则 CRUD | API: sensitive group；UI: 规则测试器 |
| 敏感策略集 CRUD | API: sensitive group |
| 日志查询 / 详情 / 正文 / 导出 | API: logs group；UI: 日志详情 + CSV |
| 仪表盘统计 / 趋势 / Top | API: stats group；UI: 仪表盘 + 范围切换 |
| 系统设置读取/保存 | API: settings group；UI: 设置页 |
| 审计日志 | API: audit group；UI: 审计页 |
| 在线调试 SSE | API: playground group；UI: 流式对话 |
| 只读账号全页面权限 | API: viewer group；UI: viewer 页面 |
| Docker 镜像国内源 | `regression.mjs` 静态检查 |
| Docker 启动 / 迁移 / 种子 | `smoke-test.mjs` + `/health` |

---

## 5. 新增功能时必须做的事

按顺序执行，缺一不可：

1. **实现功能**，同时补充必要的 DTO 校验、错误码、审计和日志。
2. **写单元测试**：如果包含纯函数/算法/匹配/限流逻辑，必须在 `*.spec.ts` 中覆盖。
3. **写 API 回归**：在 `scripts/regression-api.mjs` 增加分组或断言，至少覆盖：
   - 正常路径
   - 权限/未授权路径
   - 参数错误或边界
   - 数据清理（使用 `reg-` 前缀并在 `finally` 清理）
4. **写页面回归**：在 `scripts/regression-ui.mjs` 增加真实浏览器操作，至少覆盖：
   - 页面能打开
   - 关键按钮/表单可用
   - 数据写入后能在列表/详情看到
   - 权限角色表现正确
5. **更新测试矩阵**：在 `docs/测试矩阵.md` 增加对应行。
6. **跑全量回归**：`pnpm test:regression` 必须 0 失败。
7. **更新文档**：README / 验收报告 / Agent.md 如涉及新命令、新页面、新配置则同步更新。

---

## 6. 测试数据规范

- API 回归统一使用 `reg-<timestamp>-` 前缀。
- 页面回归统一使用 `ui-<timestamp>-` 前缀。
- 测试开始前清理旧前缀数据，结束后在 `finally` 清理。
- 不删除、不改写：
  - `admin` / `viewer` 种子账号
  - 默认敏感策略
  - 内置敏感规则
  - 演示数据 `demo-*`（除非测试目标就是清理）
- 不把真实厂商 Key、JWT、刷新令牌写入测试脚本或截图。

---

## 7. 回归失败处理

1. 先看失败分组和截图：`docs/screenshots/ui-regression-failure.png`。
2. 判断是产品缺陷还是测试脆弱：
   - 产品缺陷：修代码。
   - 测试脆弱：修选择器/等待条件，禁止直接删除断言。
3. 重新执行失败分组，再执行 `pnpm test:regression`。
4. 不允许通过 `--skip`、注释断言、放宽权限来“通过”测试。

---

## 8. 提交/交付检查清单

- [ ] `docker compose --profile test up -d --build` 成功
- [ ] `docker compose --profile test ps` 全部 healthy/running
- [ ] `pnpm test:regression` 全部通过
- [ ] 管理员 + `viewer` 都能登录
- [ ] 在线调试能流式返回
- [ ] 输入/输出敏感拦截可在日志中看到
- [ ] 所有镜像带 `docker.m.daocloud.io/` 前缀
- [ ] 没有明文上游 Key / 网关 Key 出现在日志或审计中
- [ ] 更新 `docs/测试矩阵.md` 和 `docs/验收报告.md`

---

## 9. 已知环境边界

- Docker Desktop 端口映射下，网关看到的客户端 IP 可能是 Docker 网关地址；生产应通过可信反向代理并正确配置 `TRUST_PROXY`。
- 并发限流的并发触发测试受 Mock 响应速度影响，单元测试覆盖算法，API 回归覆盖 RPM/每日/TPM/配额。
- UI 测试依赖本机 Chrome；CI 环境需要安装 Chrome 或设置 `CHROME_PATH`。
- 测试使用 Mock 上游，真实厂商行为需另行做连通性验证。
