# FeatureUnit 上手教程

> 手把手走完"给系统加一个功能"的完整流程。本教程使用仓库里的真实案例：
> 给登录系统（auth-service）新增 **change-email（修改邮箱）** 功能。
> 每一步都有真实命令、预期输出和"为什么这么做"。
>
> 前置：读完 `FEATUREUNIT-GUIDE.md`；环境：Node ≥ 20。

---

## 目录

- [第 0 步：认识仓库与总闸](#第-0-步认识仓库与总闸)
- [第 1 步：拆解需求，定单元边界](#第-1-步拆解需求定单元边界)
- [第 2 步：生成单元模板](#第-2-步生成单元模板)
- [第 3 步：写契约（含 AI 生成用法）](#第-3-步写契约)
- [第 4 步：端口演进（需要时）](#第-4-步端口演进)
- [第 5 步：判据先行，看到红灯](#第-5-步判据先行)
- [第 6 步：实现，看到绿灯](#第-6-步实现)
- [第 7 步：组合根与 HTTP 接线](#第-7-步组合根与-http-接线)
- [第 8 步：组测试与总闸](#第-8-步组测试与总闸)
- [第 9 步：真实服务冒烟](#第-9-步真实服务冒烟)
- [第 10 步：日常 AI ticket 流程](#第-10-步日常-ai-ticket-流程)
- [实战教训](#实战教训)

---

## 第 0 步：认识仓库与总闸

```bash
cd featureunit-demo
npm install
npm run check        # 总闸 = tsc --noEmit + vitest run，应全绿（43 个测试）
```

目录地图（只记 4 个关键位置）：

```
src/groups/auth-service/
  ports/        ← 冻结：外部世界的接口（8 个）
  adapters/     ← 冻结：端口实现（内存/scrypt/文件/HTTP）
  features/     ← 每个子目录 = 1 个功能单元 = 1 张 AI ticket
  index.ts      ← 冻结：组合根（人维护，唯一"知道一切"的文件）
  config.ts     ← 冻结：唯一读环境变量的地方
  group.test.ts ← 组判据（端到端）
```

配套命令（`npm run feat -- <命令>`）：

| 命令 | 作用 |
|---|---|
| `new <名字>` | 生成功能单元 4 文件模板 |
| `ai-contract <名字> "<需求>"` | AI 生成契约 → 机器初审 → 人确认 → 冻结 |
| `test <名字>` | 只跑该单元的判据（AI 迭代用） |
| `ticket <名字>` | 打印该单元的 AI 任务单 |
| `check` | 总闸 |

---

## 第 1 步：拆解需求，定单元边界

需求："登录用户可以修改自己的邮箱。"

**拆解方法**：问三个问题——

1. **一句话说得清吗？** 说得清 = 一个单元；说不清 = 继续拆；
2. **"完成"能被机器判定吗？** 能写测试断言 = 可以；不能 = 先别让 AI 写；
3. **边界在哪？** 显式写出【不】负责什么（防 AI 越界）。

本例拆解结果：**change-email 单元**。职责 = 验证身份（旧密码）→ 检查新邮箱占用 →
更新 → 全端下线。邮件通知、登录、密码修改都属于别的单元。

---

## 第 2 步：生成单元模板

```bash
npm run feat -- new change-email
```

生成 4 个文件（模板带 TODO 占位）：

```
features/change-email/
  contract.ts    # 契约（冻结区）——TODO 待填
  spec.md        # 规格（冻结区）——TODO 待填
  impl.ts        # 实现（AI 写入区）——桩：throw NOT_IMPLEMENTED
  impl.test.ts   # 判据（冻结区）——占位测试 expect(true)
```

⚠️ **注意占位判据 `expect(true)` 现在能通过——这是"假绿"**。判据没写之前，
这个单元处于"没有考卷"状态，绝不允许发给 AI 实现。

---

## 第 3 步：写契约

两种方式，二选一：

### 方式 A：让 AI 生成（推荐，人确认）

```bash
# 真实模式（需要 API Key）
export AI_API_KEY=sk-...
npm run feat -- ai-contract change-email "登录用户可以修改自己的邮箱（敏感操作，需验证密码）"

# 演示模式（不调 API，内置模拟 AI）
npm run feat -- ai-contract change-email "登录用户可以修改自己的邮箱" --mock
```

脚本流程：AI 生成草稿 → 机器初审（结构/端口引用/tsc）→ **你逐条过 10 项评审
清单（y/n）** → 全部 y = 冻结（写冻结记录 + git 提交）；任一 n = 打回。

> **真实案例**：AI 第一版草稿只有"token 有效即可修改"，评审清单当场揪出 4 个洞——
> ① 没查新邮箱占用（账号劫持风险）② 没验证旧密码（会话持有者≠账号持有者）
> ③ 没写改后全端下线 ④ 没声明日志 PII 纪律。**AI 负责翻译需求，人负责钉风险。**

### 方式 B：人直接写（对照模板）

按 `docs/contract-template.md` 六要素填 `contract.ts` + `spec.md`。
最终契约长这样（节选）：

```ts
export const ChangeEmailInput = z.object({
  token: z.string().min(1),
  currentPassword: z.string().min(1),          // 敏感操作必须重新验证身份
  newEmail: z.string().email(),
});

export interface ChangeEmailDeps {
  sessions: SessionStore;
  users: UserStore;
  hasher: PasswordHasher;
  logger: Logger;
  now: () => Date;                              // 时钟注入：测试可固定时间
}

/**
 * 不变量（impl.test.ts 逐条断言；缺一条 = 判据不过）：
 * 1. 会话无效/已过期 → INVALID_SESSION；过期会话顺手删除；
 * 2. 旧密码错误 → WRONG_PASSWORD，且不修改任何数据；
 * 3. 新邮箱已被其他用户占用 → EMAIL_TAKEN；等于自己旧邮箱 → 幂等成功；
 * 4. 成功后该用户所有会话一律失效（强制重新登录）；
 * 5. 邮箱（PII）不得进入日志。
 */
```

**契约写完必须能回答"每个失败路径是什么错误码"**——写不出来的地方就是需求没想清楚。

---

## 第 4 步：端口演进

写契约时发现 `UserStore` 没有 `updateEmail` 方法——**端口需要演进，这是"人"的工作**：

1. `ports/user-store.ts` 加方法（含注释说明语义：幂等、唯一性由单元负责）；
2. **所有适配器同步实现**：`adapters/memory/memory-user-store.ts` 和
   `adapters/file-user-store.ts`（内存版要双索引同步：先删旧 email 键再写新键）；
3. `npx tsc --noEmit` 验证全绿。

> 端口演进为什么必须人做：端口一变，**所有**依赖它的单元和适配器都要跟着变，
> 这天然属于"跨单元一致性"工作，是 AI ticket 之外的事。

---

## 第 5 步：判据先行

把契约的 5 条不变量逐条翻译成测试（`impl.test.ts`），全部用内存适配器：

```ts
it("不变量4｜成功改邮箱：邮箱已更新 + 所有会话（含当前）全部失效", ...);
it("不变量2｜旧密码错误 → WRONG_PASSWORD，数据零变更", ...);
it("不变量3｜新邮箱被他人占用 → EMAIL_TAKEN，数据零变更", ...);
it("不变量3｜新邮箱 = 自己的旧邮箱 → 幂等成功", ...);
it("不变量1｜无效/过期 token → INVALID_SESSION", ...);
it("不变量5｜日志不含邮箱（PII 纪律）", ...);
```

跑判据，**必须看到红灯**：

```bash
npm run feat -- test change-email
# ❯ change-email/impl.test.ts (7 tests | 7 failed)
#   × ... → NOT_IMPLEMENTED: 按 contract.ts 的不变量实现本单元
```

红灯 = 考卷已就绪。现在任何人都知道"完成"长什么样。

---

## 第 6 步：实现

这是 **AI ticket 里唯一允许写的文件**（`impl.ts`）。实现逐条对应不变量，
注释里标注对应关系（`[不变量 N]`）——评审时逐条对照即可：

```ts
export const changeEmail: ChangeEmail = async (
  { token, currentPassword, newEmail },
  { sessions, users, hasher, logger, now },
) => {
  // [不变量 1] 会话必须有效
  const session = await sessions.findByToken(token);
  if (!session) throw new AppError(ErrorCodes.INVALID_SESSION, 401);
  if (session.expiresAt.getTime() <= now().getTime()) {
    await sessions.delete(token);
    throw new AppError(ErrorCodes.INVALID_SESSION, 401);
  }
  const user = await users.findById(session.userId);
  if (!user) throw new AppError(ErrorCodes.INVALID_SESSION, 401);

  // [不变量 2] 重新验证身份：旧密码不对 → 失败，不留下任何数据变更
  const valid = await hasher.verify(currentPassword, user.passwordHash);
  if (!valid) throw new AppError(ErrorCodes.WRONG_PASSWORD, 401);

  // [不变量 3] 占用检查；新邮箱 == 旧邮箱 → 幂等成功（什么都不做，含不清会话）
  if (newEmail === user.email) {
    logger.info("change-email.noop", { userId: user.id });
    return;
  }
  const taken = await users.findByEmail(newEmail);
  if (taken) throw new AppError(ErrorCodes.EMAIL_TAKEN, 409);
  await users.updateEmail(user.id, newEmail);

  // [不变量 4] 邮箱已变 → 全端下线
  await sessions.deleteAllForUser(user.id);

  // [不变量 5] 日志只记 userId
  logger.info("change-email.ok", { userId: user.id });
};
```

跑判据，看到绿灯：

```bash
npm run feat -- test change-email
# ✓ change-email/impl.test.ts (7 tests)
```

> **真实教训：第一次实现被判据抓出 2 个问题**——
> ① `newEmail == 旧邮箱` 时我跳过了更新，却仍然执行了全端下线，而契约写的是
> "幂等成功，**不做任何修改**"（删会话也是修改）；② PII 断言范围没对准本单元的日志。
> 两个都是判据先于实现的价值：**AI 想漏 = 红灯，不是上线后炸。**

---

## 第 7 步：组合根与 HTTP 接线

单元完成 ≠ 服务可用。接线是"人维护区"，全部是声明式，无业务逻辑：

**① 组合根 `index.ts`**（4 处小改）：

```ts
import { changeEmail } from "./features/change-email/impl";      // 导入
import type { ChangeEmailDeps } from "./features/change-email/contract";
import { ChangeEmailInput } from "./features/change-email/contract";

export interface AuthApi {
  ...
  changeEmail(input: unknown): Promise<void>;                    // 接口加一行
}

// createAuthApp 里加一行：
changeEmail: (input) => changeEmail(parseOrThrow(ChangeEmailInput, input), toChangeEmailDeps(deps)),

// 依赖子集装配加一个函数：
function toChangeEmailDeps(d: AuthDeps): ChangeEmailDeps {
  return { sessions: d.sessions, users: d.users, hasher: d.hasher, logger: d.logger, now: d.now };
}
```

**② HTTP 层 `adapters/http.ts`**（一条路由）：

```ts
app.post("/api/change-email", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) throw new AppError(ErrorCodes.INVALID_SESSION, 401);
  const body = (await readJson(c)) as Record<string, unknown>;
  await api.changeEmail({ token, ...body });
  deleteCookie(c, SESSION_COOKIE); // 邮箱已变，当前 cookie 一并失效
  return c.json({ ok: true });
});
```

**③ `manifest.json`**：`"change-email": "1.0.0"` 登记版本。

---

## 第 8 步：组测试与总闸

给 `group.test.ts` 加端到端用例（走 HTTP 层，覆盖跨单元协作）：

```ts
it("改邮箱端到端：改后旧 cookie 失效、旧邮箱登录被拒、新邮箱可登录；占用他人邮箱 → 409", ...);
```

跑总闸：

```bash
npm run check
# Test Files  10 passed (10)
#      Tests  43 passed (43)
```

---

## 第 9 步：真实服务冒烟

```bash
npm run dev        # http://localhost:3000
```

```bash
curl -s -c /tmp/cj -X POST localhost:3000/api/login -H 'content-type: application/json' \
  -d '{"email":"a@b.com","password":"secret123"}'

# 攻击场景应全部被拦：
curl -s -b /tmp/cj -X POST localhost:3000/api/change-email -H 'content-type: application/json' \
  -d '{"newEmail":"steal@b.com"}'                                        # → 400（缺旧密码）
curl -s -b /tmp/cj -X POST localhost:3000/api/change-email -H 'content-type: application/json' \
  -d '{"currentPassword":"secret123","newEmail":"b@b.com"}'              # → 409（占用）
curl -s -b /tmp/cj -X POST localhost:3000/api/change-email -H 'content-type: application/json' \
  -d '{"currentPassword":"hacked","newEmail":"new@b.com"}'               # → 401（密码错）
curl -s -b /tmp/cj -X POST localhost:3000/api/change-email -H 'content-type: application/json' \
  -d '{"currentPassword":"secret123","newEmail":"new@b.com"}'            # → 200
curl -s -b /tmp/cj localhost:3000/api/me                                  # → 401（已全端下线）
```

---

## 第 10 步：日常 AI ticket 流程

功能上线后，日常开发就是循环：

```bash
npm run feat -- new <新功能>                          # 开新单元
npm run feat -- ai-contract <新功能> "<需求>"          # AI 生成契约 → 你确认 → 冻结
# 写判据（impl.test.ts）→ 红灯确认
npm run feat -- ticket <新功能>                        # 打印任务单
# 把任务单发给 AI → AI 只写 impl.ts → 判据全绿
npm run feat -- check                                 # 总闸
```

并行技巧：单元之间零依赖（只共享冻结的端口），**多个 ticket 可以并行发给
多个 AI 实例**，互不阻塞。组合根始终由人接。

---

## 实战教训

1. **判据红着不许发 ticket**——占位 `expect(true)` 是假绿，考卷没写完不许开考；
2. **AI 草稿必有洞**——第一次评审永远要假设它漏了安全边界（防枚举、占用检查、
   身份验证），逐条过清单，不要"看着差不多"；
3. **判据会抓实现的语义错误**——"幂等成功 = 不做任何修改（含不清会话）"这种细节，
   正是人写契约、机器锁行为的意义；
4. **契约/判据/端口/组合根是冻结区**——任何修改走 git + 评审，AI 不许碰；
5. **EOF 默认打回**——`feat ai-contract` 在输入中断时按"不通过"处理，没有确认 = 不冻结；
6. **TS 注释里的 `*/` 陷阱**——块注释中出现 `**/impl.ts` 这类字样会提前截断注释
   （本项目真实踩过两次，编译器立刻报错）。写注释时用"各单元的 impl.ts"这类表述。
