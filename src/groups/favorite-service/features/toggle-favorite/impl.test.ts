/**
 * 定稿记录（验收测试）：2026-08-16 由 流水线确认 确认后定稿。
 * 定稿后任何修改必须走功能规格演进流程（改了验收测试 = 作弊，git 历史可追溯）。
 */
import { describe, expect, it } from "vitest";
import { toggleFavorite } from "./impl";
import { silentLogger } from "../../ports/logger";
describe("toggle-favorite 单元判据", () => {
  it("不变量1｜token 有效时执行操作", async () => {
    await expect(toggleFavorite({ token: "t1", payload: {} }, { logger: silentLogger })).resolves.toBeUndefined();
  });
});