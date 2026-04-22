import { tooltipDirective } from '~/composables/useTooltip'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('tooltip', tooltipDirective)
})
