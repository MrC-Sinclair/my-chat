---
alwaysApply: true
scene: git_message
---

# Git Commit Message 规范

## 格式

```
type(scope): 简短描述
```

- 使用中文描述，不用句号结尾
- 描述"做了什么"而非"怎么做的"：✅ `添加图片上传功能` ❌ `使用ImgBB API实现图片上传`
- 首行不超过 72 个字符

## type 类型

| type     | 用途                       | 示例                                                 |
| -------- | -------------------------- | ---------------------------------------------------- |
| feat     | 新功能                     | feat(chat): 添加Mermaid流程图支持                    |
| fix      | 修复 bug                   | fix(chat): 修复中文输入法下回车键触发提交的问题      |
| refactor | 重构（不改变功能）         | refactor(chat): 增加上下文消息数量限制并优化处理逻辑 |
| style    | 代码格式调整（不影响逻辑） | style: 统一缩进风格                                  |
| docs     | 文档变更                   | docs: 更新环境变量说明                               |
| perf     | 性能优化                   | perf(chat): 实现消息列表虚拟滚动以提升性能           |
| test     | 测试相关                   | test: 添加Markdown渲染单元测试                       |
| chore    | 构建/工具/依赖变更         | chore: 升级Nuxt到3.21                                |

## scope 范围

根据项目架构选择合适的 scope：

| scope    | 对应目录/模块                                       |
| -------- | --------------------------------------------------- |
| chat     | pages/ai-chat.vue、components/chat/                 |
| markdown | utils/markdown.ts、utils/katex.ts、MarkdownRenderer |
| api      | server/api/                                         |
| db       | server/db/、schema.ts                               |
| tools    | server/tools/                                       |
| config   | server/config/、nuxt.config.ts                      |
| ui       | 通用UI组件、样式                                    |
| 无       | 跨模块或全局变更                                    |

## 规则

1. **一个 commit 只做一件事**：混合多种 type 的变更应拆分为多个 commit
2. **scope 要具体**：`feat(chat)` 比 `feat` 更好，`feat(markdown)` 比 `feat(chat)` 更精确
3. **描述要说明"做了什么"而非"怎么做的"**：✅ `feat(chat): 添加图片上传功能` ❌ `feat(chat): 使用ImgBB API实现图片上传`
4. **破坏性变更加 `!`**：`feat(api)!: 重构聊天接口请求格式`
5. **不要在 commit message 中包含敏感信息**（API Key、密码等）
