import { config } from '@vue/test-utils'

config.global.stubs = {
  NuxtLink: { template: '<a><slot /></a>' },
  NuxtLayout: { template: '<div><slot /></div>' },
  NuxtPage: { template: '<div />' }
}
