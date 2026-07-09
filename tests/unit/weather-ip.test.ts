/**
 * IP 定位工具单元测试（server/tools/weather.ts → getCityByIp）
 *
 * 测试覆盖：
 * - isValidIp 格式校验（IPv4/IPv6 合法格式 + 非法格式 + 注入字符）
 * - isPrivateIp 内网/保留地址判断（覆盖所有黑名单网段）
 * - getCityByIp 核心函数（mock fetch）：
 *   * 公网 IP 成功路径（中文/英文返回）
 *   * 本地/内网 IP 短路不发 fetch
 *   * 云元数据 IP 拦截
 *   * 非法 IP 格式拦截
 *   * 特殊字符注入拦截
 *   * URL 参数 encodeURIComponent 编码
 *   * ip-api.com 非 200 降级
 *   * ip-api.com status:fail 降级
 *   * fetch 超时降级（AbortController）
 *   * 网络错误降级
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isValidIp,
  isPrivateIp,
  getCityByIp
} from '~/server/tools/weather'

// ============================================================
// Mock fetch 全局，避免发起真实 HTTP 请求
// ============================================================

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  fetchMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

// ============================================================
// isValidIp 测试
// ============================================================

describe('isValidIp', () => {
  describe('IPv4 合法格式', () => {
    it.each([
      ['8.8.8.8'],
      ['1.1.1.1'],
      ['119.29.29.29'],
      ['0.0.0.0'], // 虽然是保留地址，但格式合法
      ['255.255.255.255'],
      ['192.168.1.1']
    ])('应接受合法 IPv4: %s', (ip) => {
      expect(isValidIp(ip)).toBe(true)
    })
  })

  describe('IPv6 合法格式', () => {
    it.each([
      ['::1'],
      ['2001:db8::1'],
      ['fe80::1'],
      ['fc00::1'],
      ['fd12:3456:789a::1']
    ])('应接受合法 IPv6: %s', (ip) => {
      expect(isValidIp(ip)).toBe(true)
    })
  })

  describe('非法格式', () => {
    it.each([
      ['not-an-ip'],
      ['999.999.999.999'], // 段超过 255
      ['1.2.3'], // 段不足
      ['1.2.3.4.5'], // 段过多
      [''], // 空字符串
      ['256.1.1.1'], // 段超过 255
      ['1.2.3.300'] // 段超过 255
    ])('应拒绝非法 IP: %s', (ip) => {
      expect(isValidIp(ip)).toBe(false)
    })
  })

  describe('特殊字符注入拦截', () => {
    it.each([
      ['127.0.0.1\r\n'], // CRLF 注入
      ['127.0.0.1\n'],
      ['127.0.0.1@evil.com'], // @ 字符
      ['127.0.0.1/path'], // 路径分隔符
      ['127.0.0.1:8080'], // IPv4 不应含端口
      ['<script>alert(1)</script>']
    ])('应拒绝含特殊字符的注入字符串: %s', (ip) => {
      expect(isValidIp(ip)).toBe(false)
    })
  })

  it('非字符串类型应返回 false', () => {
    expect(isValidIp(null as unknown as string)).toBe(false)
    expect(isValidIp(undefined as unknown as string)).toBe(false)
    expect(isValidIp(123 as unknown as string)).toBe(false)
  })

  it('超长字符串应返回 false', () => {
    expect(isValidIp('1.1.1.1'.padEnd(50, '0'))).toBe(false)
  })
})

// ============================================================
// isPrivateIp 测试
// ============================================================

describe('isPrivateIp', () => {
  describe('IPv4 内网/保留地址', () => {
    it.each([
      ['127.0.0.1'], // loopback
      ['127.1.2.3'],
      ['10.0.0.1'], // RFC1918
      ['10.255.255.255'],
      ['192.168.1.1'], // RFC1918
      ['192.168.0.0'],
      ['172.16.0.1'], // RFC1918
      ['172.31.255.255'],
      ['169.254.169.254'], // link-local，含云元数据
      ['169.254.0.1'],
      ['0.0.0.0'] // 未指定地址
    ])('应识别为内网: %s', (ip) => {
      expect(isPrivateIp(ip)).toBe(true)
    })
  })

  describe('IPv6 内网/保留地址', () => {
    it.each([
      ['::1'], // loopback
      ['fe80::1'], // link-local
      ['fc00::1'], // ULA
      ['fd12:3456:789a::1'] // ULA（fd00::/8 范围内）
    ])('应识别为内网: %s', (ip) => {
      expect(isPrivateIp(ip)).toBe(true)
    })
  })

  describe('公网 IP 不应识别为内网', () => {
    it.each([
      ['8.8.8.8'],
      ['1.1.1.1'],
      ['119.29.29.29'],
      ['172.32.0.1'], // 172.32 不在 172.16/12 范围
      ['172.15.0.1'], // 172.15 不在范围
      ['2001:4860:4860::8888'] // Google DNS IPv6
    ])('应识别为公网: %s', (ip) => {
      expect(isPrivateIp(ip)).toBe(false)
    })
  })
})

// ============================================================
// getCityByIp 测试
// ============================================================

describe('getCityByIp', () => {
  describe('公网 IP 成功路径', () => {
    it('应正确解析中文城市返回', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          city: '深圳',
          regionName: '广东',
          country: '中国',
          lat: 22.54,
          lon: 114.06
        })
      })

      const result = await getCityByIp('119.29.29.29')

      expect(result.city).toBe('深圳')
      expect(result.region).toBe('广东')
      expect(result.country).toBe('中国')
      expect(result.lat).toBe(22.54)
      expect(result.lon).toBe(114.06)
      expect(result.isLocal).toBe(false)
      expect(result.error).toBeNull()

      // 验证 fetch 被调用 exactly 1 次
      expect(fetchMock).toHaveBeenCalledTimes(1)
      // 验证 URL 包含 lang=zh 参数
      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('lang=zh')
      expect(calledUrl).toContain('119.29.29.29')
    })

    it('英文城市 IP 应返回中文 country（因 lang=zh）', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          city: 'Mountain View',
          regionName: 'California',
          country: '美国', // 因 lang=zh，country 字段为中文
          lat: 37.386,
          lon: -122.0838
        })
      })

      const result = await getCityByIp('8.8.8.8')

      expect(result.city).toBe('Mountain View')
      expect(result.region).toBe('California')
      expect(result.country).toBe('美国')
      expect(result.isLocal).toBe(false)
      expect(result.error).toBeNull()
    })

    it('应使用 encodeURIComponent 编码 IP 参数', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'success', city: 'Test' })
      })

      await getCityByIp('119.29.29.29')

      const calledUrl = fetchMock.mock.calls[0][0] as string
      // URL 中应包含编码后的 IP（119.29.29.29 不含特殊字符，编码后与原值相同）
      expect(calledUrl).toContain('/119.29.29.29?')
    })
  })

  describe('本地/内网 IP 短路不发请求', () => {
    it.each([
      ['127.0.0.1'],
      ['::1'],
      ['192.168.1.1'],
      ['10.0.0.1'],
      ['172.16.0.1'],
      ['169.254.169.254'], // 云元数据
      ['172.31.255.255'],
      ['10.255.255.255']
    ])('IP %s 应返回 isLocal=true 且不发起 fetch', async (ip) => {
      const result = await getCityByIp(ip)

      expect(result.city).toBeNull()
      expect(result.isLocal).toBe(true)
      expect(result.error).toBe('本地/内网 IP，无法定位')
      // 验证 fetch 未被调用
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('非法 IP 格式拦截', () => {
    it.each([
      ['not-an-ip'],
      ['999.999.999.999'],
      ['1.2.3'],
      ['256.1.1.1']
    ])('IP %s 应返回格式错误且不发起 fetch', async (ip) => {
      const result = await getCityByIp(ip)

      expect(result.city).toBeNull()
      expect(result.isLocal).toBe(false)
      expect(result.error).toBe('IP 格式不合法')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('特殊字符注入拦截', () => {
    it.each([
      ['127.0.0.1\r\n'],
      ['127.0.0.1@evil.com'],
      ['127.0.0.1/path'],
      ['<script>alert(1)</script>']
    ])('注入字符串 %s 应被格式校验拦截', async (ip) => {
      const result = await getCityByIp(ip)

      expect(result.city).toBeNull()
      expect(result.isLocal).toBe(false)
      expect(result.error).toBe('IP 格式不合法')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('ip-api.com 失败降级', () => {
    it('HTTP 非 200 状态应降级返回错误对象', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({})
      })

      const result = await getCityByIp('8.8.8.8')

      expect(result.city).toBeNull()
      expect(result.isLocal).toBe(false)
      expect(result.error).toContain('暂时不可用')
      expect(result.error).toContain('500')
      // 不应抛出异常
      expect(result).toBeDefined()
    })

    it('返回 status:fail 应降级返回错误对象', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'fail',
          message: 'reserved range'
        })
      })

      const result = await getCityByIp('8.8.8.8')

      expect(result.city).toBeNull()
      expect(result.isLocal).toBe(false)
      expect(result.error).toContain('reserved range')
    })

    it('网络错误应降级返回错误对象，不抛异常', async () => {
      fetchMock.mockRejectedValueOnce(new Error('network error'))

      const result = await getCityByIp('8.8.8.8')

      expect(result.city).toBeNull()
      expect(result.isLocal).toBe(false)
      expect(result.error).toContain('network error')
    })

    it('fetch 超时应降级返回超时错误，不抛异常', async () => {
      vi.useFakeTimers()

      // 模拟永不 resolve 的 fetch（直到超时触发 abort）
      fetchMock.mockImplementationOnce(
        (_url: string, opts?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts?.signal?.addEventListener('abort', () => {
              const err = new Error('The operation was aborted')
              err.name = 'AbortError'
              reject(err)
            })
          })
      )

      const promise = getCityByIp('8.8.8.8')

      // 推进 11 秒，触发 10 秒超时
      vi.advanceTimersByTime(11_000)

      const result = await promise

      expect(result.city).toBeNull()
      expect(result.isLocal).toBe(false)
      expect(result.error).toContain('超时')
    })
  })

  describe('返回值结构完整性', () => {
    it('成功结果应包含所有字段', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          city: '深圳',
          regionName: '广东',
          country: '中国',
          lat: 22.54,
          lon: 114.06
        })
      })

      const result = await getCityByIp('119.29.29.29')

      // 验证所有字段都存在
      expect(result).toHaveProperty('city')
      expect(result).toHaveProperty('region')
      expect(result).toHaveProperty('country')
      expect(result).toHaveProperty('lat')
      expect(result).toHaveProperty('lon')
      expect(result).toHaveProperty('isLocal')
      expect(result).toHaveProperty('error')
    })

    it('失败结果也应包含所有字段（null 值）', async () => {
      const result = await getCityByIp('not-an-ip')

      expect(result).toHaveProperty('city', null)
      expect(result).toHaveProperty('region', null)
      expect(result).toHaveProperty('country', null)
      expect(result).toHaveProperty('lat', null)
      expect(result).toHaveProperty('lon', null)
      expect(result).toHaveProperty('isLocal', false)
      expect(result).toHaveProperty('error', 'IP 格式不合法')
    })
  })
})
