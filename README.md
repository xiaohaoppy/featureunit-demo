# FeatureUnit 框架 · 让 AI 放心写代码

> **人只说一句话，系统自动规划服务组 / 端口 / 单元，逐步生成，人在每一步确认。**
> 核心原则：**AI 生成 → 机器判据 → 人确认**，每个产物冻结进 git，人人可追溯。

## 📚 文档导航

| 文档 | 内容 |
|---|---|
| [`docs/USAGE.md`](docs/USAGE.md) | **使用手册**：三个入口、6 个 tab、日常流程、命令、配置 |
| [`docs/TUTORIAL.md`](docs/TUTORIAL.md) | **上手教程**：从一句话需求到功能上线（含完整案例） |
| [`docs/FEATUREUNIT-GUIDE.md`](docs/FEATUREUNIT-GUIDE.md) | **框架指南**：理念、机制、六 Agent、契约体系、边界 |
| [`docs/contract-template.md`](docs/contract-template.md) | 契约六要素模板 |
| [`docs/contract-review-checklist.md`](docs/contract-review-checklist.md) | 契约评审清单（10 条） |
| [`docs/agent-prompts/`](docs/agent-prompts/) | 六条 Agent prompt（A 契约 / B 评审判据 / C 实现 / D 端口 / E 打包） |

## 一、30 秒看懂

```
人：一句话需求
  ↓
系统：自动规划（服务组/端口/单元）→ 逐步 AI 生成
  ↓ 每步
机器判据（初审 / 红灯考卷 / tsc 预演）→ 人确认 → 冻结（git 留痕）
```

| 概念 | 是什么 | 解决什么问题 |
|---|---|---|
| 功能单元 | AI 一次交付的最小单位（contract/spec/impl/test） | 上下文小、判据客观 |
| 端口 | 单元与外部世界的唯一切口（纯接口） | AI 不碰 DB/HTTP |
| 服务组 | 一个可部署进程（一个库一个组） | 部署单元 |
| 组合根 | 唯一"知道一切"的文件（人确认落盘） | 组合逻辑一处 |
| 六 Agent | A 契约 / B 评审判据 / C 实现 / D 端口 / E 打包 / 需求解析 | 全链路 AI 生成 |

## 二、快速开始

```bash
npm install
npm run check     # 总闸：类型检查 + 50 个测试（应全绿）
npm run admin     # 管理台：http://localhost:3001/admin（推荐入口）
npm run dev       # 业务服务：http://localhost:3000
npm run migrate   # SQLite 模式建表（USER_STORE=sqlite 时需要）
```

**管理台 6 个 tab**：🏠 开始（一句话需求 → 流水线）/ 📦 单元（开发工作台，4 阶段 + 进度条）/ 🔌 端口 / 🧪 试玩 / 📄 源码 / ⚙️ 配置。

## 三、AI 配置（唯一需要做的设置）

| 配置 | 默认 | 说明 |
|---|---|---|
| `AI_API_KEY` | — | 必填（管理台「配置」tab 填写，密钥打码保存，不进 git） |
| `AI_MODEL` | `deepseek-v4-flash` | **保存时自动从 API 获取模型列表**（60s 缓存，无 Key 兜底） |
| `AI_REASONING` | `medium` | 推理等级：low/medium/high（high 时 temperature 0.1 + reasoning_effort） |
| `AI_BASE_URL` | `https://api.deepseek.com` | 任意 OpenAI 兼容端点 |

> 注意：`deepseek-chat`/`deepseek-reasoner` 已于 2026-07-24 停用，迁移只需把 AI_MODEL 改为 `deepseek-v4-flash` / `deepseek-v4-pro`。

## 四、核心流程（完整故事线）

```
流水线（超级向导）：一句话需求 → 7 步逐步生成，每步人确认
  ① 需求规划  ② 端口(Agent-D)  ③ 契约(Agent-A)  ④ 判据(Agent-B)
  ⑤ 实现(Agent-C)  ⑥ 打包(Agent-E)  ⑦ 完成

各环节机器判据：
  端口：7 项纪律初审（纯接口/零 import/JSDoc/Promise…）
  契约：结构/端口引用/tsc 初审 + 10 项人评审
  判据：红灯 = 考卷就绪（占位判据禁止冻结）
  实现：判据全绿才提交（红则迭代 ≤5 轮，超限停手求援）
  打包：tsc 预演（写入→编译→自动还原），编译不过禁止确认

冻结守卫：已冻结的契约/判据/端口禁止被 AI 覆盖（修改走契约演进）
```

## 五、命令速查

```bash
npm run check                          # 总闸
npm run admin / dev / migrate          # 管理台 / 业务 / 建表
npm run feat -- new-group <组名>        # 新服务组
npm run feat -- new <名字> [--group <组>]   # 新功能单元
npm run feat -- ai-contract <名字> "<需求>" [--mock] [--yes]  # AI 契约 + 人确认
npm run feat -- test <名字>             # 只跑该单元判据
npm run feat -- ticket <名字>           # 打印 AI 任务单
```

## 六、常见问题

| 问题 | 答案 |
|---|---|
| 没有 API Key 能体验吗？ | 能——mock 模式走完全相同流程（模拟 AI 产出含刻意缺陷，供练评审） |
| 换数据库？ | 配置面板「存储模式」下拉：memory / file(JSON) / sqlite(真库)，一行切换 |
| 契约要改？ | 走契约演进（v2 + 迁移测试 + 人评审），AI 不碰冻结区 |
| 出 bug 回滚？ | 单元详情「历史/回滚」= git revert，粒度到单单元 |
| 新服务组？ | `feat new-group` 或面板 ＋，自动生成骨架（通用端口复制） |
| 为什么每个产物都进 git？ | 人要为 AI 的产品负责——每个动作可追溯（也让"界面操作"可审计） |
