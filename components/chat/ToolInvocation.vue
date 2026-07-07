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

interface OcrResult {
  text?: string
  error?: string
  detail?: string
  imageUrl?: string
  model?: string
}

interface ToolInvocation {
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error'
  output?: unknown
  errorText?: string
}

defineProps<{
  invocation: ToolInvocation
}>()

function isCalling(state: string): boolean {
  return state === 'input-streaming' || state === 'input-available'
}

/**
 * 从 URL 中提取域名，用于显示来源
 */
function getDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname
    return hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * 获取网站 favicon 的 URL
 */
function getFavicon(url: string): string {
  try {
    const hostname = new URL(url).hostname
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`
  } catch {
    return ''
  }
}

/**
 * 从工具输入中安全读取城市字段
 * 注：类型断言放在 script 而非模板，避免 prettier 把 Record<string, unknown> 的泛型尖括号误判为 HTML 标签
 */
function getInputCity(input: Record<string, unknown>): string {
  return (input as { city?: string }).city ?? ''
}

/**
 * 从工具输入中安全读取搜索 query 字段
 */
function getInputQuery(input: Record<string, unknown>): string {
  return (input as { query?: string }).query ?? ''
}

/**
 * OCR 工具输入图片 URL 白名单校验（客户端 UI 展示用）
 * 与 server/tools/ocr-document.ts 中 ALLOWED_PROTOCOLS/ALLOWED_DOMAINS 保持同步
 * 实际 SSRF 强制校验（含 DNS 内网 IP 检查）在服务端 validateImageUrl 中执行
 * 此处仅用于决定 <img> 是否渲染：校验失败时显示占位图标，避免渲染不可信图片
 */
const OCR_ALLOWED_PROTOCOLS = ['https:']
const OCR_ALLOWED_DOMAINS = [
  'i.ibb.co',
  'i.imgur.com',
  'cdn.discordapp.com',
  'pbs.twimg.com',
  '*.alicdn.com',
  '*.qpic.cn',
  '*.weixin.qq.com'
]

function matchOcrDomain(hostname: string, entry: string): boolean {
  if (entry.startsWith('*.')) {
    const suffix = entry.slice(1)
    return hostname.endsWith(suffix) && hostname.length > suffix.length
  }
  return hostname === entry
}

function getInputImageUrl(input: Record<string, unknown>): string | null {
  const url = (input as { imageUrl?: string }).imageUrl
  if (typeof url !== 'string' || !url) return null
  try {
    const parsed = new URL(url)
    if (!OCR_ALLOWED_PROTOCOLS.includes(parsed.protocol)) return null
    if (!OCR_ALLOWED_DOMAINS.some((d) => matchOcrDomain(parsed.hostname, d))) return null
    return url
  } catch {
    return null
  }
}

/** OCR 复制按钮状态：复制后切换文案 1.5s 后恢复 */
const copiedOcr = ref(false)
let copyOcrTimer: ReturnType<typeof setTimeout> | null = null

async function copyOcrText(text: string) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copiedOcr.value = true
    if (copyOcrTimer) clearTimeout(copyOcrTimer)
    copyOcrTimer = setTimeout(() => {
      copiedOcr.value = false
    }, 1500)
  } catch {
    // 剪贴板 API 不可用时静默失败（与项目其他复制按钮行为一致）
  }
}

onUnmounted(() => {
  if (copyOcrTimer) clearTimeout(copyOcrTimer)
})
</script>

<template>
  <!-- 天气工具 -->
  <div v-if="invocation.toolName === 'weather'">
    <!-- 加载中状态 -->
    <div
      v-if="isCalling(invocation.state)"
      class="flex items-center gap-2.5 px-3.5 py-2.5 sm:px-4 sm:py-3 bg-semi-primary-light/60 border border-semi-primary/30 rounded-xl text-sm text-semi-primary-active"
    >
      <span class="relative flex h-4 w-4">
        <span
          class="animate-ping absolute inline-flex h-full w-full rounded-full bg-semi-primary opacity-60"
        ></span>
        <span class="relative inline-flex rounded-full h-4 w-4 bg-semi-primary"></span>
      </span>
      <span class="text-xs sm:text-sm">
        正在查询 {{ getInputCity(invocation.input) }} 的天气...
      </span>
    </div>

    <!-- 结果展示 -->
    <div
      v-else-if="invocation.state === 'output-available' && invocation.output"
      class="bg-semi-bg-0 border border-semi-border rounded-xl overflow-hidden shadow-semi-card"
    >
      <template v-if="!(invocation.output as WeatherResult).error">
        <!-- 头部：城市信息 -->
        <div
          class="px-4 py-3 sm:px-5 sm:py-3.5 bg-gradient-to-r from-semi-primary-light to-semi-primary-light border-b border-semi-divider"
        >
          <div class="flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="w-4 h-4 sm:w-5 sm:h-5 text-semi-primary"
            >
              <path
                d="M17.5 19c0-1.7-1.3-3-3-3c-1.1 0-2.1.6-2.6 1.5c-.5-.9-1.5-1.5-2.6-1.5c-1.7 0-3 1.3-3 3"
              />
              <path d="M12 2v2" />
              <path d="M12 8v2" />
              <path d="M5 5l1.5 1.5" />
              <path d="M17.5 6.5L19 5" />
              <circle cx="12" cy="13" r="3" />
            </svg>
            <span class="font-semibold text-sm sm:text-base text-semi-text-0">
              {{ (invocation.output as WeatherResult).city }}
            </span>
            <span
              v-if="(invocation.output as WeatherResult).region"
              class="text-xs sm:text-sm text-semi-text-3"
            >
              {{ (invocation.output as WeatherResult).region }}
            </span>
          </div>
        </div>

        <!-- 当前天气 -->
        <div v-if="(invocation.output as WeatherResult).current" class="px-4 py-3 sm:px-5 sm:py-4">
          <div class="flex items-center gap-4 sm:gap-6">
            <div class="text-3xl sm:text-4xl font-light text-semi-text-0 tracking-tight">
              {{ (invocation.output as WeatherResult).current!.temperature }}
            </div>
            <div class="flex-1 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:text-sm text-semi-text-2">
              <div class="flex items-center gap-1">
                <svg
                  class="w-3 h-3 text-semi-text-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" />
                </svg>
                <span>体感 {{ (invocation.output as WeatherResult).current!.feelsLike }}</span>
              </div>
              <div class="flex items-center gap-1">
                <svg
                  class="w-3 h-3 text-semi-text-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
                </svg>
                <span>湿度 {{ (invocation.output as WeatherResult).current!.humidity }}</span>
              </div>
              <div class="flex items-center gap-1">
                <svg
                  class="w-3 h-3 text-semi-text-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H5.5" />
                  <path d="M9.6 4.6A2 2 0 1 1 11 8H2" />
                  <path d="M12.6 19.4A2 2 0 1 0 14 16H4" />
                </svg>
                <span
                  >{{ (invocation.output as WeatherResult).current!.windDirection }}
                  {{ (invocation.output as WeatherResult).current!.windSpeed }}</span
                >
              </div>
              <div class="flex items-center gap-1">
                <svg
                  class="w-3 h-3 text-semi-text-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2" />
                  <path d="M12 20v2" />
                  <path d="m4.93 4.93 1.41 1.41" />
                  <path d="m17.66 17.66 1.41 1.41" />
                  <path d="M2 12h2" />
                  <path d="M20 12h2" />
                  <path d="m6.34 17.66-1.41 1.41" />
                  <path d="m19.07 4.93-1.41 1.41" />
                </svg>
                <span>{{ (invocation.output as WeatherResult).current!.condition }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 未来预报 -->
        <div
          v-if="(invocation.output as WeatherResult).forecast?.length"
          class="px-4 pb-3 sm:px-5 sm:pb-4"
        >
          <div class="border-t border-semi-divider pt-2.5">
            <div class="flex gap-2 sm:gap-3 overflow-x-auto pb-1">
              <div
                v-for="day in (invocation.output as WeatherResult).forecast"
                :key="day.day"
                class="flex-shrink-0 text-center px-2.5 py-2 sm:px-3 sm:py-2.5 rounded-lg bg-semi-bg-1 min-w-[72px] sm:min-w-[80px]"
              >
                <div class="text-semi-micro sm:text-xs font-medium text-semi-text-3 mb-1">
                  {{ day.day }}
                </div>
                <div class="text-xs sm:text-sm text-semi-text-1 mb-1">{{ day.condition }}</div>
                <div class="text-semi-micro sm:text-xs text-semi-text-3">{{ day.low }}~{{ day.high }}</div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- 错误状态 -->
      <div v-else class="px-4 py-3 text-xs sm:text-sm text-semi-danger bg-semi-danger-light">
        {{ (invocation.output as WeatherResult).error }}
      </div>
    </div>
  </div>

  <!-- 搜索工具 -->
  <div v-else-if="invocation.toolName === 'webSearch'">
    <!-- 加载中状态 -->
    <div
      v-if="isCalling(invocation.state)"
      class="flex items-center gap-2.5 px-3.5 py-2.5 sm:px-4 sm:py-3 bg-semi-primary-light/60 border border-semi-primary/30 rounded-xl text-sm text-semi-primary-active"
    >
      <span class="relative flex h-4 w-4">
        <span
          class="animate-ping absolute inline-flex h-full w-full rounded-full bg-semi-primary opacity-60"
        ></span>
        <span class="relative inline-flex rounded-full h-4 w-4 bg-semi-primary"></span>
      </span>
      <span class="text-xs sm:text-sm"> 正在搜索: {{ getInputQuery(invocation.input) }}... </span>
    </div>

    <!-- 结果展示 -->
    <div
      v-else-if="invocation.state === 'output-available' && invocation.output"
      class="bg-semi-bg-0 border border-semi-border rounded-xl overflow-hidden shadow-semi-card"
    >
      <template v-if="!(invocation.output as SearchResult).error">
        <!-- 头部：搜索摘要 -->
        <div
          class="px-4 py-2.5 sm:px-5 sm:py-3 bg-gradient-to-r from-semi-primary-light to-semi-primary-light border-b border-semi-divider"
        >
          <div class="flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="w-4 h-4 sm:w-5 sm:h-5 text-semi-primary"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <span class="font-medium text-sm sm:text-base text-semi-text-0"> 搜索结果 </span>
            <span class="text-xs text-semi-text-3">
              {{ (invocation.output as SearchResult).query }}
            </span>
          </div>
        </div>

        <!-- 结果列表 -->
        <div class="px-3 py-2 sm:px-4 sm:py-3 space-y-2">
          <div
            v-for="item in (invocation.output as SearchResult).results?.slice(0, 4)"
            :key="item.index"
            class="group flex items-start gap-2.5 sm:gap-3 p-2.5 sm:p-3 rounded-lg hover:bg-semi-bg-1 transition-colors duration-semi-fast"
          >
            <!-- 网站图标 -->
            <img
              v-if="getFavicon(item.url)"
              :src="getFavicon(item.url)"
              :alt="getDomain(item.url)"
              class="w-4 h-4 sm:w-5 sm:h-5 mt-0.5 rounded-sm flex-shrink-0 opacity-80 group-hover:opacity-100 transition-opacity"
              loading="lazy"
              @error="($event.target as HTMLImageElement).style.display = 'none'"
            />

            <div class="flex-1 min-w-0">
              <!-- 标题链接 -->
              <a
                :href="item.url"
                target="_blank"
                rel="noopener noreferrer"
                class="text-xs sm:text-sm font-medium text-semi-primary hover:text-semi-primary-active transition-colors line-clamp-1"
              >
                {{ item.title }}
              </a>
              <!-- 来源域名 -->
              <div class="text-semi-micro sm:text-xs text-semi-text-3 mt-0.5">
                {{ getDomain(item.url) }}
              </div>
              <!-- 摘要 -->
              <p class="text-xs text-semi-text-3 mt-1 line-clamp-2 leading-relaxed">
                {{ item.snippet }}
              </p>
            </div>
          </div>
        </div>
      </template>

      <!-- 错误状态 -->
      <div v-else class="px-4 py-3 text-xs sm:text-sm text-semi-danger bg-semi-danger-light">
        {{ (invocation.output as SearchResult).error }}
      </div>
    </div>
  </div>

  <!-- OCR 工具：提取图片文字 -->
  <div v-else-if="invocation.toolName === 'extractTextFromImage'">
    <!-- 加载中状态 -->
    <div
      v-if="isCalling(invocation.state)"
      class="flex items-center gap-2.5 px-3.5 py-2.5 sm:px-4 sm:py-3 bg-semi-primary-light/60 border border-semi-primary/30 rounded-xl text-sm text-semi-primary-active"
    >
      <span class="relative flex h-4 w-4">
        <span
          class="animate-ping absolute inline-flex h-full w-full rounded-full bg-semi-primary opacity-60"
        ></span>
        <span class="relative inline-flex rounded-full h-4 w-4 bg-semi-primary"></span>
      </span>
      <span class="text-xs sm:text-sm">正在识别图片中的文字...</span>
    </div>

    <!-- 结果展示 -->
    <div
      v-else-if="invocation.state === 'output-available' && invocation.output"
      class="bg-semi-bg-0 border border-semi-border rounded-xl overflow-hidden shadow-semi-card"
    >
      <template v-if="!(invocation.output as OcrResult).error">
        <!-- 头部：OCR 标签 + 复制按钮 -->
        <div
          class="px-4 py-2.5 sm:px-5 sm:py-3 bg-gradient-to-r from-semi-primary-light to-semi-primary-light border-b border-semi-divider"
        >
          <div class="flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="w-4 h-4 sm:w-5 sm:h-5 text-semi-primary"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="9" y1="13" x2="15" y2="13" />
              <line x1="9" y1="17" x2="13" y2="17" />
            </svg>
            <span class="font-medium text-sm sm:text-base text-semi-text-0">OCR 识别完成</span>
            <button
              type="button"
              class="ml-auto flex items-center gap-1 px-2 py-1 rounded-md hover:bg-semi-bg-1 active:scale-95 transition-all duration-semi-fast text-xs text-semi-text-3 hover:text-semi-text-1"
              @click="
                copyOcrText((invocation.output as OcrResult).text || (invocation.output as OcrResult).error || '')
              "
            >
              <svg
                class="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>{{ copiedOcr ? '已复制' : '复制' }}</span>
            </button>
          </div>
        </div>

        <!-- 内容区：图片缩略图 + 文字预览 -->
        <div class="px-4 py-3 sm:px-5 sm:py-3.5 flex gap-3">
          <!-- 图片缩略图（仅在 URL 通过白名单时渲染） -->
          <img
            v-if="getInputImageUrl(invocation.input)"
            :src="getInputImageUrl(invocation.input)!"
            alt="OCR 输入图片"
            class="w-12 h-12 sm:w-14 sm:h-14 object-cover rounded-md border border-semi-border flex-shrink-0"
            loading="lazy"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          />
          <!-- 占位图标：URL 校验失败或图片加载失败时显示 -->
          <div
            v-else
            class="w-12 h-12 sm:w-14 sm:h-14 rounded-md border border-semi-border bg-semi-bg-1 flex items-center justify-center flex-shrink-0 text-semi-text-3"
          >
            <svg
              class="w-6 h-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            </svg>
          </div>

          <!-- 文字预览：前 200 字符 -->
          <div class="flex-1 min-w-0">
            <p
              v-if="(invocation.output as OcrResult).text"
              class="text-xs sm:text-sm text-semi-text-1 line-clamp-4 leading-relaxed whitespace-pre-wrap break-all"
            >
              {{ (invocation.output as OcrResult).text!.slice(0, 200) }}<span
                v-if="(invocation.output as OcrResult).text!.length > 200"
                class="text-semi-text-3"
                >...</span
              >
            </p>
            <p v-else class="text-xs sm:text-sm text-semi-text-3 italic">未识别到文字</p>
          </div>
        </div>
      </template>

      <!-- 错误状态 -->
      <div v-else class="px-4 py-3 bg-semi-danger-light">
        <div class="flex items-center gap-2 mb-1">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="w-4 h-4 text-semi-danger shrink-0"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span class="text-xs sm:text-sm text-semi-danger font-medium">
            {{ (invocation.output as OcrResult).error }}
          </span>
        </div>
        <p v-if="(invocation.output as OcrResult).detail" class="text-semi-micro text-semi-text-3 ml-6">
          {{ (invocation.output as OcrResult).detail }}
        </p>
      </div>
    </div>
  </div>
</template>
