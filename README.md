# FeatureUnit 框架 · 登录系统演示

> **让 AI 放心写代码的框架**：AI 一次只实现一个小功能（功能单元），
> 很多小功能组合成一个服务组（Service Group）。
> **人要为 AI 的产品负责**——所以本仓库的每一行都写明了"谁能改、为什么、判据是什么"。

## 📚 文档导航

| 文档 | 内容 |
|---|---|
| [`docs/FEATUREUNIT-GUIDE.md`](docs/FEATUREUNIT-GUIDE.md) | **框架完整指南**：理念、概念分层、五个机制、契约体系、错误协议、配置安全、适用边界、语言选型、AI 工作流、管理台 |
| [`docs/TUTORIAL.md`](docs/TUTORIAL.md) | **上手教程**：从"拆需求"到"功能上线"的 10 步实操（真实案例 change-email） |
| [`docs/USAGE.md`](docs/USAGE.md) | **使用手册**：三个入口、日常流程、命令速查、配置管理、FAQ |
| [`docs/contract-template.md`](docs/contract-template.md) | 契约六要素模板（写契约的输入） |
| [`docs/contract-review-checklist.md`](docs/contract-review-checklist.md) | 契约评审清单（10 条，冻结前必过） |
| [`docs/agent-prompts/`](docs/agent-prompts/) | 三条固定 AI prompt：契约设计师 / 独立评审员 / 单元实现者（ticket） |

## 一、30 秒看懂

```
契约（人冻结）→ 判据（预先写好）→ AI 只写 impl.ts → 测试全绿 = 完成
```

| 概念 | 是什么 | 解决什么问题 |
|---|---|---|
| 功能单元 Feature Unit | AI 一次交付的最小单位：`contract / spec / impl / impl.test` 4 个文件 | AI 上下文极小、判据客观 |
| 端口 Port | 单元与外部世界的唯一切口（纯接口，无实现） | AI 不需要懂 DB/HTTP/日志 |
| 适配器 Adapter | 端口的具体实现（内存/文件/scrypt/HTTP） | 换基础设施 = 换一行代码 |
| 组合根 Composition Root | 唯一"知道一切"的文件（`index.ts`，人维护） | 组合逻辑只有一处 |
| 服务组 Service Group | 一个可部署进程（本演示 = 登录系统） | 部署单元，非微服务 |

**核心判据**：`单元测试全绿 + 类型检查通过 = 完成`。机器判定，AI 无需"感觉写得对不对"。

## 二、目录结构

```
featureunit-demo/
├── docs/                            # 指南/教程/使用手册/模板/评审清单/prompts
│   ├── FEATUREUNIT-GUIDE.md         # 框架完整指南
│   ├── TUTORIAL.md                  # 上手教程（change-email 案例）
│   ├── USAGE.md                     # 使用手册（入口/流程/命令/FAQ）
│   ├── contract-template.md         # 契约六要素模板
│   ├── contract-review-checklist.md # 契约评审清单（10 条）
│   └── agent-prompts/               # Agent-A/B/C 三条固定 prompt
├── public/                          # 管理台前端（admin.html + admin.js）
├── scripts/
│   ├── feat.mjs                     # 脚手架 CLI（new/ai-contract/test/check/ticket）
│   ├── ai-contract.mjs              # CLI 入口（薄壳）
│   └── ai-contract-lib.mjs          # ★ 核心库：CLI 与管理台共用（含 .d.mts 类型声明）
└── src/groups/auth-service/         # ★ 服务组：登录系统
    ├── manifest.json                # 服务组清单（版本、规则）
    ├── config.ts                    # 配置（本地文件→环境变量→默认值，fail fast）
    ├── index.ts                     # ★ 组合根（人维护，AI 禁止触碰）
    ├── group.test.ts                # 组判据：端到端（走 HTTP 层）
    ├── dev-server.ts                # 本地开发服务器 (:3000)
    ├── admin-server.ts              # 管理台服务 (:3001/admin)
    ├── ports/                       # 8 个冻结端口（纯接口）
    │   ├── errors.ts                # 错误协议（AppError + 错误码）
    │   ├── logger.ts                # 日志端口
    │   ├── user-store.ts            # 用户存储
    │   ├── session-store.ts         # 会话存储
    │   ├── password-hasher.ts       # 密码哈希
    │   ├── email-sender.ts          # 邮件发送
    │   ├── reset-token-store.ts     # 重置 token 存储
    │   └── rate-limiter.ts          # 限流
    ├── adapters/                    # 端口实现（可替换）
    │   ├── memory/                  # 5 个内存适配器（测试判据的基石）
    │   ├── scrypt-password-hasher.ts  # 真实 scrypt 哈希（零依赖）
    │   ├── file-user-store.ts       # JSON 文件持久化（演示替换）
    │   └── http.ts                  # 薄 HTTP 层（错误码→状态码映射在这）
    └── features/                    # 9 个功能单元（每个 = 1 个 AI ticket）
        ├── register-user/           #   contract.ts / spec.md / impl.ts / impl.test.ts
        ├── login/
        ├── logout/
        ├── current-user/
        ├── change-password/
        ├── change-email/
        ├── request-password-reset/
        ├── reset-password/
        └── delete-account/          # 已冻结契约（走完评审流程的样例）
```

