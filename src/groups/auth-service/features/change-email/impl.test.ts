/**
 * [角色] 功能单元：change-email —— 判据（草稿，模拟 AI 生成，未冻结）
 * 每条不变量一个 it；body 为显式 TODO（必红），请逐条补全断言。
 * 判据作者（Agent-B）纪律：禁止占位断言、禁止改契约/实现。
 */

import { describe, it, expect } from "vitest";
import { changeEmail } from "./impl";

describe("change-email 单元判据", () => {
  it("不变量1｜会话无效 / 已过期 → INVALID_SESSION (401)；过期会话顺手删除；", async () => {
    // TODO: 组装内存适配器 → 调用 changeEmail → 断言「会话无效 / 已过期 → INVALID_SESSION (401)；过期会话顺手删除；」
    throw new Error("TODO: 断言不变量1（会话无效 / 已过期 → INVALID_SESSION (401)；过期会话顺手删除；）");
  });

  it("不变量2｜旧密码错误 → WRONG_PASSWORD (401)，且【不修改任何数据】；", async () => {
    // TODO: 组装内存适配器 → 调用 changeEmail → 断言「旧密码错误 → WRONG_PASSWORD (401)，且【不修改任何数据】；」
    throw new Error("TODO: 断言不变量2（旧密码错误 → WRONG_PASSWORD (401)，且【不修改任何数据】；）");
  });

  it("不变量3｜新邮箱已被【其他】用户占用 → EMAIL_TAKEN (409)，且不修改任何数据", async () => {
    // TODO: 组装内存适配器 → 调用 changeEmail → 断言「新邮箱已被【其他】用户占用 → EMAIL_TAKEN (409)，且不修改任何数据」
    throw new Error("TODO: 断言不变量3（新邮箱已被【其他】用户占用 → EMAIL_TAKEN (409)，且不修改任何数据）");
  });

  it("不变量4｜成功后该用户【所有】会话（含当前）一律失效——邮箱已变，强制重新登录；", async () => {
    // TODO: 组装内存适配器 → 调用 changeEmail → 断言「成功后该用户【所有】会话（含当前）一律失效——邮箱已变，强制重新登录；」
    throw new Error("TODO: 断言不变量4（成功后该用户【所有】会话（含当前）一律失效——邮箱已变，强制重新登录；）");
  });

  it("不变量5｜邮箱（PII）不得进入日志——日志只记 userId。", async () => {
    // TODO: 组装内存适配器 → 调用 changeEmail → 断言「邮箱（PII）不得进入日志——日志只记 userId。」
    throw new Error("TODO: 断言不变量5（邮箱（PII）不得进入日志——日志只记 userId。）");
  });
});
