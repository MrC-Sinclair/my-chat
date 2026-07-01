/**
 * Tailwind 配置文件
 *
 * 设计语言：Semi Design 默认主题（抖音前端团队）
 * 仅扩展不覆盖 Tailwind 默认值，所有 Semi Token 均加 `semi-` 前缀命名空间，
 * 避免与 Tailwind 默认色板/间距/圆角冲突，可随时与 Tailwind 原生工具类混用。
 *
 * 命名约定（与 Semi 官方 CSS variable 一一对应，便于查阅文档）：
 *   颜色：colors.semi.<分组>.<级别>     →  text-semi-text-0 / bg-semi-bg-1 / border-semi-border
 *   间距：spacing.semi-<级别>            →  p-semi-md / m-semi-lg
 *   圆角：borderRadius.semi-<级别>       →  rounded-semi-md
 *   字号：fontSize.semi-<语义>           →  text-semi-body
 *   阴影：boxShadow.semi-<语义>          →  shadow-semi-card
 *
 * 参考来源：https://semi.design/zh-CN/start/introduction
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './components/**/*.{js,vue,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './plugins/**/*.{js,ts}',
    './app.vue',
    './error.vue'
  ],
  theme: {
    extend: {
      /**
       * 颜色 - 来自 Semi Design 默认主题
       * 命名与 Semi CSS variable 对齐，例如 --semi-color-primary → colors.semi.primary.DEFAULT
       */
      colors: {
        semi: {
          // 主色（Brand / Primary）— 链接、主按钮、聚焦态
          primary: {
            DEFAULT: '#0064FA', // 等价 --semi-color-primary
            hover: '#3D6DFA', //   等价 --semi-color-primary-hover
            active: '#0050D9', //   等价 --semi-color-primary-active
            light: '#E5F3FF' //    等价 --semi-color-primary-light-default（选中行背景等）
          },
          // 状态色
          success: {
            DEFAULT: '#00A870',
            light: '#E6F6EE'
          },
          warning: {
            DEFAULT: '#FF7D00',
            light: '#FFF1DE'
          },
          danger: {
            DEFAULT: '#F93920',
            light: '#FDE6E2'
          },
          info: {
            DEFAULT: '#0064FA',
            light: '#E5F3FF'
          },
          // 中性文本（0 主文本 → 3 弱化文本）
          text: {
            0: '#1C1F23',
            1: '#2C2E33',
            2: '#41454D',
            3: '#6B6F76'
          },
          // 背景（0 主背景 → 3 较深背景）
          bg: {
            0: '#FFFFFF',
            1: '#F8F8F8',
            2: '#F2F2F2',
            3: '#E5E5E5'
          },
          // 填充色（按钮 hover 背景、菜单项 hover 等）
          fill: {
            0: '#F9F9F9',
            1: '#F2F2F2',
            2: '#E5E5E5'
          },
          // 边框 / 分割线
          border: '#D9D9D9',
          divider: '#E9E9E9',
          // 焦点描边
          focus: '#0064FA',
          // Tooltip 浮层（深色背景 + 浅色文字）
          tooltip: {
            bg: '#1F2937',
            text: '#F9FAFB'
          },
          // 代码块暗色主题色板（独立于浅色中性色体系）
          code: {
            dark: {
              bg: '#1E1E1E', //     代码块主背景
              surface: '#1F2937', // 代码块顶栏背景
              border: '#374151', //  代码块分割线
              text: '#9CA3AF', //     行号/弱化文本
              'text-strong': '#F9FAFB', // 高亮文本
              'success': '#34D399' //  复制成功图标
            },
            // 行内代码（项目规范：柔和紫色，禁止刺眼红色，AGENTS.md 明确要求）
            inline: '#7C3aed',
            // 行内代码浅紫背景
            'inline-bg': '#F3F4F6'
          }
        }
      },
      /**
       * 间距 - Semi 基于 4px 栅格的间距体系
       * 使用 sm/md/lg 与 Tailwind 默认 spacing 并行存在，互不覆盖
       */
      spacing: {
        'semi-xs': '4px', //   xx-small
        'semi-sm': '8px', //   x-small
        'semi-md': '12px', //  small
        'semi-base': '16px', // medium
        'semi-lg': '20px', //  large
        'semi-xl': '24px', //  x-large
        'semi-2xl': '32px', // xx-large
        'semi-3xl': '40px' //  xxx-large
      },
      /**
       * 圆角 - Semi 各组件圆角约定
       *  - small(3px)：按钮、Tag
       *  - medium(4px)：输入框、Select、Switch
       *  - large(8px)：Card、Modal 头部
       *  - extra-large(12px)：Modal、Drawer
       */
      borderRadius: {
        'semi-sm': '3px',
        'semi-md': '4px',
        'semi-lg': '8px',
        'semi-xl': '12px'
      },
      /**
       * 字号 - Semi 排版系统
       * 每项为 [字号, { lineHeight, 字重 }]，与 Semi 默认行高保持一致
       */
      fontSize: {
        // micro: 10px，用于天气小字、thinking 折叠状态等紧凑场景
        'semi-micro': ['10px', { lineHeight: '14px' }],
        // micro-md: 11px，用于输入框字数计数等
        'semi-micro-md': ['11px', { lineHeight: '16px' }],
        'semi-caption': ['12px', { lineHeight: '20px' }],
        'semi-body': ['14px', { lineHeight: '20px' }],
        'semi-body-lg': ['16px', { lineHeight: '22px' }],
        'semi-h5': ['16px', { lineHeight: '22px', fontWeight: '600' }],
        'semi-h4': ['18px', { lineHeight: '24px', fontWeight: '600' }],
        'semi-h3': ['20px', { lineHeight: '24px', fontWeight: '600' }],
        'semi-h2': ['24px', { lineHeight: '32px', fontWeight: '600' }],
        'semi-h1': ['28px', { lineHeight: '36px', fontWeight: '600' }]
      },
      /**
       * 阴影 - Semi 组件层级表达
       */
      boxShadow: {
        'semi-elevated': '0 0 0 1px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.08)',
        'semi-card': '0 0 0 1px rgba(0,0,0,0.04)',
        'semi-tooltip': '0 2px 8px rgba(0,0,0,0.12)',
        'semi-popover': '0 2px 12px rgba(0,0,0,0.12)'
      },
      /**
       * 字体族 - Semi 默认中英文混排字体栈
       */
      fontFamily: {
        semi: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Helvetica Neue"',
          'Helvetica',
          'Arial',
          'sans-serif'
        ]
      }
    }
  },
  plugins: []
}
