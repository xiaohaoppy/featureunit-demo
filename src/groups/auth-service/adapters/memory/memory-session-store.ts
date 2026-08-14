/**
 * ============================================================================
 * [角色] 适配器：MemorySessionStore —— 会话存储的内存实现（测试用）
 * ----------------------------------------------------------------------------
 * 一句话：用 Map 模拟 SessionStore。生产环境换成 Redis 适配器即可
 *         （README 有说明），单元代码零改动。
 *
 * 注意：本文件属于【测试基础设施】（冻结区），AI 实现任务中可读可复用，
 *       禁止修改。
 * ============================================================================
 */

import type { Session, SessionStore } from "../../ports/session-store";

export class MemorySessionStore implements SessionStore {
  private readonly byToken = new Map<string, Session>();

  async create(session: Session): Promise<void> {
    this.byToken.set(session.token, session);
  }

  async findByToken(token: string): Promise<Session | null> {
    return this.byToken.get(token) ?? null;
  }

  async delete(token: string): Promise<void> {
    this.byToken.delete(token); // 幂等：不存在也是成功
  }

  async deleteAllForUser(userId: string): Promise<void> {
    // 遍历删除该用户的所有会话。注意：遍历中删除 Map 是安全的。
    for (const [token, session] of this.byToken) {
      if (session.userId === userId) this.byToken.delete(token);
    }
  }
}
