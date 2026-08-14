/**
 * ============================================================================
 * [角色] 端口：ResetTokenStore —— 重置密码 token 存储端口（冻结区）
 * ----------------------------------------------------------------------------
 * 一句话：找回密码用的"一次性凭证"的存取。
 *
 * 设计要点：
 *   - 过期判定由【单元】用注入的 now() 完成，端口只存 expiresAt 字段。
 *     原因与 SessionStore 相同：测试需要能固定时间模拟过期分支。
 *   - invalidateForUser：重置前先作废旧 token，保证"同一用户同时只存在一个
 *     有效重置 token"——这是防重放攻击的一部分。
 *
 * 谁可以改：只有人。AI 实现任务中禁止修改本文件。
 * ============================================================================
 */

/** 重置 token 记录（纯数据）。 */
export interface ResetTokenRecord {
  token: string;
  userId: string;
  /** 过期时间点（单元用注入的 now() 判定是否过期）。 */
  expiresAt: Date;
}

export interface ResetTokenStore {
  /** 保存一个新 token。 */
  save(record: ResetTokenRecord): Promise<void>;
  /** 按 token 查找；不存在返回 null。可能已过期——由单元判定。 */
  findValid(token: string): Promise<ResetTokenRecord | null>;
  /** 删除单个 token（一次性使用：用后即删）。 */
  delete(token: string): Promise<void>;
  /** 作废某用户的所有 token（新请求到来时，旧 token 立即失效）。 */
  invalidateForUser(userId: string): Promise<void>;
}
