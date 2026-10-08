import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateId } from '~/utils/uuid'
import { copyToClipboard } from '~/utils/clipboard'

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('generateId', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('安全上下文下应直接使用原生 crypto.randomUUID', () => {
    const spy = vi.fn(() => 'native-id')
    vi.stubGlobal('crypto', { randomUUID: spy, getRandomValues: vi.fn() })
    expect(generateId()).toBe('native-id')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('crypto.randomUUID 缺失时（http 直连）应用 getRandomValues 兜底生成 v4 UUID', () => {
    const bytes = new Uint8Array(Array.from({ length: 16 }, (_, i) => i * 16))
    const getRandomValues = vi.fn((arr: Uint8Array) => {
      arr.set(bytes)
      return arr
    })
    vi.stubGlobal('crypto', { getRandomValues })

    const id = generateId()

    expect(getRandomValues).toHaveBeenCalledTimes(1)
    expect(id).toMatch(UUID_V4_REGEX)
  })

  it('兜底生成的 id 应每次不同', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256)
        return arr
      }
    })
    expect(generateId()).not.toBe(generateId())
  })
})

describe('copyToClipboard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete (document as unknown as { execCommand?: unknown }).execCommand
  })

  // jsdom 未实现 document.execCommand，手动注入可断言的替身
  function stubExecCommand(result: boolean) {
    const fn = vi.fn(() => result)
    ;(document as unknown as { execCommand: unknown }).execCommand = fn
    return fn
  }

  it('navigator.clipboard 可用时应走异步 Clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await expect(copyToClipboard('hello')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('http 直连（无 navigator.clipboard）时应退到 execCommand', async () => {
    vi.stubGlobal('navigator', {})
    const execCommand = stubExecCommand(true)

    await expect(copyToClipboard('fallback text')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')

    const leftovers = [...document.querySelectorAll('textarea')]
    expect(leftovers).toHaveLength(0)
  })

  it('execCommand 返回 false 时返回 false', async () => {
    vi.stubGlobal('navigator', {})
    stubExecCommand(false)
    await expect(copyToClipboard('x')).resolves.toBe(false)
  })

  it('Clipboard API 抛错时不中断，继续尝试 execCommand', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }
    })
    const execCommand = stubExecCommand(true)

    await expect(copyToClipboard('x')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('execCommand 抛异常时返回 false 且不遗留 textarea', async () => {
    vi.stubGlobal('navigator', {})
    const execCommand = vi.fn(() => {
      throw new Error('execCommand unsupported')
    })
    ;(document as unknown as { execCommand: unknown }).execCommand = execCommand

    await expect(copyToClipboard('x')).resolves.toBe(false)
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })

  it('空文本直接返回 false，不触碰剪贴板', async () => {
    const writeText = vi.fn()
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await expect(copyToClipboard('')).resolves.toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })
})
