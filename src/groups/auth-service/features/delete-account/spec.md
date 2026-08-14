# 契约规格：delete-account（v0.1-draft，模拟 AI 生成）

## 1. 一句话目标
登录用户可以删除自己的账号（敏感操作，需验证密码）

## 2. 输入
- token：会话凭证
- payload：业务参数（待定）

## 3. 输出
成功 → void

## 4. 错误码
（待补）

## 5. 端口
- users: UserStore
- sessions: SessionStore
- logger: Logger

## 6. 不变量 / 边界情况
- token 有效时执行
