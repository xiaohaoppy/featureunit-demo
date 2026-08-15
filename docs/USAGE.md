# FeatureUnit 使用手册

> 怎么用这套框架干活：入口、管理台 6 tab、流水线、命令、配置、FAQ。
> 理念见 `FEATUREUNIT-GUIDE.md`，手把手实操见 `TUTORIAL.md`。

---

## 一、三个入口

| 入口 | 命令 | 作用 | 谁用 |
|---|---|---|---|
| **管理台** | `npm run admin` | 网页界面管理一切（:3001/admin） | 人（日常主力） |
| **CLI** | `npm run feat -- <命令>` | 终端里的全部操作 | 人 / 脚本 |
| **业务服务** | `npm run dev` | 业务本体（:3000） | 联调 / 冒烟 |

三者共用同一套核心逻辑（`scripts/ai-contract-lib.mjs`），行为一致。

---

## 二、第一次使用（5 分钟）

```bash
cd featureunit-demo
npm install
npm run check        # 应全绿（50 个测试）
npm run admin        # 打开 http://localhost:3001/admin
```

浏览器里过一遍：

1. **🏠 开始页**：输入一句话需求 → 「开始自动开发」→ 流水线逐步生成，你逐步确认；
2. **⚙️ 配置**：填 `AI_API_KEY`、选模型（自动获取列表）、选推理等级、选存储模式；
3. **🧪 试玩**：注册 → 登录 → 查我，验证业务；
4. **📦 单元**：左侧选单元 → 看 5 步进度条 → 按 4 阶段推进。

---

## 三、管理台 6 个 tab 详解

| tab | 你（人）能做什么 |
|---|---|
| **🏠 开始** | 一句话需求输入（主入口）→ 流水线进度（7 步，每步"确认/打回"）；快速入口卡片；端口矩阵；总闸 |
| **📦 单元** | 左侧选单元后：顶部 **5 步进度条**（契约→判据→实现→接线→上线）；**① 契约**（AI 生成 + 10 项评审 + 冻结）→ **② 判据**（AI 生成 + 补全断言 + 冻结 + 运行判据）→ **③ 实现**（AI 实现自动迭代 + AI 打包）→ **④ 接线与工具**（接线检查/一键接线/编辑文件/历史回滚/错误码检查/Ticket） |
| **🔌 端口** | 端口清单（一句话/依赖单元/适配器实现）；详情；📝 编辑（git 留痕）；＋ 手动新建 / 🤖 AI 生成（Agent-D）→ 7 项纪律初审 → 确认冻结 |
| **🧪 试玩** | 业务冒烟（注册/登录/查我/登出/改密/改邮箱/找回密码），cookie 自动流转；**存储模式自动跟随配置** |
| **📄 源码** | 只读查看端口/适配器/组合根/配置 |
| **⚙️ 配置** | **存储模式下拉**（memory/file/sqlite）、AI 密钥（打码）、**模型下拉（自动获取）**、**推理等级下拉**、业务参数；来源标注 |

**通用纪律**：任何编辑都要填说明并 git 留痕；已冻结的契约/判据/端口禁止被 AI 覆盖。

---

## 四、流水线（超级向导）——人只说一句话

```
🏠 开始页 → 输入"支持用户收藏商品" → 开始自动开发
```

| 步骤 | 系统做什么 | 机器判据 | 你做什么 |
|---|---|---|---|
| ① 需求规划 | 分析出 服务组/单元/端口 + 理由 | — | 确认或打回 |
| ② 端口生成 | Agent-D 生成端口草稿 | 7 项纪律初审 | 确认 → 冻结 |
| ③ 契约生成 | Agent-A 生成契约草稿 | 结构/端口引用/tsc 初审 | 确认 → 冻结 |
| ④ 判据生成 | Agent-B 生成判据骨架 | 占位判据禁止冻结 | **补全断言** → 确认冻结 |
| ⑤ 实现 | Agent-C 自动迭代 | 判据全绿才提交；超限停手 | 确认（含接受"停手求援"） |
| ⑥ 打包接线 | Agent-E 生成接线 | **tsc 预演**（编译不过禁止确认） | 确认落盘 |
| ⑦ 完成 | — | 总闸 | 冒烟验证 |

