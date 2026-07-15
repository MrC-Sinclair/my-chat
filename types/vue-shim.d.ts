/**
 * Vue 单文件组件类型声明 shim
 *
 * Nuxt 3.21.2 自动生成的 .nuxt/types/vue-shim.d.ts 为空文件，
 * 导致 IDE 的 TS LSP 处理 .ts 文件中的 `import X from '~/xxx.vue'` 时
 * 报 ts(2307) 找不到模块。此处补充 `*.vue` 模块声明。
 * 命令行 `pnpm typecheck` 使用 vue-tsc 内置识别 .vue，不受影响。
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
