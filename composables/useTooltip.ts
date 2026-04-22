import type { Directive, DirectiveBinding } from 'vue'

type TooltipPosition = 'top' | 'bottom'

function setTooltipAttrs(el: HTMLElement, value: string, position?: TooltipPosition) {
  el.setAttribute('data-tooltip', value)
  if (position && position !== 'top') {
    el.setAttribute('data-tooltip-position', position)
  } else {
    el.removeAttribute('data-tooltip-position')
  }
}

function removeTooltipAttrs(el: HTMLElement) {
  el.removeAttribute('data-tooltip')
  el.removeAttribute('data-tooltip-position')
}

export const tooltipDirective: Directive<HTMLElement, string> = {
  mounted(el, binding: DirectiveBinding<string>) {
    if (binding.value) {
      setTooltipAttrs(el, binding.value, binding.arg as TooltipPosition)
    }
  },
  updated(el, binding: DirectiveBinding<string>) {
    if (binding.value) {
      setTooltipAttrs(el, binding.value, binding.arg as TooltipPosition)
    } else {
      removeTooltipAttrs(el)
    }
  },
  unmounted(el) {
    removeTooltipAttrs(el)
  },
  getSSRProps(binding: DirectiveBinding<string>) {
    const props: Record<string, string> = {}
    if (binding.value) {
      props['data-tooltip'] = binding.value
      if (binding.arg && binding.arg !== 'top') {
        props['data-tooltip-position'] = binding.arg
      }
    }
    return props
  }
}

export function useTooltip() {
  return { vTooltip: tooltipDirective }
}
