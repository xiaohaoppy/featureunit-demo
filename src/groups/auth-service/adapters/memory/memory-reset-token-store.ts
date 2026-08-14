/**
 * ============================================================================
 * [角色] 适配器：MemoryResetTokenStore —— 重置 token 的内存实现（测试用）
 * ----------------------------------------------------------------------------
 * 一句话：用 Map 模拟 ResetTokenStore。测试基础设施，冻结区。
 * ============================================================================
 */

import type { ResetTokenRecord, ResetTokenStore } from "../../ports/reset-token-store";

export class MemoryResetTokenStore implements ResetTokenStore {
  private readonly byToken = new Map<string, ResetTokenRecord>();

  /** 当前 token 总数（仅供测试断言，如"不应写入任何 token"）。 */
  get size(): number {
    return this.byToken.size;
  }

  async save(record: ResetTokenRecord): Promise<void> {
    this.byToken.set(record.token, record);
  }

  async findValid(token: string): Promise<ResetTokenRecord | null> {
    return this.byToken.get(token) ?? null;
  }

  async delete(token: string): Promise<void> {
    this.byToken.delete(token);
  }

  async invalidateForUser(userId: string): Promise<void> {
    for (const [token, record] of this.byToken) {
      if (record.userId === userId) this.byToken.delete(token);
    }
  }
}
