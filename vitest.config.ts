import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import AutoImport from 'unplugin-auto-import/vite'

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      imports: ['vue']
    })
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    // 只收 vitest 自己的三个目录：tests/e2e 下既有 *.spec.ts 也有 *.e2e.test.ts，
    // 会被通配 include 误收，导致 `pnpm test` / `test:coverage` 恒定 9 个文件失败（它们只能由 Playwright 跑）
    include: ['tests/{unit,component,api}/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // 只统计真实源码：默认 all:true 会把 *.d.ts、生成的 auto-imports 声明等也算进分母
      include: [
        'server/**/*.{ts,vue}',
        'pages/**/*.vue',
        'components/**/*.{vue,ts}',
        'composables/**/*.ts',
        'utils/**/*.ts'
      ],
      // 项目根下有 533MB 的 node_modules.bak（已 gitignore），v8 provider 扫描
      // "未被测试文件"时会走进去并因残留文件报 ENOENT 中断整次覆盖率统计
      exclude: ['node_modules.bak/**', '**/node_modules/**', 'dist/**', '.nuxt/**', '.output/**'],
      thresholds: {
        lines: 70,
        functions: 65,
        branches: 60
      }
    },
    setupFiles: ['./tests/setup.ts']
  },
  resolve: {
    alias: {
      '~': resolve(__dirname, '.'),
      '@': resolve(__dirname, '.')
    }
  }
})