## 三、快速开始

```bash
npm install
npm run check    # 类型检查 + 全部测试（应全绿：43 个用例）
npm run dev      # 启动业务服务：http://localhost:3000
npm run admin    # 启动管理台：http://localhost:3001/admin
```

**管理台**（`npm run admin`）把框架的日常动作收进一个页面（7 个 tab，支持多服务组切换）：
**概览**（单元冻结状态 + 总闸 + 端口依赖矩阵）· **单元详情**（4 文件查看/在线编辑/git 留痕/接线检查+一键接线/AI 生成判据/AI 实现/提交历史回滚/错误码检查）·
**AI 契约生成**（草稿 → 机器初审 → 10 项人评审 → 冻结）· **Ticket** · **源码浏览** ·
**试玩**（注册/登录/查我/登出/改密/改邮箱，cookie 自动流转）· **配置**（密钥打码 + 业务参数，存本地文件不进 git）。

冒烟测试（另开终端）：

```bash
curl -s -X POST localhost:3000/api/register -H 'content-type: application/json' \
  -d '{"email":"a@b.com","password":"secret123"}'
curl -s -c /tmp/cj -X POST localhost:3000/api/login -H 'content-type: application/json' \
  -d '{"email":"a@b.com","password":"secret123"}'
curl -s -b /tmp/cj localhost:3000/api/me
```

## 四、7 个功能单元一览

| 单元 | 输入 | 输出 | 端口依赖 | 关键不变量 |
|---|---|---|---|---|
| register-user | email, password | id | UserStore, PasswordHasher | 重复邮箱报错；明文不落库 |
| login | email, password | token+user | + SessionStore, now, TTL | 防枚举（同一错误码） |
| logout | token | void | SessionStore | 幂等，永远成功 |
| current-user | token | user | + UserStore, now | 三种失效原因同一错误码；过期会话顺手删 |
| change-password | token, 旧密码, 新密码 | void | + PasswordHasher | 旧密码错不改数据；成功后全端下线 |
| request-password-reset | email | void | + EmailSender, ResetTokenStore, RateLimiter | 防枚举（假装成功）；旧 token 作废；限流 |
| reset-password | token, 新密码 | void | + SessionStore | token 一次性（防重放）；成功后全端下线 |

每个单元的 `impl.test.ts` 就是它全部不变量的机器断言——**判据先于实现存在**。

## 五、AI 工作流（人负责，AI 干活）

```
阶段 0  人/Agent-A 写契约 → Agent-B 独立评审 → 人拍板冻结（git + CI 锁 hash）
阶段 1  写判据 impl.test.ts（人，或独立 AI；禁止实现者写自己的判据）
阶段 2  7 个 ticket 并行发给 AI（互不依赖）：AI 只写 impl.ts，跑到判据全绿
阶段 3  人写/审组合根与适配器，组测试全绿 = 可上线
阶段 4  出问题 → 回滚单个单元（manifest 记录版本），其余 6 个不动
```

生成 ticket：

```bash
npm run feat -- ticket login        # 打印 login 的完整 AI 任务单
npm run feat -- new verify-2fa      # 生成新功能单元模板（如加两步验证）
npm run feat -- test login          # 只跑 login 的判据（AI 迭代用）
npm run feat -- check               # 提交前总闸
```

