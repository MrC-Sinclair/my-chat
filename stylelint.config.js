/** @type {import('stylelint').Config} */
export default {
  // 继承：标准规则 + Vue <style> 块支持 + Tailwind 兼容 + 属性排序
  extends: [
    'stylelint-config-standard',
    'stylelint-config-recommended-vue',
    'stylelint-config-tailwindcss',
    'stylelint-config-recess-order'
  ],
  rules: {
    // ── 与项目现状对齐的放宽规则 ───────────────────────────
    // 项目中大量使用 Tailwind 的 @apply 和 @tailwind 指令
    'at-rule-no-unknown': [
      true,
      {
        ignoreAtRules: ['tailwind', 'apply', 'layer', 'config', 'screen']
      }
    ],
    // 允许伪元素/类使用嵌套写法（如 SCSS 风格），与 Vue 现有 style 块一致
    'selector-pseudo-element-no-unknown': null,
    // 项目中颜色使用十六进制和 rgba 混合，不强制转换
    'color-function-notation': null,
    // 不强制 alpha 通道的简写
    'alpha-value-notation': null,
    // 允许浏览器前缀的属性（兼容老 WebView）
    'property-no-vendor-prefix': null,
    'value-no-vendor-prefix': null,
    // 允许 ID 选择器（部分场景需要）
    'selector-max-id': null,
    // 允许使用 !important（tooltip/z-index 场景需要）
    'declaration-no-important': null,
    // 允许使用 // 单行注释（PostCSS 插件支持）
    'no-descending-specificity': null,
    // keyframes 选择器使用百分比，不强制 from/to
    'keyframes-name-pattern': null,
    // 允许空规则前的注释
    'comment-empty-line-before': null,
    // 允许长属性值（box-shadow、transition 等）
    'declaration-block-no-redundant-longhand-properties': null,
    // 不强制把 word-wrap 替换为 overflow-wrap（旧 WebView 兼容需要双写）
    'declaration-property-value-disallowed-list': null,
    // 允许 Tailwind theme() 函数作为属性值（stylelint 默认不识别）
    // 项目中 tooltip.css / MarkdownRenderer.vue / MermaidBlock.vue 大量使用
    // theme('colors.semi.*') 引用 tailwind.config.js 的 Token
    'declaration-property-value-no-unknown': null,
    // 允许 rgba() 写法（不强制改为现代 rgb() 4 通道语法），兼容旧 WebView
    'color-function-alias-notation': null,
    // 允许使用非标准属性别名 word-wrap（旧 WebView fallback）
    'property-no-unknown': [
      true,
      { ignoreProperties: ['word-wrap'] }
    ],
    // 允许使用废弃属性（word-wrap 作为 fallback 必须保留）
    'property-no-deprecated': null,
    // ── 严格规则：捕获真实 bug ─────────────────────────────
    // 禁止重复声明（捕获意外的同名属性覆盖）
    'declaration-block-no-duplicate-properties': true,
    // 禁止重复的自定义属性
    'declaration-block-no-duplicate-custom-properties': true,
    // 禁止无效的 URL
    'no-invalid-position-at-import-rule': true,
    // 禁止空块
    'no-empty-source': true,
    // 禁止重复的选择器
    'no-duplicate-selectors': true,
    // 字体族必须有通用字体兜底
    'font-family-no-missing-generic-family-keyword': true,
    // 禁止单位错误（如 10px / 0deg）
    'unit-no-unknown': true
  },
  overrides: [
    {
      // .vue 文件由 postcss-html 处理（stylelint-config-recommended-vue 自带）
      files: ['**/*.vue'],
      customSyntax: 'postcss-html'
    }
  ]
}
