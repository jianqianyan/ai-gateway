# AI Gateway

统一的大模型接入网关：多上游协议适配、模型路由、Key 分发、模型/IP/频次/配额管控、输入输出敏感拦截、调用日志与管理控制台。

- 后端：NestJS 11 + TypeScript + Prisma + MySQL 8 + Redis
- 前端：Vue 3 + Element Plus + Element Plus X（`vue-element-plus-x`）+ ECharts
- 部署：Docker Compose（MySQL、Redis、API、Node Web、可选 Mock 上游）

---

## 1. 已实现功能

| 模块 | 能力 |
|---|---|
| 上游接入 | OpenAI-Compatible、Anthropic Messages、Gemini generateContent、Azure OpenAI（OpenAI 兼容方式） |
| 多来源 | 多 Provider、优先级、权重、启停、超时、重试、故障转移 |
| 模型管理 | 公共模型名、多上游路由、优先级/权重、能力标签、价格、启停 |
| Key 分发 | `sk-gw-` 高熵 Key、仅展示一次、SHA-256 哈希存储、轮换、禁用、吊销、过期 |
| 模型权限 | 每个 Key 独立模型白名单，默认不授权 |
| 调用日志 | requestId、Key、模型、上游、状态、耗时、TTFT、Token、成本、路由 attempts、拦截详情、CSV 导出 |
| 敏感拦截 | 关键词、正则、内置 PII/密钥规则；输入/输出双向；阻断/脱敏/仅记录；流式跨 chunk 检测；规则测试器 |
| 频率/IP/配额 | RPM、TPM、并发、每日请求、总请求/Token/成本配额、月度 Token/成本、IP/CIDR 白名单 |
| 控制台 | 仪表盘、上游、模型路由、Key 向导、日志、敏感规则、在线调试、账号、审计、设置 |
| 在线调试 | Element Plus X `Conversations` / `BubbleList` / `XSender`，流式对话、停止、重新生成、Token 展示 |
| 账号权限 | 管理员 `admin` 全权限；只读账号 `viewer` 可查看但不可修改 |
| 运维 | 健康检查、Docker Compose、Prisma 迁移、启动自动种子、结构化日志 |

---

## 2. 快速启动

### 2.1 环境要求

- Docker Desktop（含 Docker Compose v2）
- 本地端口：`8080`（Web）、`3000`（API）、`3307`（MySQL）、`6379`（Redis）、`4010`（Mock 上游）
- 当前 Dockerfile 使用 `docker.m.daocloud.io` 作为基础镜像加速源。若你的网络可直接访问 Docker Hub，可替换为官方镜像名；Web 运行时已改为 Node 静态服务器，不再依赖 Nginx 镜像。

### 2.2 启动（含 Mock 上游，适合演示/验收）

```bash
docker compose --profile test up -d --build
```

首次构建需要下载依赖，耗时取决于网络。启动后：

- 管理端：http://localhost:8080
- API：http://localhost:3000
- 健康检查：http://localhost:3000/health
- Mock 上游：http://localhost:4010

查看状态：

```bash
docker compose ps
docker compose logs -f api
```

当前演示库已包含干净的三协议演示数据。若在空库上重新生成：

```bash
node scripts/seed-demo.mjs
```

### 2.3 默认账号

| 角色 | 用户名 | 密码 | 权限 |
|---|---|---|---|
| 管理员 | `admin` | `Admin@123456` | 全部配置、签发 Key、查看日志 |
| 只读用户 | `viewer` | `Viewer@123456` | 只读查看，不能修改配置 |

> 首次部署后请立即在「账号管理」修改默认密码，或修改 `.env` 中的 `ADMIN_PASSWORD` / `VIEWER_PASSWORD` 并重建数据库卷。

### 2.4 一键验收

在仓库根目录执行：

```bash
# Windows PowerShell
$env:BASE_URL='http://localhost:8080'
$env:MOCK_ORIGIN='http://mock-upstream:4010'
node scripts/smoke-test.mjs
```

覆盖：

- 管理员 / 只读账号登录与权限
- 上游创建、模型同步、连通性测试
- 公共模型 + 路由
- Key 签发、模型白名单、IP 白名单
- OpenAI / Anthropic / Gemini 三种上游非流式与流式调用
- 输入敏感词阻断、输出敏感内容拦截
- RPM、并发、请求配额、Key 吊销
- 日志查询、详情、正文捕获
- 仪表盘统计

