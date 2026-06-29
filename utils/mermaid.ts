import type { MermaidConfig } from 'mermaid'

let mermaidInstance: any = null
let mermaidInitialized = false

const mermaidConfig: MermaidConfig = {
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'strict'
}

async function getMermaid() {
  if (mermaidInstance) return mermaidInstance

  mermaidInstance = (await import('mermaid')).default

  if (!mermaidInitialized) {
    mermaidInstance.initialize(mermaidConfig)
    mermaidInitialized = true
  }

  return mermaidInstance
}

let renderCounter = 0

export async function renderMermaidDiagram(source: string, container: HTMLElement): Promise<void> {
  if (!import.meta.client) return

  const mermaid = await getMermaid()
  const id = `mermaid-diagram-${renderCounter++}`

  if (!document.contains(container)) return

  try {
    const { svg } = await mermaid.render(id, source)

    if (!document.contains(container)) return

    container.innerHTML = svg
  } catch (err: any) {
    const errorEl = document.getElementById(id)
    if (errorEl) errorEl.remove()
    throw err
  }
}
