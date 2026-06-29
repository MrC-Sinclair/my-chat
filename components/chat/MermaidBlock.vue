<script setup lang="ts">
import { hljs } from '~/utils/highlight'
import { renderMermaidDiagram } from '~/utils/mermaid'

const props = defineProps<{
  source: string
}>()

const containerRef = ref<HTMLElement | null>(null)
const hasError = ref(false)
const isRendering = ref(true)
const isMounted = ref(true)
const activeTab = ref<'chart' | 'code'>('chart')
const copied = ref(false)

const highlightedCode = computed(() => {
  try {
    return hljs.highlight(props.source, { language: 'yaml' }).value
  } catch {
    return hljs.highlightAuto(props.source).value
  }
})

onMounted(async () => {
  await nextTick()

  if (!isMounted.value || !containerRef.value) return

  try {
    await renderMermaidDiagram(props.source, containerRef.value)
    if (isMounted.value) isRendering.value = false
  } catch (err) {
    if (!isMounted.value) return
    console.error('Mermaid 渲染失败:', err)
    hasError.value = true
    isRendering.value = false
  }
})

onUnmounted(() => {
  isMounted.value = false
})

async function handleCopy() {
  try {
    await navigator.clipboard.writeText(props.source)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch (err) {
    console.error('复制失败:', err)
  }
}
</script>

<template>
  <div class="mermaid-block-wrapper">
    <div class="mermaid-header">
      <div class="mermaid-header-left">
        <svg
          class="mermaid-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </svg>
        <span class="mermaid-label">Mermaid</span>
      </div>
      <div class="mermaid-tabs">
        <button
          class="mermaid-tab"
          :class="{ active: activeTab === 'chart' }"
          @click="activeTab = 'chart'"
        >
          <svg
            class="tab-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18" />
            <path d="M9 21V9" />
          </svg>
          图表
        </button>
        <button
          class="mermaid-tab"
          :class="{ active: activeTab === 'code' }"
          @click="activeTab = 'code'"
        >
          <svg
            class="tab-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          代码
        </button>
      </div>
      <button
        v-show="activeTab === 'code'"
        class="mermaid-copy-btn"
        v-tooltip="copied ? '已复制' : '复制代码'"
        @click="handleCopy"
      >
        <svg v-if="!copied" class="tab-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
        <svg
          v-else
          class="tab-icon text-green-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M5 13l4 4L19 7"
          />
        </svg>
      </button>
    </div>

    <div v-show="activeTab === 'chart'" class="mermaid-chart-panel">
      <div v-if="hasError" class="mermaid-error">
        <p>流程图渲染失败</p>
        <pre class="mermaid-fallback"><code>{{ source }}</code></pre>
      </div>
      <div v-else class="mermaid-content">
        <div v-if="isRendering" class="mermaid-loading-overlay">
          <svg class="mermaid-spinner" viewBox="0 0 24 24" fill="none">
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="3"
              stroke-dasharray="31.4 31.4"
              stroke-linecap="round"
            />
          </svg>
          <span>渲染中…</span>
        </div>
        <div ref="containerRef" />
      </div>
    </div>

    <div v-show="activeTab === 'code'" class="mermaid-code-panel">
      <pre class="mermaid-code-pre"><code
        class="text-sm font-mono leading-relaxed language-mermaid"
        v-html="highlightedCode"
      /></pre>
    </div>
  </div>
</template>

<style scoped>
@import 'highlight.js/styles/github-dark.css';

.mermaid-block-wrapper {
  margin: 1em 0;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.mermaid-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  font-size: 0.75rem;
  color: #6b7280;
}

.mermaid-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-right: auto;
}

.mermaid-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.mermaid-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.mermaid-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  background: #e5e7eb;
  border-radius: 6px;
  padding: 2px;
}

.mermaid-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 0.7rem;
  color: #6b7280;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  font-family: inherit;
  line-height: 1.4;
}

.mermaid-tab:hover {
  color: #374151;
  background: rgba(255, 255, 255, 0.5);
}

.mermaid-tab.active {
  color: #111827;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.tab-icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}

.mermaid-copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mermaid-copy-btn:hover {
  color: #374151;
  background: rgba(0, 0, 0, 0.05);
}

.mermaid-copy-btn:active {
  transform: scale(0.95);
}

.mermaid-chart-panel {
  position: relative;
}

.mermaid-content {
  padding: 16px;
  display: flex;
  justify-content: center;
  overflow-x: auto;
}

.mermaid-content :deep(svg) {
  max-width: 100%;
  height: auto;
}

.mermaid-loading-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px;
  color: #9ca3af;
  font-size: 0.8rem;
}

.mermaid-spinner {
  width: 24px;
  height: 24px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.mermaid-code-panel {
  background: #1e1e1e;
}

.mermaid-code-pre {
  margin: 0;
  padding: 16px;
  overflow-x: auto;
}

.mermaid-error {
  padding: 12px 16px;
  color: #b91c1c;
  font-size: 0.85em;
}

.mermaid-error p {
  margin: 0 0 8px 0;
  font-weight: 500;
}

.mermaid-fallback {
  background: #f3f4f6;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 0.85em;
  margin: 0;
}
</style>