UI 冒烟测试（需要本机 Chrome，先启动 Vite）：

```bash
pnpm --filter @ai-gateway/web dev --host 127.0.0.1
node scripts/ui-smoke.mjs
```

截图输出在 `docs/screenshots/`。

---

## 3. 使用流程

### 3.1 配置真实上游

1. 登录管理端 → **上游管理** → 添加上游。
2. 选择协议类型并填写 Base URL：

| 类型 | Base URL 示例 | 说明 |
|---|---|---|
| OpenAI-Compatible | `https://api.openai.com/v1` | 也适用于 DeepSeek、Qwen、Moonshot、Ollama、vLLM、OneAPI 等兼容接口 |
| Anthropic | `https://api.anthropic.com/v1` | 使用 Messages 协议 |
| Gemini | `https://generativelanguage.googleapis.com/v1beta` | 使用 generateContent |
| Azure OpenAI | `https://<resource>.openai.azure.com/openai/deployments` | 在自定义请求头中加 `{"api-version":"2024-10-21"}`，上游模型名填 deployment 名 |

3. 保存后点 **测试**；OpenAI/Gemini 可点 **同步** 拉取模型；Anthropic 需在详情页 **添加模型**。
4. **模型管理** → 创建公共模型（客户端请求的 `model`）→ **路由** → 绑定一个或多个上游模型，设置优先级/权重。
5. **Key 管理** → 签发 Key → 选择可用模型、IP、RPM/并发/配额、敏感策略 → 保存完整 Key（只展示一次）。

### 3.2 调用示例

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer sk-gw-xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-public-model",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }'
```

OpenAI SDK：

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8080/v1",
    api_key="sk-gw-xxxxxxxx",
)

resp = client.chat.completions.create(
    model="your-public-model",
    messages=[{"role": "user", "content": "你好"}],
)
print(resp.choices[0].message.content)
```

### 3.3 敏感拦截行为

- 输入命中 **阻断**：HTTP `400`，`code=content_policy_violation`，不调用上游。
- 输出命中 **阻断**：
  - 非流式：HTTP `200`，`finish_reason=content_filter`，内容替换为安全提示。
  - 流式：立即停止上游，发送安全提示与 `finish_reason=content_filter`，以 `[DONE]` 收尾。
- **脱敏**：非流式替换命中片段；流式使用滑动窗口缓冲后替换。
- **仅记录**：放行，但日志 `intercepted=true`。
- 日志不保存命中原文；开启正文记录时，发生拦截的请求/响应会以脱敏占位保存。

---

## 4. 本地开发

### 4.1 启动依赖

```bash
docker compose up -d mysql redis
```

### 4.2 安装与迁移

```bash
pnpm install
pnpm --filter @ai-gateway/api prisma:generate
pnpm --filter @ai-gateway/api prisma:migrate:deploy
```

### 4.3 启动

```bash
# 终端 1，API（http://localhost:3000）
pnpm dev:api

# 终端 2，前端（http://localhost:5173）
pnpm dev:web
```

本地 `.env` 中 MySQL 端口是 `3307`（映射到容器 3306）。

### 4.4 测试

```bash
# 后端单元测试
pnpm test

# 后端构建
pnpm --filter @ai-gateway/api build

# 前端类型检查 + 构建
pnpm --filter @ai-gateway/web build

# 核心链路验收
$env:BASE_URL='http://localhost:8080'
$env:MOCK_ORIGIN='http://mock-upstream:4010'
pnpm smoke

# API 功能回归（153 项断言）
pnpm test:api

# 页面回归（真实浏览器操作）
pnpm test:ui

# 一键全量回归：镜像检查 + 单元 + API + 页面
pnpm test:regression
```

UI 测试需要本机 Chrome，默认路径 `C:\Program Files\Google\Chrome\Application\chrome.exe`，可用 `CHROME_PATH` 覆盖。

测试维护与新增功能的回归要求见 [Agent.md](./Agent.md)，功能覆盖矩阵见 [docs/测试矩阵.md](./docs/测试矩阵.md)。

---

## 5. 目录结构