**推理等级自动分配**：契约/判据 = `high`（最严谨），端口/实现/打包 = `medium`（可在配置面板调全局默认）。

---

## 五、配置管理

### 写入位置与优先级

```
优先级：本地配置文件 → 环境变量 → 代码默认值
本地配置文件：featureunit-demo/.featureunit.local.json（.gitignore 已忽略）
```

- 管理台「配置」tab 保存 → 写入本地文件；密钥默认打码，留空保存 = 删除；
- CI/服务器可用环境变量覆盖本地配置；
- 存储模式（memory/file/sqlite）切换后，试玩面板**自动重建业务实例**（无需重启）。

### 接真实 AI（唯一需要的配置）

```bash
# 管理台「配置」tab（推荐）：
#   AI_API_KEY = sk-...（打码保存）
#   AI_MODEL   = 自动从 API 获取（也可手填 deepseek-v4-flash / deepseek-v4-pro）
#   AI_REASONING = low / medium / high

# 或环境变量：
export AI_API_KEY=sk-你的密钥
export AI_MODEL=deepseek-v4-flash     # V4 系列；deepseek-chat 已停用
export AI_REASONING=medium
```

不配置时用 **mock 模式**（管理台 mock 开关 / `--mock`）：内置模拟 AI 走完全相同的流程（产出含刻意缺陷，正好练评审）。

---

## 六、命令速查

```bash
npm run check                          # 总闸：tsc + 全部测试
npm run dev                            # 业务服务 :3000
npm run admin                          # 管理台 :3001/admin
npm run migrate                        # SQLite 建表（USER_STORE=sqlite 时）

npm run feat -- new-group <组名>        # 创建新服务组骨架
npm run feat -- new <名字> [--group <组>]   # 开新功能单元
npm run feat -- ai-contract <名字> "<需求>" [--mock] [--yes]
                                       # AI 生成契约 → 初审 → 人确认 → 冻结
npm run feat -- test <名字> [--group <组>]  # 只跑该单元判据
npm run feat -- ticket <名字>           # 打印 AI 任务单
npm run feat -- check                  # 总闸（同 npm run check）
```

### 添加服务组

```bash
npm run feat -- new-group order-service
# 或管理台「服务组」下拉旁的 ＋ 按钮
```

生成骨架：`features/`（空）+ `ports/`（复制 errors/logger，全组错误协议一致）+ `config.ts` + `index.ts`（组合根骨架）+ `manifest.json` + `group.test.ts`。
之后 `feat new <名字> --group order-service` 建第一个单元。
注意：一键接线的锚点目前面向 auth-service——**新组第一个单元请人工接线**（或扩展锚点）。

---

## 七、常见问题

| 问题 | 答案 |
|---|---|
| 换数据库？ | 「配置」存储模式下拉：memory / file(JSON) / sqlite(真库) |
| 契约要改？ | 走契约演进（v2 契约 + 迁移测试 + 人评审），不进 AI 队列 |
| 出 bug 回滚？ | 单元详情「历史/回滚」（git revert），粒度到单单元 |
| 判据红了能改判据吗？ | 不能——改了判据 = 作弊（git 历史可追溯）；占位判据禁止冻结 |
| 哪些文件 AI 不许碰？ | contract.ts / spec.md / impl.test.ts / ports/** / index.ts / config.ts（冻结区） |
| 没有 API Key 能练吗？ | 能——mock 模式流程完全相同，产物含刻意缺陷供练评审 |
| 模型列表怎么来的？ | 配置面板自动调 `/models` 接口获取（60s 缓存；无 Key 时显示兜底列表） |
| 推理等级有什么用？ | low=快省 / medium=平衡 / high=深度推理（契约/判据在流水线中自动用 high） |
| 管理台需要另起业务服务吗？ | 不需要——试玩面板内置业务实例，存储模式自动跟随配置 |
| 新组第一个单元打包？ | 一键接线锚点面向 auth-service，新组请人工接线（tsc 预演会拦住错误接线） |
