<!--
  @file 默认布局组件 (layouts/default.vue)
  
  布局组件定义了页面的公共外壳，所有使用此布局的页面
  都会被渲染在 <slot /> 的位置。
  
  本布局提供：
    - 灰色背景（bg-gray-50）
    - 最小高度占满屏幕（min-h-screen）
  
  使用方式：
    在页面组件中默认就会使用 layouts/default.vue，
    除非页面中通过 definePageMeta({ layout: 'other' }) 指定了其他布局。
-->
<template>
  <div class="min-h-screen bg-gray-50">
    <slot />
  </div>
</template>
