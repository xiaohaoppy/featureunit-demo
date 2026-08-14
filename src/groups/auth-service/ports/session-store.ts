/**
 * ============================================================================
 * [角色] 端口：SessionStore —— 会话存储端口（冻结区）
 * ----------------------------------------------------------------------------
 * 一句话：登录后"你是谁"的凭证存储。生产环境一般是 Redis（带 TTL），
 *         但单元完全不感知——它只调用 create/findByToken/delete。
 *
 * 设计要点：
 *   - 过期判定由【单元】用注入的 now() 完成，端口不判定过期。
 *     原因：测试要能固定时间（把 now 注入成假时钟），如果端口内部
 *     用 Date.now() 判过期，测试就无法模拟"会话过期"这个分支。
 *   - token 由【单元】生成（randomUUID），端口只负责存取，不生成任何 ID。
 *
 * 谁可以改：只有人（契约演进流程）。AI 实现任务中禁止修改本文件。
 * ============================================================================
 */

/** 会话记录（纯数据）。 */
export interface Session {
  /** 不透明凭证。只存哈希版用于查找？——否：本框架用随机 UUID 做 token，本身不可预测，直接存储。 */
  token: string;
  userId: string;
  /** 过期时间点。单元负责：now() > expiresAt 即视为无效。 */
  expiresAt: Date;
}

/** 会话存储端口。 */
export interface SessionStore {
  /** 创建会话。token 冲突时覆盖（UUID 碰撞概率可忽略，语义简单化）。 */
  create(session: Session): Promise<void>;
  /** 按 token 查找；不存在返回 null。返回的记录可能已过期——由单元判定。 */
  findByToken(token: string): Promise<Session | null>;
  /** 删除单个会话。token 不存在时静默忽略（登出必须幂等）。 */
  delete(token: string): Promise<void>;
  /**
   * 删除某用户的【所有】会话（改密 / 重置密码后强制全端下线）。
   * 为什么需要它：密码变更后，旧的登录凭证必须立即全部失效——
   * 这是安全不变量，必须由单元显式调用，而不是"碰巧"靠过期。
   */
  deleteAllForUser(userId: string): Promise<void>;
}
