<!--
  @file 首页 (/)
  
  这是应用的入口页面，提供一个跳转到 AI 聊天页面的按钮。
  
  路由规则：
    pages/index.vue 对应根路径 "/"
    pages/ai-chat.vue 对应 "/ai-chat"
  
  NuxtLink 是 Nuxt 提供的路由导航组件，
  类似于 <a> 标签但支持客户端路由（不会整页刷新）。
-->
<template>
  <div class="flex items-center justify-center min-h-screen">
    <NuxtLink
      to="/ai-chat"
      class="px-8 py-4 text-lg font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors"
    >
      进入 AI 对话助手 →
    </NuxtLink>
  </div>
</template>
