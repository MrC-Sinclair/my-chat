<!--
  @file 应用根组件 (app.vue)
  
  这是 Nuxt 应用的最顶层组件，所有页面都会渲染在这里。
  
  Nuxt 的页面渲染机制：
    NuxtLayout → 提供布局（如导航栏、页脚等公共部分）
      └─ NuxtPage → 根据当前路由渲染对应的 pages/ 下的页面组件
  
  例如访问 /ai-chat 时：
    app.vue → default.vue(布局) → ai-chat.vue(页面)
-->
<template>
  <ToastProvider>
    <ConfirmDialogProvider>
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
    </ConfirmDialogProvider>
  </ToastProvider>
</template>