## 五·五、AI 帮你生成契约（人确认后才冻结）

`feat ai-contract`（CLI）或管理台「AI 契约生成」面板（界面）把 Agent-A 变成一条命令：
**AI 生成草稿 → 机器初审 → 人逐条确认 → 冻结**。两者共用同一套核心逻辑（`ai-contract-lib.mjs`）。

```bash
# 1. 先生成单元
npm run feat -- new delete-account

# 2. AI 生成契约草稿（真实模式：需要 API Key）
export AI_API_KEY=sk-...            # 或 DEEPSEEK_API_KEY；任意 OpenAI 兼容 API 均可
npm run feat -- ai-contract delete-account "登录用户可以删除自己的账号（需验证密码）"

# 演示模式（不调 API，内置模拟 AI 生成一份带典型缺陷的草稿，用来练评审）
npm run feat -- ai-contract delete-account "登录用户可以删除自己的账号" --mock --yes
```

流程要点：

1. **AI 只生成草稿**：prompt 就是 `docs/agent-prompts/01-contract-drafter.md` + 六要素模板；
2. **机器初审**：结构检查（schema/不变量/错误码章节）+ 端口引用存在性 + tsc 全项目类型检查；
3. **人逐条确认**：10 项评审清单逐条 y/n，**任一 n = 打回**，草稿不会进入 AI 实现队列；
4. **冻结**：全过 → 契约文件头部写入冻结记录（生成方式/评审人/评审结果）+ git 提交；
5. 之后照旧：写判据 → 发 ticket → AI 只写 impl.ts。

配置（也可在管理台「配置」tab 填写，保存到 `.featureunit.local.json`，不进 git）：
`AI_API_KEY`（必填）、`AI_BASE_URL`（默认 https://api.deepseek.com）、`AI_MODEL`（默认 deepseek-v4-flash——V4 系列，`deepseek-chat` 已停用）。
优先级：**本地配置 → 环境变量 → 默认值**。

## 六、人为什么能负责（机制清单）

1. **判据客观**：`impl.test.ts` 全绿 + `tsc` 通过 = 完成。机器判定，无需主观；
2. **判据冻结**：契约/判据文件 hash 进 CI，AI 改了判据 = CI 红（机器化反作弊）；
3. **权限最小**：ticket 只放行 `impl.ts` 一个文件（`manifest.json` 的
   `aiWritablePaths` 机器可校验）；
4. **失败隔离**：单元独立测试、独立版本，回滚粒度 = 一个单元；
5. **安全前置**：防枚举、防重放、限流、全端下线等安全不变量写死在契约里，
   AI 实现时"想漏" = 判据红，不是上线后炸；
6. **角色分离**：生成者 ≠ 判据者 ≠ 实现者（test oracle 独立性）。

## 七、常见问题

**Q：换数据库/Redis/SMTP 要动多少代码？**
A：只改 `index.ts` 的 `buildDeps()` 里对应一行（如 `users:` 换成 Postgres 适配器）。
7 个功能单元零改动，组测试全绿即可上线。

**Q：怎么加新功能（如两步验证）？**
A：管理台"＋ 新功能单元"或 `feat new verify-2fa` → 填契约（或 AI 生成+评审）→ 冻结 →
写判据 → 发 ticket。旧单元一个都不动，回归 = 跑一遍 `npm run check`。

**Q：密钥/配置写在哪？**
A：管理台「配置」tab 保存到 `.featureunit.local.json`（git 已忽略），
优先级：本地配置 → 环境变量 → 默认值。密钥在界面上默认打码。

**Q：契约要改怎么办？**
A：走正式演进流程：新开 `contract.v2` → 写迁移测试 → 所有调用方一起升级（人评审）→
删旧版。契约改动【不进】AI ticket 队列。

**Q：这个框架适合什么？**
A：适合"完成可被机器判定"的业务服务（CRUD、认证、支付、订单）。探索性原型、
强耦合横切改造不适合——那是人自由探索的领域。

**Q：为什么选 TypeScript？**
A：AI 生成质量最高（训练数据量）+ 类型约束最强（编译器是第一道判据）+
schema→类型单一来源（zod）+ 判据毫秒级（vitest）。
