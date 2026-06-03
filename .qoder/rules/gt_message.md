# Git 提交规范

使用中文 Conventional Commits 格式。

## 格式

```
<type>: <简短中文描述>
```

## 类型

| 类型       | 说明                                   |
| ---------- | -------------------------------------- |
| feat       | 新功能                                 |
| fix        | 修复 Bug                               |
| docs       | 文档变更                               |
| style      | 代码格式（不影响逻辑）                 |
| refactor   | 重构（非新功能、非修复）               |
| perf       | 性能优化                               |
| test       | 新增或修改测试                         |
| build      | 构建系统或依赖变更                     |
| ci         | CI 配置变更                            |
| chore      | 其他杂项（不修改 src 或 test）         |
| revert     | 回退提交                               |

## 规则

- 描述用中文，简短明确，不超过 50 字
- 不加句号
- 一条提交只做一件事
- 破坏性变更用 `feat!: 描述` 或 `fix!: 描述`

## 示例

```
feat: 新增暗黑模式切换
fix: 修复消息列表滚动时闪烁
refactor: 拆分会话管理逻辑为独立 composable
docs: 补充部署文档
test: 新增 Markdown 渲染单元测试
```
