<script setup lang="ts">
onMounted(() => {
  navigateTo('/ai-chat', { redirectCode: 302 })
})
</script>

<template>
  <div class="flex items-center justify-center min-h-screen">
    <p class="text-gray-400">正在跳转...</p>
  </div>
</template>
