# FeatureUnit 使用手册

> 怎么用这套框架干活：三个入口、日常流程、命令速查、常见问题。
> 理念见 `FEATUREUNIT-GUIDE.md`，手把手实操见 `TUTORIAL.md`。

---

## 一、三个入口

| 入口 | 命令 | 作用 | 谁用 |
|---|---|---|---|
| **管理台** | `npm run admin` | 网页界面管理一切（:3001/admin） | 人（日常主力） |
| **CLI** | `npm run feat -- <命令>` | 终端里的全部操作 | 人 / 脚本 |
| **业务服务** | `npm run dev` | 登录系统本体（:3000） | 联调 / 冒烟 |

三者共用同一套核心逻辑（`scripts/ai-contract-lib.mjs`），行为一致——
界面里冻结的契约和 CLI 冻结的契约，规则完全相同。

---

## 二、第一次使用（10 分钟）

```bash
cd featureunit-demo
npm install
npm run check        # 总闸：类型检查 + 43 个测试，应全绿
npm run admin        # 打开 http://localhost:3001/admin
```

浏览器里过一遍：

1. **概览**：左侧 9 个功能单元（🔒 已冻结 / 📄 草稿），右上"运行全部判据"看总闸；
2. **单元详情**：点 `login` → 看 4 个文件 → "运行本单元判据" → "🔌 接线检查"；
3. **试玩**：注册 → 登录 → 查我 → 登出，cookie 自动流转；
4. **配置**：填 AI_API_KEY（打码保存到本地文件，不进 git）；
5. **AI 契约生成**：填 `delete-account` + 一句话需求 → 生成草稿 → 机器初审 → 10 项逐条评审 → 冻结。

---

## 三、日常开发：加一个新功能（完整工作流）

```
┌─ 人 ────────────────┐   ┌─ 机器 ─────────┐   ┌─ 人 ────────────────┐
│ 1. 新建单元          │→│ 2. AI 生成契约   │→│ 3. 逐条评审 y/n      │
│ 4. 写判据（考卷）    │→│ 5. 测试红（确认） │→│ 6. 发 ticket 给 AI   │
│ 7. AI 只写 impl.ts  │→│ 8. 测试绿（验收） │→│ 9. 接线+总闸+上线    │
└─────────────────────┘   └────────────────┘   └─────────────────────┘
```

### 第 1 步：新建单元

- **管理台**：左侧"＋ 新功能单元"→ 输入名字 → 自动生成 4 文件模板；
- **CLI**：`npm run feat -- new my-feature`。

### 第 2 步：生成契约（AI 生成 + 人确认，推荐）

- **管理台**：「AI 契约生成」面板 → 填功能名 + 需求 + 模式（mock/真实）→ 生成草稿 →
  看机器初审清单 → 10 项逐条点"通过/打回" → 全部通过才可点"冻结"；
- **CLI**：`npm run feat -- ai-contract my-feature "一句话需求" [--mock]`，逐条 y/n。

> 也可以人工写：按 `docs/contract-template.md` 六要素填 contract.ts + spec.md。

### 第 3 步：冻结

- 冻结 = 契约头部写入冻结记录 + git 提交；
- **冻结权永远在人**：任一 n = 打回，契约不会进入 AI 实现队列；
- 打回后草稿保留在文件里，可人工修改后重新评审。

### 第 4~5 步：写判据，确认红灯

把契约不变量逐条翻译成 `impl.test.ts`（参考其他单元写法），
跑判据**必须看到失败**——红灯 = 考卷就绪。

```bash
npm run feat -- test my-feature      # 只跑该单元判据（毫秒级）
```

### 第 6 步：发 ticket 给 AI

- **管理台**：「Ticket」面板 → 选单元 → 生成 → 复制全文；
- **CLI**：`npm run feat -- ticket my-feature`。

整段文本发给任意 AI（可多单元并行）。AI 只被允许写 `impl.ts`。

### 第 7~8 步：AI 实现，验收绿灯

AI 跑到判据全绿 + `tsc` 通过 = 完成。**判据红不许改判据**——纪律红线。

### 第 9 步：接线与上线（人的活，但一键生成）

组合根 `index.ts` + `adapters/http.ts` + `manifest.json` 的改动由**一键接线**生成：
管理台「单元详情」点 **🔌 接线检查** → 列出 6 项缺口 + **自动生成 unified diff**
（组合根依赖子集、HTTP 路由、manifest 版本都推导出来）→ **人审阅 diff 点「确认接线」才落盘**。
补完 `npm run check` 总闸全绿 → 冒烟 → 上线。

---

## 四、管理台：每个按钮干什么（7 个 tab）

