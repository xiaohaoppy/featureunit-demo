# FeatureUnit 框架 · 让 AI 放心写代码

> **人只说一句话，系统自动规划业务系统 / 数据接口 / 功能，逐步生成，人在每一步确认。**
> 核心原则：**AI 生成 → 机器验收测试 → 人确认**，每个产物定稿进 git，人人可追溯。

## 📚 文档导航

| 文档 | 内容 |
|---|---|
| [`docs/USAGE.md`](docs/USAGE.md) | **使用手册**：三个入口、6 个 tab、日常流程、命令、配置、正式部署 |
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
npm run dev       # 业务服务：http://localhost:3000（访问生成的功能路由）
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

**存储位置分离**（配置面板可独立控制）：业务数据（`DATA_DIR`/`SQLITE_PATH`）、业务日志（`LOG_DIR`→`app.log`）、错误记录（`ERROR_LOG_DIR`→`errors.log`）三个位置互不混放。

**数据接口 × 存储对接**：组合根 `buildDeps` 注入通用 KV 存储（`USER_STORE` 一行切换 memory/file/sqlite），数据类端口（如收藏条目存储）经组合根绑定到它；「配置」面板底部有**对接自检**（写→读→删），换存储模式后点保存即可验证。

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

## 六、这个框架适合开发什么，不适合什么

**核心判断标准一句话："完成"能否被机器判定（验收测试）？** 能 → 适合；不能 → 先别让 AI 写。

| 场景 | 适合？ | 原因 |
|---|---|---|
| 业务服务（CRUD / 订单 / 库存 / 收藏 / 地址） | ✅ 推荐 | 边界清晰、输入输出可断言、验收测试客观 |
| 数据接口（存储 / 邮件 / 限流等外部能力） | ✅ | 纯接口定义，7 项纪律自动检查 |
| 数据处理管线（ETL / 批量任务） | ⚠️ 可以 | 数据接口换成"输入输出批"，功能粒度更大 |
| 算法 / 规则密集模块 | ⚠️ 谨慎 | 可用黄金测试，但功能内耦合多、规格常改 |
| 探索性原型（需求未定） | ❌ | 功能规格无法定稿，先自由探索 |
| 强耦合横切改造（动一点全库跟着动） | ❌ | 只能走功能规格演进通道，成本高 |
| UI / 前端页面 | ❌ | 视觉与交互难用验收测试机器判定，框架面向后端能力 |

一句话：**让 AI 写"可被考试的功能"，不写"感觉对了的功能"**——人负责业务风险（安全边界/语义），机器负责"是否完成"，AI 负责"怎么写"。

## 七、正式部署

```bash
# 1. 装依赖 + 自检
npm ci && npm run check

# 2. 生产配置（环境变量，或用 .featureunit.local.json）
export PORT=8080                 # 业务服务端口（默认 3000）
export GROUP=order-service       # 启动哪个业务系统（默认 auth-service）
export USER_STORE=sqlite         # 生产用真库
export SQLITE_PATH=./data/app.db
export LOG_DIR=./data/logs       # 日志落盘（app.log）
export ERROR_LOG_DIR=./data/errors  # 错误记录（errors.log）

# 3. 建表（sqlite 模式）
npm run migrate

# 4. 启动（生产）
npm start
# 访问：http://<主机>:8080/api/<功能名>

# 5. 托管（二选一）
pm2 start npm --name featureunit -- run start          # pm2
# 或 systemd：ExecStart=/usr/bin/npm start --prefix /opt/featureunit-demo
```

- **为什么没有 dist 构建**：本项目源码为 ESM + 无扩展名 import（Bundler 解析），tsc 编译产物无法被 node 直接运行；生产与管理台一样用 tsx 直跑（同一套代码、同一套行为），避免"编译产物与源码行为不一致"；
- **多业务系统**：每个组一个进程，`GROUP=<组名> npm start`；
- **管理台**（可选）：`npm run admin` 单独起（:3001），生产可不开；
- **密钥**：管理台才需要 `AI_API_KEY`（开发/生成用）；纯业务服务不需要 AI 密钥。

## 八、常见问题

| 问题 | 答案 |
|---|---|
| 没有 API Key 能体验吗？ | 能——mock 模式走完全相同流程（模拟 AI 产出含刻意缺陷，供练评审） |
| 换数据库？ | 配置面板「存储模式」下拉：memory / file(JSON) / sqlite(真库)，一行切换；「对接自检」一键验证 |
| 功能规格要改？ | 走功能规格演进（v2 + 迁移测试 + 人评审），AI 不碰定稿区 |
| 出 bug 回滚？ | 功能详情「历史/回滚」= git revert，粒度到单功能 |
| 新业务系统？ | `feat new-group` 或面板 ＋，自动生成骨架（通用数据接口/存储适配器复制） |
| 为什么每个产物都进 git？ | 人要为 AI 的产品负责——每个动作可追溯（也让"界面操作"可审计） |
| 业务测试面板怎么没有我的功能？ | 面板操作是动态发现的——功能接入后自动出现；用「业务系统」下拉切换组 |
| 生成的业务怎么访问？ | ① 管理台 🧪 业务测试面板（内部实例，随手冒烟）；② **`npm run dev`** 起真实业务服务（默认 :3000），浏览器/前端直接访问 `http://localhost:3000/api/<功能名>`；多业务系统用 `GROUP=<组名> npm run dev` |
| 正式环境怎么部署？ | **`npm start`** 生产启动 + 环境变量配置（见「七、正式部署」）；pm2/systemd 托管，`GROUP=<组名>` 起多业务系统 |

## 九、本项目如何诞生（以及你如何用 AI 协作改造它）

**本项目（框架代码、管理台、文档、测试）由作者与 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)（AI 编程代理）逐轮对话协作完成**：作者提出设计想法与验收标准（前后约 60 轮设计迭代），Harness 负责实现、测试、写文档，作者在每个关键决策处确认——正是本框架主张的"AI 生成 → 机器判据 → 人确认"流程的真实实践。

**你也可以使用 DeepSeek Harness 辅助修改/扩展本框架**，建议方式：

1. 把需求/想法直接说给它（中文即可），例如："给管理台加一个 XX 面板""修掉流水线里 XX 的问题"；
2. 让它**在框架纪律内**工作：改代码前先跑 `npm run check`，每步确认，改动留痕（git 提交）；
3. 涉及定稿区（功能规格/验收测试/数据接口）的修改走功能规格演进，由人确认；
4. 大改动后跑 `npm run smoke`（全量 43 项）验证不破坏框架行为。

> 用 Harness 改这个框架，等于用这套纪律改造它自己——框架本身就是为了"让 AI 放心写代码"设计的，它对自己的改造同样适用。
