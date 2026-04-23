<script setup lang="ts">
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

interface ToolInvocation {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  state: 'call' | 'partial' | 'result'
  result?: unknown
}

defineProps<{
  invocation: ToolInvocation
}>()

function isCalling(state: string): boolean {
  return state === 'call' || state === 'partial'
}
</script>

<template>
  <div v-if="invocation.toolName === 'weather'">
    <div
      v-if="isCalling(invocation.state)"
      class="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700"
    >
      <span class="animate-spin">🌤️</span>
      <span>正在查询天气: {{ (invocation.args as Record<string, unknown>).city }}</span>
    </div>
    <div
      v-else-if="invocation.state === 'result' && invocation.result"
      class="px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm"
    >
      <template v-if="!(invocation.result as WeatherResult).error">
        <div class="flex items-center gap-2 text-green-700 mb-3">
          <span class="text-lg">🌤️</span>
          <span class="font-semibold text-base">
            {{ (invocation.result as WeatherResult).city }}
            {{ (invocation.result as WeatherResult).region ? `· ${(invocation.result as WeatherResult).region}` : '' }}
          </span>
        </div>
        <div
          v-if="(invocation.result as WeatherResult).current"
          class="flex items-center gap-6 mb-3"
        >
          <div class="text-3xl font-light text-gray-800">
            {{ (invocation.result as WeatherResult).current!.temperature }}
          </div>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
            <div>🤔 体感: {{ (invocation.result as WeatherResult).current!.feelsLike }}</div>
            <div>💧 湿度: {{ (invocation.result as WeatherResult).current!.humidity }}</div>
            <div>🌬️ {{ (invocation.result as WeatherResult).current!.windDirection }} {{ (invocation.result as WeatherResult).current!.windSpeed }}</div>
            <div>☀️ {{ (invocation.result as WeatherResult).current!.condition }}</div>
          </div>
        </div>
        <div
          v-if="(invocation.result as WeatherResult).forecast?.length"
          class="flex gap-3 text-xs text-gray-500 border-t border-green-200 pt-2"
        >
          <div
            v-for="day in (invocation.result as WeatherResult).forecast"
            :key="day.day"
            class="text-center px-2 py-1 rounded bg-white/60"
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

  <div v-else-if="invocation.toolName === 'webSearch'">
    <div
      v-if="isCalling(invocation.state)"
      class="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700"
    >
      <span class="animate-spin">🔍</span>
      <span>正在搜索: {{ (invocation.args as Record<string, unknown>).query }}</span>
    </div>
    <div
      v-else-if="invocation.state === 'result' && invocation.result"
      class="px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm"
    >
      <template v-if="!(invocation.result as SearchResult).error">
        <div class="flex items-center gap-2 text-green-700 mb-2">
          <span>🔍</span>
          <span class="font-medium">已搜索: {{ (invocation.result as SearchResult).query }}</span>
          <span class="text-xs text-green-600">找到 {{ (invocation.result as SearchResult).totalResults }} 条结果</span>
        </div>
        <div class="space-y-2">
          <div
            v-for="item in (invocation.result as SearchResult).results?.slice(0, 3)"
            :key="item.index"
            class="rounded-lg bg-white/70 px-3 py-2"
          >
            <a
              :href="item.url"
              target="_blank"
              rel="noopener noreferrer"
              class="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline line-clamp-1 transition-colors"
            >{{ item.title }}</a>
            <p class="text-xs text-gray-500 mt-0.5 line-clamp-2">{{ item.snippet }}</p>
          </div>
        </div>
      </template>
      <div v-else class="text-xs text-red-500">
        {{ (invocation.result as SearchResult).error }}
      </div>
    </div>
  </div>
</template>