```
apps/
  api/                       NestJS API
    prisma/schema.prisma     MySQL 数据模型
    prisma/migrations/       迁移
    src/common/              守卫、过滤器、加密、Redis、IP/脱敏工具
    src/modules/
      auth/                  登录、JWT、刷新令牌
      users/                 管理员/只读账号
      providers/             上游与上游模型
      models/                公共模型与路由
      keys/                  Key 签发、权限、配额
      sensitive/             规则、策略、匹配器
      gateway/               /v1 调用链、协议适配、限流、在线调试
      logs/                  调用日志、导出、保留策略
      stats/                 仪表盘聚合
      settings/              系统设置
      audit/                 审计日志
      seed/                  启动种子（账号、内置规则）
  web/                       Vue 3 管理端
    src/views/               页面
    src/api/                 Axios 封装
    src/stores/              Pinia
    src/utils/sse.ts         SSE 流解析
scripts/
  smoke-test.mjs             端到端 API 验收
  ui-smoke.mjs               Playwright UI 验收
docker/
  api.Dockerfile
  web.Dockerfile
  web-server.mjs             生产 Web 静态服务 + /api、/v1 反向代理
  mock-upstream/             本地 Mock 上游（OpenAI/Anthropic/Gemini）
docker-compose.yml
```

---

## 6. 关键实现说明

### 6.1 调用链

```
request_id
→ Key 认证（SHA-256）
→ 状态/过期
→ IP 白名单
→ 模型存在 + Key 模型白名单
→ Redis RPM/TPM/并发/每日
→ DB 配额
→ 输入敏感检测
→ 路由选择（优先级 + 权重 + 故障转移）
→ 协议适配
→ 输出敏感检测（流式滑动窗口）
→ usage/成本
→ 调用日志
```

### 6.2 Key 安全

- Key 格式：`sk-gw-` + 32 字节随机 base64url。
- 数据库只存 `SHA-256` 哈希、前缀、末 4 位。
- 上游 API Key 使用 AES-256-GCM 加密，接口只返回掩码。
- 管理端 Access Token 15 分钟；Refresh Token 7 天、HttpOnly Cookie、旋转刷新。

### 6.3 路由与故障转移

- 同一公共模型可绑定多个上游模型。
- 按 `priority` 升序；同优先级按 `weight` 加权随机。
- 连接失败、408/429/5xx 等自动切换下一个；流式请求一旦输出首字节不再重试。
- 单次请求最多尝试 3 个候选。

### 6.4 敏感检测

- 关键词：大小写/全半角/零宽字符归一化。
- 内置：身份证（校验位）、手机号、邮箱、银行卡（Luhn）、JWT、OpenAI/Anthropic/AWS/GitHub Key、私钥头。
- 自定义正则使用 `safe-regex2` 校验，避免明显 ReDoS。
- 流式输出保留滑动窗口（至少 64 字符），跨 chunk 命中可拦截。
- 规则动作优先级：`BLOCK > MASK > LOG`。

### 6.5 日志隐私

- 默认只存元数据，不存对话正文。
- Key 可单独开启 `logBody`；正文单独表、默认 7 天保留。
- 发生敏感拦截时，正文以脱敏占位保存，不落命中原文。
- 请求头、密码、Token 等字段在审计与正文中脱敏。

---

## 7. 生产部署建议

1. 修改 `.env` 中所有默认密码、`JWT_SECRET`、`ENCRYPTION_KEY`。
2. 不要使用 `--profile test`；按需删除 Mock 上游和演示数据。
3. 在反向代理（Nginx/Caddy/云负载均衡）上启用 HTTPS；将 `COOKIE_SECURE=true`。
4. `CORS_ORIGIN` 改成实际管理端域名，不要保留通配。
5. `ALLOW_PRIVATE_UPSTREAMS=false`（除非确实需要接内网 Ollama/网关）。
6. 托管 MySQL/Redis，或至少配置备份与持久化卷。
7. 配置日志保留期、数据库备份、监控告警。
8. API 无状态，可水平扩展；限流状态集中在 Redis。

---

## 8. 已知边界

- 首版不包含充值、支付、账单、发票。
- 首版不包含多租户隔离和细粒度 RBAC；仅 `ADMIN` / `VIEWER`。
- 不包含 RAG、知识库、Prompt 管理、模型微调。
- Anthropic 无模型列表接口，需要手工添加上游模型。
- 流式 `MASK` 会引入滑动窗口延迟；对延迟极敏感的场景建议输出规则使用 `BLOCK` 或 `LOG`。
- 图片输入支持 data URL/URL 透传，未接入对象存储。
