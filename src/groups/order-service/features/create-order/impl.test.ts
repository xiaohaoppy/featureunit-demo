/**
 * [角色] 功能单元：create-order —— 判据（人补全版）
 * 契约不变量 1 条：token 有效时执行操作（mock 契约语义）。
 */

import { describe, expect, it } from "vitest";
import { createOrder } from "./impl";
import { silentLogger } from "../../ports/logger";

describe("create-order 单元判据", () => {
  it("不变量1｜token 有效时执行操作并返回", async () => {
    await expect(
      createOrder({ token: "t1", payload: { sku: "S1" } }, { logger: silentLogger }),
    ).resolves.toBeUndefined();
  });
});
