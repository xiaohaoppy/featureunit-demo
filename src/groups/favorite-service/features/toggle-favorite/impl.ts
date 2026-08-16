/**
 * [角色] 功能单元：toggle-favorite —— 实现（内置实现器 mock，第 2/2 轮尝试）
 * 演示失败安全：此实现未满足验收测试，验收测试会红。
 */
import { AppError, ErrorCodes } from "../../ports/errors";
import type { ToggleFavorite } from "./contract";

export const toggleFavorite: ToggleFavorite = async (_input, _deps) => {
  throw new AppError(ErrorCodes.INVALID_INPUT, 400); // 第 2 轮：故意不满足不变量
};
