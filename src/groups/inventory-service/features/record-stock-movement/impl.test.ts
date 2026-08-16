/**
 * [角色] 功能单元：record-stock-movement —— 验收测试（人补全，真实断言）
 */

import { describe, it, expect } from "vitest";
import { recordStockMovement } from "./impl";
import { AppError } from "../../../ports/errors";
import type { KVStore } from "../../../adapters/storage";

/** 内存 KV（与框架 storage 的 memory 实现同语义，测试自包含）。 */
function memKV(): KVStore {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => void m.set(k, v),
    del: async (k) => void m.delete(k),
    listKeys: async (prefix = "") => [...m.keys()].filter((k) => k.startsWith(prefix)).sort(),
  };
}

describe("record-stock-movement 单元验收测试", () => {
  const fixedNow = () => new Date("2026-01-01T00:00:00.000Z");
  const deps = () => ({ kv: memKV(), logger: { info: () => {}, warn: () => {}, error: () => {} }, now: fixedNow });

  it("不变量1｜每条变动记录写入 kv：键含 sku 与时间戳，值为完整 JSON", async () => {
    const d = deps();
    await recordStockMovement({ sku: "SKU-1", delta: 5, operatorId: "op-1" }, d);
    const keys = await d.kv.listKeys("stock:SKU-1:");
    expect(keys.length).toBe(1);
    const rec = JSON.parse((await d.kv.get(keys[0]!))!);
    expect(rec.sku).toBe("SKU-1");
    expect(rec.delta).toBe(5);
    expect(rec.operatorId).toBe("op-1");
  });

  it("不变量2｜同一 sku 的多次变动互不覆盖（追加式）", async () => {
    const d = deps();
    const t1 = () => new Date("2026-01-01T00:00:00.000Z");
    await recordStockMovement({ sku: "SKU-2", delta: 5, operatorId: "op-1" }, { ...d, now: t1 });
    await recordStockMovement({ sku: "SKU-2", delta: -2, operatorId: "op-2" }, { ...d, now: () => new Date("2026-01-01T00:00:01.000Z") });
    const keys = await d.kv.listKeys("stock:SKU-2:");
    expect(keys.length).toBe(2); // 两条并存
    const recs = (await Promise.all(keys.map((k) => d.kv.get(k)))).map((v) => JSON.parse(v!));
    expect(recs.map((r) => r.delta).sort((a, b) => a - b)).toEqual([-2, 5]);
  });

  it("不变量3｜delta 为 0 → 抛 AppError(INVALID_INPUT)", async () => {
    const d = deps();
    await expect(recordStockMovement({ sku: "SKU-3", delta: 0, operatorId: "op-1" }, d))
      .rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
  });

  it("不变量4｜记录含时间戳，时间来自注入的 now", async () => {
    const d = deps();
    await recordStockMovement({ sku: "SKU-4", delta: 1, operatorId: "op-1" }, d);
    const keys = await d.kv.listKeys("stock:SKU-4:");
    const rec = JSON.parse((await d.kv.get(keys[0]!))!);
    expect(rec.ts).toBe("2026-01-01T00:00:00.000Z");
  });
});
