# FeatureUnit 框架 · 让 AI 放心写代码

> **人只说一句话，系统自动规划业务系统 / 数据接口 / 功能，逐步生成，人在每一步确认。**
> 核心原则：**AI 生成 → 机器验收测试 → 人确认**，每个产物定稿进 git，人人可追溯。

## 📚 文档导航

| 文档 | 内容 |
|---|---|
| [`docs/USAGE.md`](docs/USAGE.md) | **使用手册**：三个入口、6 个 tab、日常流程、命令、配置 |
| [`docs/TUTORIAL.md`](docs/TUTORIAL.md) | **上手教程**：从一句话需求到功能上线（含完整案例） |
| [`docs/FEATUREUNIT-GUIDE.md`](docs/FEATUREUNIT-GUIDE.md) | **框架指南**：理念、机制、六 AI 助手、功能规格体系、边界 |
| [`docs/contract-template.md`](docs/contract-template.md) | 功能规格六要素模板 |
| [`docs/contract-review-checklist.md`](docs/contract-review-checklist.md) | 功能规格评审清单（10 条） |
| [`docs/agent-prompts/`](docs/agent-prompts/) | 六条 AI 助手 prompt（A 功能规格 / B 评审验收测试 / C 实现 / D 数据接口 / E 接入） |

## 一、30 秒看懂

```
人：一句话需求
  ↓
系统：自动规划（业务系统/数据接口/功能）→ 逐步 AI 生成
  ↓ 每步
机器验收测试（自动检查 / 红灯考卷 / 编译预检）→ 人确认 → 定稿（git 留痕）
```

| 概念 | 是什么 | 解决什么问题 |
|---|---|---|
| 功能 | AI 一次交付的最小单位（contract/spec/impl/test） | 上下文小、验收测试客观 |
| 数据接口 | 功能与外部世界的唯一切口（纯接口） | AI 不碰 DB/HTTP |
| 业务系统 | 一个可部署进程（一个库一个组） | 部署功能 |
| 组合根 | 唯一"知道一切"的文件（人确认落盘） | 组合逻辑一处 |
| 六 AI 助手 | A 功能规格 / B 评审验收测试 / C 实现 / D 数据接口 / E 接入 / 需求解析 | 全链路 AI 生成 |

## 二、快速开始

```bash
npm install
npm run check     # 总闸：类型检查 + 全部测试（应全绿）
npm run admin     # 管理台：http://localhost:3001/admin（推荐入口）
npm run migrate   # SQLite 模式建表（USER_STORE=sqlite 时需要）
```

**管理台 6 个 tab**：🏠 开始 / 📦 功能开发/ 🔌 数据接口/ 🧪 业务测试/ 📄 代码浏览/ ⚙️ 配置。

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
自动开发（超级向导）：一句话需求 → 7 步逐步生成，每步人确认
  ① 需求规划  ② 数据接口(AI 助手-D)  ③ 功能规格(AI 助手-A)  ④ 验收测试(AI 助手-B)
  ⑤ 实现(AI 助手-C)  ⑥ 接入(AI 助手-E)  ⑦ 完成

各环节机器验收测试：
  数据接口：7 项纪律自动检查（纯接口/零 import/JSDoc/Promise…）
  功能规格：结构/数据接口引用/tsc 自动检查 + 10 项人评审
  验收测试：红灯 = 考卷就绪（占位验收测试禁止定稿）
  实现：验收测试全绿才提交（红则迭代 ≤5 轮，超限停手求援）
  接入：编译预检（写入→编译→自动还原），编译不过禁止确认

定稿守卫：已定稿的功能规格/验收测试/数据接口禁止被 AI 覆盖（修改走功能规格演进）
```

## 五、命令速查

```bash
npm run check                          # 总闸
npm run admin / migrate                # 管理台 / 建表
npm run feat -- new-group <组名>        # 新业务系统
npm run feat -- new <名字> [--group <组>]   # 新功能
npm run feat -- ai-contract <名字> "<需求>" [--mock] [--yes]  # AI 功能规格 + 人确认
npm run feat -- test <名字>             # 只跑该功能验收测试
npm run feat -- ticket <名字>           # 打印 AI 任务单
```

## 六、常见问题

| 问题 | 答案 |
|---|---|
| 没有 API Key 能体验吗？ | 能——mock 模式走完全相同流程（模拟 AI 产出含刻意缺陷，供练评审） |
| 换数据库？ | 配置面板「存储模式」下拉：memory / file(JSON) / sqlite(真库)，一行切换 |
| 功能规格要改？ | 走功能规格演进（v2 + 迁移测试 + 人评审），AI 不碰定稿区 |
| 出 bug 回滚？ | 功能详情「历史/回滚」= git revert，粒度到单功能 |
| 新业务系统？ | `feat new-group` 或面板 ＋，自动生成骨架（通用数据接口复制） |
| 为什么每个产物都进 git？ | 人要为 AI 的产品负责——每个动作可追溯（也让"界面操作"可审计） |
