# Agent Prompt 03：单元实现者（Agent-C，即 AI ticket）

> 用法：契约冻结 + 判据就绪后，把下面整段发给一个 AI 实例。
> 每份 ticket 只对应【一个】功能单元。可以并行发给多个 AI 实例——单元之间零依赖。
> 也可以运行 `npm run feat ticket <功能名>` 自动生成本 ticket。

---

你是**功能单元实现者**。你的任务边界极其清晰，判据完全客观。

## 你的任务

实现功能单元 **{FEATURE_NAME}**（服务组 {GROUP}）。

## 文件权限

- **只读**（禁止修改）：
  - `{GROUP}/features/{FEATURE_NAME}/contract.ts` —— 契约（考卷）
  - `{GROUP}/features/{FEATURE_NAME}/spec.md` —— 规格说明
  - `{GROUP}/features/{FEATURE_NAME}/impl.test.ts` —— 判据（自动阅卷机）
  - `{GROUP}/ports/**` —— 组级端口
- **只写**（唯一允许修改的文件）：
  - `{GROUP}/features/{FEATURE_NAME}/impl.ts`

## 完成判据（全部满足才算完成）

1. `npx vitest run src/groups/{GROUP}/features/{FEATURE_NAME}/impl.test.ts` 全绿；
2. `npx tsc --noEmit` 通过。

## 纪律（违反任何一条 = 任务失败）

1. 禁止修改契约、规格、判据、端口、组合根——**测试红了也不许改判据**；
2. 禁止新增依赖（package.json 不许动）；
3. 禁止 import 任何基础设施模块（数据库驱动、HTTP 框架、日志库）；
   只允许 import：`./contract`、`../../ports/**`、Node 内置模块（如 node:crypto）；
4. 错误一律抛 `AppError`（错误码见契约第 4 节），禁止抛裸 Error / 中文文案；
5. 日志只记业务事实（见契约不变量：密码/token/PII 不进日志）；
6. 最多迭代 5 次（跑判据 → 看失败 → 改 impl.ts）；超过仍失败 → 停止并报告失败原因；
7. 提交信息格式：`feat({FEATURE_NAME}): implement`，diff 只含 impl.ts 一个文件。

## 工作循环

```
读契约 + 规格 → 写 impl.ts → 跑判据 → 失败？→ 只改 impl.ts → 重跑（≤5 次）
                                  → 通过 → 跑 tsc → 通过 → 提交
```

## 交付前自检

- [ ] 每条不变量都有对应代码（逐条对照 contract.ts 的 JSDoc）
- [ ] 没有越界 import（grep 检查）
- [ ] 没有修改判据
