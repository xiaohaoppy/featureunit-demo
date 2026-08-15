/**
 * [角色] 功能单元：create-order —— 判据（草稿，模拟 AI 生成，未冻结）
 * 每条不变量一个 it；body 为显式 TODO（必红），请逐条补全断言。
 * 判据作者（Agent-B）纪律：禁止占位断言、禁止改契约/实现。
 */

import { describe, it, expect } from "vitest";
import { createOrder } from "./impl";

describe("create-order 单元判据", () => {
  it("不变量1｜token 有效时执行操作", async () => {
    // TODO: 组装内存适配器 → 调用 createOrder → 断言「token 有效时执行操作」
    throw new Error("TODO: 断言不变量1（token 有效时执行操作）");
  });
});
