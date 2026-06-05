/**
 * @file MCP Weather Server 单元测试
 *
 * 测试内容：
 *   1. weather.ts 核心函数的单元测试（mock fetch）
 *   2. MCP Weather Server 集成测试（通过 stdio 连接真实子进程）
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import {
  geocodeCity,
  fetchWeather,
  describeWeatherCode,
  describeWindDirection
} from '~/server/tools/weather'
import type { GeocodingResult, WeatherResponse } from '~/server/tools/weather'

// ============================================================
// 核心函数单元测试（mock fetch，不依赖网络）
// ============================================================

describe('weather.ts 核心函数', () => {
  describe('describeWeatherCode', () => {
    it('应将 WMO 代码 0 映射为"晴朗"', () => {
      expect(describeWeatherCode(0)).toBe('晴朗')
    })

    it('应将 WMO 代码 3 映射为"多云"', () => {
      expect(describeWeatherCode(3)).toBe('多云')
    })

    it('应将 WMO 代码 61 映射为"小雨"', () => {
      expect(describeWeatherCode(61)).toBe('小雨')
    })

    it('应将 WMO 代码 95 映射为"雷暴"', () => {
      expect(describeWeatherCode(95)).toBe('雷暴')
    })

    it('未知天气代码应返回"未知天气"', () => {
      expect(describeWeatherCode(999)).toBe('未知天气')
    })

    it('应覆盖所有已知 WMO 代码', () => {
      // 验证映射表中所有代码都能正确返回非"未知天气"的描述
      const knownCodes = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]
      for (const code of knownCodes) {
        expect(describeWeatherCode(code)).not.toBe('未知天气')
      }
    })
  })

  describe('describeWindDirection', () => {
    it('0° 应为"北风"', () => {
      expect(describeWindDirection(0)).toBe('北风')
    })

    it('90° 应为"东风"', () => {
      expect(describeWindDirection(90)).toBe('东风')
    })

    it('180° 应为"南风"', () => {
      expect(describeWindDirection(180)).toBe('南风')
    })

    it('270° 应为"西风"', () => {
      expect(describeWindDirection(270)).toBe('西风')
    })

    it('45° 应为"东北风"', () => {
      expect(describeWindDirection(45)).toBe('东北风')
    })

    it('135° 应为"东南风"', () => {
      expect(describeWindDirection(135)).toBe('东南风')
    })

    it('225° 应为"西南风"', () => {
      expect(describeWindDirection(225)).toBe('西南风')
    })

    it('315° 应为"西北风"', () => {
      expect(describeWindDirection(315)).toBe('西北风')
    })

    it('360° 应等同于 0°，返回"北风"', () => {
      expect(describeWindDirection(360)).toBe('北风')
    })

    it('边界角度 22° 应为"北风"', () => {
      // 22° 更接近 0°（北）而非 45°（东北）
      expect(describeWindDirection(22)).toBe('北风')
    })

    it('边界角度 23° 应为"东北风"', () => {
      // 23° 更接近 45°（东北）而非 0°（北）
      expect(describeWindDirection(23)).toBe('东北风')
    })
  })

  describe('geocodeCity', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
    })

    it('应正确解析城市名并返回地理信息', async () => {
      const mockResult: GeocodingResult = {
        name: 'Shenzhen',
        latitude: 22.5431,
        longitude: 114.0579,
        country: 'China',
        admin1: 'Guangdong'
      }

      vi.fn() // 占位，实际 mock 在下方
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [mockResult] })
      })

      const result = await geocodeCity('深圳')
      expect(result).toEqual(mockResult)

      // 验证请求 URL 包含正确参数
      expect(globalThis.fetch).toHaveBeenCalledOnce()
      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(calledUrl).toContain('geocoding-api.open-meteo.com')
      expect(calledUrl).toContain('name=')
      expect(calledUrl).toContain('language=zh')
    })

    it('城市不存在时应返回 null', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [] })
      })

      const result = await geocodeCity('不存在的城市xyz')
      expect(result).toBeNull()
    })

    it('API 返回无 results 字段时应返回 null', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({})
      })

      const result = await geocodeCity('test')
      expect(result).toBeNull()
    })

    it('API 请求失败时应抛出错误', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({})
      })

      await expect(geocodeCity('深圳')).rejects.toThrow('Geocoding API 请求失败')
    })
  })

  describe('fetchWeather', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
    })

    it('应根据经纬度返回天气数据', async () => {
      const mockWeather: WeatherResponse = {
        current: {
          temperature_2m: 28.5,
          relative_humidity_2m: 75,
          apparent_temperature: 32.1,
          weather_code: 3,
          wind_speed_10m: 12.3,
          wind_direction_10m: 180
        },
        daily: {
          weather_code: [3, 1, 2],
          temperature_2m_max: [30, 32, 31],
          temperature_2m_min: [25, 26, 24],
          precipitation_probability_max: [20, 10, 30]
        }
      }

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockWeather)
      })

      const result = await fetchWeather(22.5431, 114.0579)
      expect(result).toEqual(mockWeather)

      // 验证请求 URL 包含经纬度参数
      expect(globalThis.fetch).toHaveBeenCalledOnce()
      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(calledUrl).toContain('api.open-meteo.com')
      expect(calledUrl).toContain('latitude=22.5431')
      expect(calledUrl).toContain('longitude=114.0579')
    })

    it('API 请求失败时应抛出错误', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({})
      })

      await expect(fetchWeather(0, 0)).rejects.toThrow('Weather API 请求失败')
    })
  })
})

// ============================================================
// MCP Weather Server 集成测试（通过 stdio 连接子进程，需网络）
// ============================================================

describe('MCP Weather Server 集成测试', () => {
  // 集成测试需要启动子进程并访问真实 API，设置较长超时
  const INTEGRATION_TIMEOUT = 30_000

  // 动态导入 MCP SDK，避免在非 Node 环境报错
  let Client: any
  let StdioClientTransport: any

  let client: any
  let transport: any

  beforeAll(async () => {
    // MCP SDK 仅在 Node.js 环境可用
    const sdkClient = await import('@modelcontextprotocol/sdk/client/index.js')
    const sdkStdio = await import('@modelcontextprotocol/sdk/client/stdio.js')
    Client = sdkClient.Client
    StdioClientTransport = sdkStdio.StdioClientTransport
  })

  afterEach(async () => {
    // 每个测试后关闭连接
    if (transport) {
      try {
        await transport.close()
      } catch {
        // 忽略关闭时的错误
      }
      transport = null
    }
  })

  /**
   * 启动 MCP Server 子进程并建立客户端连接
   */
  async function connectToServer() {
    transport = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', 'server/mcp/weather-server.ts'],
      stderr: 'pipe'
    })

    client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} }
    )

    await client.connect(transport)
    return client
  }

  it(
    '应正常启动并响应 tools/list 请求',
    async () => {
      const connectedClient = await connectToServer()

      const toolsResult = await connectedClient.listTools()

      expect(toolsResult.tools).toBeDefined()
      expect(toolsResult.tools).toHaveLength(1)

      const weatherTool = toolsResult.tools[0]
      expect(weatherTool.name).toBe('weather')
      expect(weatherTool.description).toContain('天气')
      expect(weatherTool.inputSchema).toBeDefined()
      expect(weatherTool.inputSchema.type).toBe('object')
      expect(weatherTool.inputSchema.properties).toHaveProperty('city')
    },
    INTEGRATION_TIMEOUT
  )

  it(
    '调用 weather 工具查询中国城市"深圳"应返回正确的天气数据结构',
    async () => {
      const connectedClient = await connectToServer()

      const result = await connectedClient.callTool({
        name: 'weather',
        arguments: { city: '深圳' }
      })

      expect(result.content).toBeDefined()
      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')

      // 解析返回的 JSON 数据
      const data = JSON.parse(result.content[0].text)

      // 验证顶层结构
      expect(data).toHaveProperty('city')
      expect(data).toHaveProperty('country')
      expect(data).toHaveProperty('current')
      expect(data).toHaveProperty('forecast')
      expect(data).toHaveProperty('coordinates')

      // 验证当前天气结构
      expect(data.current).toHaveProperty('temperature')
      expect(data.current).toHaveProperty('feelsLike')
      expect(data.current).toHaveProperty('humidity')
      expect(data.current).toHaveProperty('condition')
      expect(data.current).toHaveProperty('windSpeed')
      expect(data.current).toHaveProperty('windDirection')

      // 验证预报是数组且最多 3 天
      expect(Array.isArray(data.forecast)).toBe(true)
      expect(data.forecast.length).toBeLessThanOrEqual(3)

      // 验证预报结构
      if (data.forecast.length > 0) {
        const firstDay = data.forecast[0]
        expect(firstDay).toHaveProperty('day')
        expect(firstDay).toHaveProperty('condition')
        expect(firstDay).toHaveProperty('high')
        expect(firstDay).toHaveProperty('low')
        expect(firstDay).toHaveProperty('rainChance')
      }

      // 验证坐标
      expect(data.coordinates).toHaveProperty('latitude')
      expect(data.coordinates).toHaveProperty('longitude')
      expect(typeof data.coordinates.latitude).toBe('number')
      expect(typeof data.coordinates.longitude).toBe('number')
    },
    INTEGRATION_TIMEOUT
  )

  it(
    '调用 weather 工具查询英文城市"Tokyo"应返回正确的天气数据',
    async () => {
      const connectedClient = await connectToServer()

      const result = await connectedClient.callTool({
        name: 'weather',
        arguments: { city: 'Tokyo' }
      })

      expect(result.content).toBeDefined()
      expect(result.content[0].type).toBe('text')

      const data = JSON.parse(result.content[0].text)

      // 验证返回的是东京的天气数据（Geocoding API 使用 language=zh，国家名可能为中文）
      expect(data.city).toBeDefined()
      expect(data.country).toBeDefined()
      expect(data.current).toHaveProperty('temperature')
      expect(data.current).toHaveProperty('condition')
    },
    INTEGRATION_TIMEOUT
  )

  it(
    '城市名不存在时应返回 isError: true',
    async () => {
      const connectedClient = await connectToServer()

      const result = await connectedClient.callTool({
        name: 'weather',
        arguments: { city: 'XyzNonexistentCity999' }
      })

      expect(result.isError).toBe(true)
      expect(result.content).toBeDefined()
      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('未找到城市')
    },
    INTEGRATION_TIMEOUT
  )
})
