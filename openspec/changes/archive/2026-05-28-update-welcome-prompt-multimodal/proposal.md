## Why

当前欢迎页 6 条快捷提示语中，第 4 条（科幻电影推荐）无法展示 my-chat 的核心渲染能力（图片、Mermaid 流程图、KaTeX 公式、代码高亮等）。需要一条能一键触发 AI 生成复杂图文混排内容的 prompt，让用户和新访客快速体验项目的完整 Markdown 渲染管线。

## What Changes

- 修改 `ai-chat.vue` 中 `quickPrompts` 数组第 4 条（索引 3）的 icon、title 和 prompt
- 新 prompt 指示 AI 生成包含图片、Mermaid 图、KaTeX 公式、代码块等元素的混合内容

## Capabilities

### New Capabilities
<!-- 此变更不引入新功能能力，仅为内容配置变更 -->
无

### Modified Capabilities
<!-- 无现有 spec 被修改 -->
无

## Impact

| 层级 | 影响 |
|------|------|
| 前端页面 | `pages/ai-chat.vue` — 修改 quickPrompts 数组中一条记录 |
| 其他 | 无 |