| tab | 操作 | 对应框架环节 |
|---|---|---|
| 概览 | 单元卡片（冻结/草稿状态）；运行全部判据 | 总览 / 验收 |
| 单元详情 | 4 文件查看；运行单单元判据；**编辑当前文件**（git 留痕）；🔌 接线检查 + **一键接线**（diff 预览 + 人确认落盘）；AI 生成判据 + AI 实现 | 评审 / 验收 / 人工修改 / 接线 |
| AI 契约生成 | 生成草稿 → 机器初审 → 10 项逐条"通过/打回" → 冻结 | Agent-A / 评审 / 冻结 |
| Ticket | 生成 / 复制任务单 | 发 AI |
| 源码浏览 | 只读查看端口/适配器/组合根/配置 | 学习 / 审计 |
| 试玩 | 注册/登录/查我/登出/改密/改邮箱/找回密码，cookie 自动流转 | 冒烟 |
| 配置 | 密钥（打码）与业务参数；保存到本地文件；来源标注 | 配置管理 |

**在线编辑的纪律**：保存时必填修改说明，git 自动留痕（"谁在什么时候改了什么"可追溯）；
编辑冻结区文件（契约/判据/规格）是允许的，但界面会明确警告。

---

## 五、配置管理

### 写入位置与优先级

```
优先级：本地配置文件 → 环境变量 → 代码默认值
本地配置文件：featureunit-demo/.featureunit.local.json（.gitignore 已忽略）
```

- 管理台「配置」tab 保存 → 写入 `.featureunit.local.json`；
- `config.ts`（业务配置）与 `ai-contract-lib.mjs`（AI 密钥）都按此优先级读取；
- 密钥默认打码显示（只露首尾 4 位），保存时留空 = 删除该项；
- CI/服务器可以用环境变量覆盖本地配置——"写死"和"临时覆盖"两不误。

### 接真实 AI（唯一需要的配置）

```bash
# 方式 A：管理台「配置」tab 填 AI_API_KEY（推荐）
# 方式 B：环境变量
export AI_API_KEY=sk-你的密钥
export AI_BASE_URL=https://api.deepseek.com   # 可选，默认就是这个
export AI_MODEL=deepseek-v4-flash              # 可选（V4 系列；deepseek-chat 已停用）
```

配好后 `feat ai-contract` 和管理台的"真实模式"直接调用模型；
不配置时用 `--mock` / 演示模式（内置模拟 AI，流程完全一致）。

---

## 六、命令速查表

```bash
npm run check                          # 总闸：tsc + 全部测试
npm run dev                            # 业务服务 :3000
npm run admin                          # 管理台 :3001/admin
npm run feat -- new-group <组名>        # 创建新服务组骨架（多组支持）
npm run feat -- new <名字> [--group <组名>]   # 开新功能单元（默认 auth-service）
npm run feat -- ai-contract <名字> "<需求>" [--mock] [--yes]
                                       # AI 生成契约 → 初审 → 人确认 → 冻结
npm run feat -- test <名字> [--group <组名>]  # 只跑该单元判据（AI 迭代用）
npm run feat -- ticket <名字> [--group <组名>]# 打印 AI 任务单
npm run feat -- check                  # 总闸（同 npm run check）
```

### 添加服务组（两种方式，效果一致）

```bash
# 方式 A：CLI
npm run feat -- new-group order-service

# 方式 B：管理台「服务组」下拉旁的 ＋ 按钮
```

生成骨架：`features/`（空）+ `ports/`（复制 errors/logger，全组错误协议一致）+
`config.ts`（fail fast）+ `index.ts`（组合根空骨架）+ `manifest.json` + `group.test.ts`。
之后在管理台左侧切换组，`feat new <名字> --group order-service` 建第一个单元。
注意：一键接线的锚点目前面向 auth-service——**新组第一个单元请人工接线**
（参照 auth-service/index.ts 模式），后续可扩展锚点。

---

## 七、常见问题速答

| 问题 | 答案 |
|---|---|
| 怎么换数据库/Redis/SMTP？ | 只改 `index.ts` 的 `buildDeps()` 对应一行，单元零改动 |
| 契约要改怎么办？ | 走契约演进：新开 v2 契约 + 迁移测试 + 人评审，不进 AI 队列 |
| 出 bug 了怎么回滚？ | 改 `manifest.json` 里该单元版本号回滚单个单元，其他不动 |
| 哪些文件 AI 永远不许碰？ | contract.ts / spec.md / impl.test.ts / ports/** / index.ts / config.ts |
| 哪些文件人可以改？ | 全部——但冻结区改动走 git 留痕（管理台编辑会强制填说明） |
| 多个功能能并行给 AI 吗？ | 能。单元间只共享冻结端口，互不依赖 |
| 判据红了能改判据吗？ | 不能——改了判据=作弊，git 历史会留下痕迹 |
| 密钥存在哪？安全吗？ | `.featureunit.local.json`（git 已忽略）；打码显示；CI 可用环境变量覆盖 |
| 管理台需要另起业务服务吗？ | 不需要。「试玩」面板内置业务实例（内存存储） |
