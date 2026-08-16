import { describe, expect, it } from "vitest";
import { toggleFavorite } from "./impl";
import { silentLogger } from "../../ports/logger";
describe("toggle-favorite 单元判据", () => {
  it("不变量1｜token 有效时执行操作", async () => {
    await expect(toggleFavorite({ token: "t1", payload: {} }, { logger: silentLogger })).resolves.toBeUndefined();
  });
});