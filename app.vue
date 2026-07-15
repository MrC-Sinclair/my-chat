<!--
  @file 应用根组件 (app.vue)
  
  这是 Nuxt 应用的最顶层组件，所有页面都会渲染在这里。
  
  Nuxt 的页面渲染机制：
    NuxtLayout → 提供布局（如导航栏、页脚等公共部分）
      └─ NuxtPage → 根据当前路由渲染对应的 pages/ 下的页面组件
  
  例如访问 /ai-chat 时：
    app.vue → default.vue(布局) → ai-chat.vue(页面)
-->
<script setup lang="ts">
useHead({
  title: 'My Chat - AI 对话助手',
  htmlAttrs: {
    lang: 'zh-CN'
  },
  meta: [
    {
      name: 'viewport',
      content: 'width=device-width, initial-scale=1'
    },
    {
      name: 'description',
      content: '基于 Nuxt 3 与 Vercel AI SDK 的 AI 对话应用，支持 Markdown / LaTeX 安全渲染、图片多模态对话、工具调用与长期记忆。'
    }
  ]
})
</script>

<template>
  <ToastProvider>
    <ConfirmDialogProvider>
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
    </ConfirmDialogProvider>
  </ToastProvider>
</template>
