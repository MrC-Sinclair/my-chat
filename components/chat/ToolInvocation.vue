<!--
  @component 工具调用展示组件
  @file components/chat/ToolInvocation.vue

  从 ai-chat.vue 中抽离的工具调用展示组件，负责：
    - 展示天气查询工具的调用状态和结果
    - 展示网页搜索工具的调用状态和结果
    - 支持加载中/已完成两种状态

  Props：
    - invocation: 工具调用对象，包含工具名、参数、状态和结果
-->
<script setup lang="ts">
/** 天气工具返回结果的类型定义 */
interface WeatherResult {
  error?: string
  city?: string
  region?: string
  current?: {
    temperature: string
    feelsLike: string
    humidity: string
    condition: string
    windSpeed: string
    windDirection: string
  }
  forecast?: Array<{
    day: string
    condition: string
    high: string
    low: string
    rainChance: string
  }>
}

/** 搜索工具返回结果的类型定义 */
interface SearchResult {
  error?: string
  results?: Array<{
    index: number
    title: string
    url: string
    snippet: string
  }>
  totalResults?: number
  query?: string
}

/** 工具调用对象的类型定义 */
interface ToolInvocation {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  state: 'call' | 'partial' | 'result'
  result?: unknown
}

defineProps<{
  /** 工具调用对象 */
  invocation: ToolInvocation
}>()

/** 判断工具是否正在调用中 */
function isCalling(state: string): boolean {
  return state === 'call' || state === 'partial'
}
</script>

<template>
  <!-- 天气查询工具 -->
  <div v-if="invocation.toolName === 'weather'">
    <!-- 查询中 -->
    <div
      v-if="isCalling(invocation.state)"
      class="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700"
    >
      <span class="animate-spin">🌤️</span>
      <span>正在查询天气: {{ (invocation.args as Record<string, unknown>).city }}</span>
    </div>
    <!-- 查询完成 -->
    <div
      v-else-if="invocation.state === 'result' && invocation.result"
      class="px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-sm"
    >
      <template v-if="!(invocation.result as WeatherResult).error">
        <div class="flex items-center gap-2 text-green-700 mb-2">
          <span>🌤️</span>
          <span class="font-medium">
            {{ (invocation.result as WeatherResult).city }}
            {{ (invocation.result as WeatherResult).region ? `· ${(invocation.result as WeatherResult).region}` : '' }}
          </span>
        </div>
        <div
          v-if="(invocation.result as WeatherResult).current"
          class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 mb-2"
        >
          <div>🌡️ 温度: {{ (invocation.result as WeatherResult).current!.temperature }}</div>
          <div>🤔 体感: {{ (invocation.result as WeatherResult).current!.feelsLike }}</div>
          <div>💧 湿度: {{ (invocation.result as WeatherResult).current!.humidity }}</div>
          <div>🌬️ {{ (invocation.result as WeatherResult).current!.windDirection }} {{ (invocation.result as WeatherResult).current!.windSpeed }}</div>
          <div class="col-span-2">☀️ 天气: {{ (invocation.result as WeatherResult).current!.condition }}</div>
        </div>
        <div
          v-if="(invocation.result as WeatherResult).forecast?.length"
          class="flex gap-3 text-xs text-gray-500"
        >
          <div
            v-for="day in (invocation.result as WeatherResult).forecast"
            :key="day.day"
            class="text-center"
          >
            <div class="font-medium text-gray-700">{{ day.day }}</div>
            <div>{{ day.condition }}</div>
            <div>{{ day.low }} ~ {{ day.high }}</div>
            <div>🌧️ {{ day.rainChance }}</div>
          </div>
        </div>
      </template>
      <div v-else class="text-xs text-red-500">
        {{ (invocation.result as WeatherResult).error }}
      </div>
    </div>
  </div>

  <!-- 网页搜索工具 -->
  <div v-else-if="invocation.toolName === 'webSearch'">
    <!-- 搜索中 -->
    <div
      v-if="isCalling(invocation.state)"
      class="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700"
    >
      <span class="animate-spin">🔍</span>
      <span>正在搜索: {{ (invocation.args as Record<string, unknown>).query }}</span>
    </div>
    <!-- 搜索完成 -->
    <div
      v-else-if="invocation.state === 'result' && invocation.result"
      class="px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-sm"
    >
      <template v-if="!(invocation.result as SearchResult).error">
        <div class="flex items-center gap-2 text-green-700 mb-1.5">
          <span>🔍</span>
          <span class="font-medium">已搜索: {{ (invocation.result as SearchResult).query }}</span>
          <span class="text-xs text-green-600">找到 {{ (invocation.result as SearchResult).totalResults }} 条结果</span>
        </div>
        <div class="space-y-1">
          <div
            v-for="item in (invocation.result as SearchResult).results?.slice(0, 3)"
            :key="item.index"
            class="flex items-start gap-1.5 text-xs text-gray-600"
          >
            <span class="text-green-500 shrink-0">•</span>
            <a
              :href="item.url"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:text-blue-600 hover:underline line-clamp-1"
            >{{ item.title }}</a>
          </div>
        </div>
      </template>
      <div v-else class="text-xs text-red-500">
        {{ (invocation.result as SearchResult).error }}
      </div>
    </div>
  </div>
</template>
