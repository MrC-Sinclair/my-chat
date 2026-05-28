## Context

当前 `ai-chat.vue` 的 `quickPrompts` 数组在欢迎页（无消息时）展示 6 条快捷提示语。第 4 条（索引 3）为"推荐好看的科幻电影"，无法展示 my-chat 的完整渲染能力。

修改范围：仅修改 `quickPrompts` 数组中一条记录的 icon、title、prompt 字段，不涉及任何组件结构调整或新功能开发。

## Goals / Non-Goals

**Goals:**
- 替换第 4 条快捷提示语为一条能触发 AI 生成复杂图文混排内容的 prompt
- 新 prompt 让 AI 输出包含图片、Mermaid 流程图、KaTeX 公式、代码块等多种渲染元素
- 用户点击后一键发送，无需手动输入

**Non-Goals:**
- 不修改欢迎页 UI 布局
- 不新增或修改渲染管线
- 不涉及服务端变更

## Decisions

**Prompt 内容设计：**

新 prompt 指示 AI 生成一个"技术博客预览"风格的回复，包含：
1. 一张 Markdown 图片（测试图片渲染）
2. 一段说明文字（测试文本渲染）
3. 一个 Mermaid 流程图（测试 Mermaid 渲染）
4. 一个 KaTeX 行内公式 + 块级公式（测试公式渲染）
5. 一个代码块（测试代码高亮）

prompt 内容：
```
请用以下格式生成一个技术博客预览：1. 先输出一张图片：![技术插图](https://automation.vuejs.org/images/buy_instagram_followers_from_socialwick.png)；2. 写一段关于前端Markdown渲染的介绍；3. 用mermaid画一个简单的渲染流程图；4. 展示一个KaTeX行内公式 $E = mc^2$ 和块级公式 $$\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}$$；5. 最后给一个JavaScript代码示例。
```

**icon 选择：** 使用 `🎨`（调色板），代表多种内容混合。

**title 选择：** "前端复杂图文混排测试"

## Risks / Trade-offs

无风险。此变更为纯配置内容修改，不影响任何现有功能。