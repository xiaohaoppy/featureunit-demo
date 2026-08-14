/**
 * ============================================================================
 * [角色] 端口：UserStore —— 用户存储端口（冻结区）
 * ----------------------------------------------------------------------------
 * 一句话：功能单元眼中"用户数据"的最小切面。
 *
 * 纪律（违反任何一条 = 评审不通过）：
 *   - 只允许纯数据 + 接口，禁止任何实现代码
 *   - 禁止引入 ORM / HTTP / 框架类型（Knex、Prisma、express.Request 等）
 *   - 语义必须能被内存适配器完整模拟——否则单元无法用内存适配器测试
 *   - 不暴露"存储实现细节"：没有 save 事务、没有分页、没有 SQL
 *
 * 注意：passwordHash 字段存在于此端口（存储层必须存哈希），
 *       但任何功能单元的【返回结果】都禁止携带它（见各契约的不变量）。
 *
 * 谁可以改：只有人（契约演进流程）。AI 实现任务中禁止修改本文件。
 * ============================================================================
 */

/** 用户实体（纯数据）。id 由调用方生成（组合根层 randomUUID 注入）。 */
export interface User {
  id: string;
  email: string;
  /** 只存哈希，绝不存明文。格式由 PasswordHasher 适配器决定（如 scrypt$...）。 */
  passwordHash: string;
}

/** 用户存储端口：7 个功能单元中有 5 个依赖它（register/login/current-user/...）。 */
export interface UserStore {
  /** 按邮箱查找；不存在返回 null（不抛错——"不存在"是正常业务分支）。 */
  findByEmail(email: string): Promise<User | null>;
  /** 按 id 查找；不存在返回 null。 */
  findById(id: string): Promise<User | null>;
  /** 创建用户。重复邮箱由【单元】负责先查后建（端口不做唯一性约束，语义更简单）。 */
  create(user: User): Promise<void>;
  /** 更新密码哈希（改密 / 重置密码用）。id 不存在时静默忽略（幂等）。 */
  updatePasswordHash(id: string, hash: string): Promise<void>;
  /**
   * 更新邮箱（change-email 单元用）。id 不存在时静默忽略（幂等）。
   * 注意：邮箱唯一性检查由【单元】负责（先 findByEmail 再更新），
   *       端口不做约束——与 create 的语义保持一致。
   */
  updateEmail(id: string, email: string): Promise<void>;
}
