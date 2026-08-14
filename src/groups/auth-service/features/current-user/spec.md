# 契约规格：current-user（v1.0）

## 1. 一句话目标
"我是谁"接口：凭 token 返回当前登录用户。所有需要登录的页面/接口都依赖它。

## 2. 输入
- `token`：非空字符串（通常来自 httpOnly cookie）

## 3. 输出
成功 → `{ id, email }`。失败 → 抛 AppError。

## 4. 错误码
- `INVALID_INPUT` (400)：token 为空（组合根 zod 兜底）
- `INVALID_SESSION` (401)：token 无效 / 过期 / 用户已删除（同一码，不泄漏细节）

## 5. 端口
- `sessions: SessionStore` —— 查会话
- `users: UserStore` —— 查用户
- `now: () => Date` —— 过期判定（注入时钟）

## 6. 不变量 / 边界情况
- 三种失败原因（无 token / 过期 / 用户被删）对外一律是 `INVALID_SESSION`
- 过期会话顺手删除
- 返回不含 `passwordHash`
- 【不】负责：token 续期、权限/角色判断（那是别的单元的活）
