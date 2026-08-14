/**
 * ============================================================================
 * [角色] 适配器：MemoryUserStore —— 用户存储的内存实现（测试用）
 * ----------------------------------------------------------------------------
 * 一句话：用 Map 模拟 UserStore，让单元测试不依赖任何数据库。
 *
 * 为什么这是框架的基石：
 *   - 判据可复现：内存实现没有外部状态，测试永远确定性通过/失败；
 *   - 判据够快：毫秒级，AI 的"写→跑→改"循环可以转几十圈；
 *   - 它是"端口语义正确性"的参照物：任何真实适配器（Postgres、文件）
 *     都必须和它的行为一致，否则就是适配器写错了。
 *
 * 注意：本文件属于【测试基础设施】，AI 实现任务中可读、可复用，
 *       但禁止修改（它也是冻结区的一部分——改了它等于改判据）。
 * ============================================================================
 */

import type { User, UserStore } from "../../ports/user-store";

export class MemoryUserStore implements UserStore {
  /** 双索引：email 和 id 各一张表，模拟真实数据库的两个查询路径。 */
  private readonly byEmail = new Map<string, User>();
  private readonly byId = new Map<string, User>();

  async findByEmail(email: string): Promise<User | null> {
    return this.byEmail.get(email) ?? null;
  }

  async findById(id: string): Promise<User | null> {
    return this.byId.get(id) ?? null;
  }

  async create(user: User): Promise<void> {
    this.byEmail.set(user.email, user);
    this.byId.set(user.id, user);
  }

  async updatePasswordHash(id: string, hash: string): Promise<void> {
    const existing = this.byId.get(id);
    if (!existing) return; // 幂等：id 不存在静默忽略（与端口语义一致）
    const updated: User = { ...existing, passwordHash: hash };
    this.byEmail.set(updated.email, updated);
    this.byId.set(id, updated);
  }

  async updateEmail(id: string, email: string): Promise<void> {
    const existing = this.byId.get(id);
    if (!existing) return; // 幂等：id 不存在静默忽略
    const updated: User = { ...existing, email };
    // 双索引同步：先删旧 email 键，再写新 email 键（避免旧键残留脏数据）
    this.byEmail.delete(existing.email);
    this.byEmail.set(updated.email, updated);
    this.byId.set(id, updated);
  }
}
