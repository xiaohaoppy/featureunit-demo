/**
 * [角色] 功能单元：create-order —— 契约（冻结区）
 * 谁可以改：只有人（契约演进流程）。AI 实现任务中【禁止】修改本文件。
 * 填写指南：docs/contract-template.md（六要素）
 */

import { z } from "zod";

// TODO(人/契约设计师)：定义输入 schema（含边界规则，见模板第 2 节）
export const CreateOrderInput = z.object({
  // example: email: z.string().email(),
});

export type CreateOrderInput = z.infer<typeof CreateOrderInput>;

// TODO：声明依赖端口（只允许纯数据 + 接口，禁止 ORM/HTTP/框架类型）
export interface CreateOrderDeps {
  // example: users: UserStore;
}

export interface CreateOrderResult {
  // example: ok: true;
}

export interface CreateOrder {
  (input: CreateOrderInput, deps: CreateOrderDeps): Promise<CreateOrderResult>;
}

/**
 * 不变量（≥3 条，条条可被测试断言；impl.test.ts 会逐条验证）：
 * 1. TODO
 * 2. TODO
 * 3. TODO
 */
