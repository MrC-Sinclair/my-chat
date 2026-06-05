/**
 * @file MCP Weather Server — 天气查询 MCP 服务
 *
 * 独立 MCP Server 进程，通过 stdio 传输与 AI SDK 客户端通信。
 * 复用 weather.ts 的核心函数，对外暴露 weather 工具。
 *
 * 启动方式：
 *   npx tsx server/mcp/weather-server.ts
 *
 * 使用 MCP Inspector 调试：
 *   npx @modelcontextprotocol/inspector npx tsx server/mcp/weather-server.ts
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  geocodeCity,
  fetchWeather,
  describeWeatherCode,
  describeWindDirection
} from '../tools/weather'

const server = new McpServer({
  name: 'weather-mcp-server',
  version: '1.0.0'
})

server.registerTool(
  'weather',
  {
    description:
      '查询指定城市的实时天气和未来3天预报。当用户询问天气、气温、是否下雨、是否需要带伞等问题时使用此工具。',
    inputSchema: {
      city: z
        .string()
        .describe(
          '城市名称，支持中文（如"深圳"、"北京"）或英文（如"Tokyo"、"New York"）'
        )
    }
  },
  async ({ city }) => {
    try {
      // 第一步：将城市名转为经纬度
      const location = await geocodeCity(city)

      if (!location) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `未找到城市 "${city}"，请检查城市名称是否正确`
            }
          ],
          isError: true
        }
      }

      // 第二步：根据经纬度获取天气数据
      const weatherData = await fetchWeather(location.latitude, location.longitude)

      // 第三步：格式化当前天气
      const current = weatherData.current
      if (!current) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `无法获取 ${city} 的天气数据，请稍后重试`
            }
          ],
          isError: true
        }
      }

      const currentWeather = {
        temperature: `${current.temperature_2m}°C`,
        feelsLike: `${current.apparent_temperature}°C`,
        humidity: `${current.relative_humidity_2m}%`,
        condition: describeWeatherCode(current.weather_code),
        windSpeed: `${current.wind_speed_10m} km/h`,
        windDirection: describeWindDirection(current.wind_direction_10m)
      }

      // 第四步：格式化未来 3 天预报
      const daily = weatherData.daily
      const forecast = daily
        ? Array.from({ length: Math.min(daily.weather_code.length, 3) }, (_, i) => ({
            day: i === 0 ? '今天' : i === 1 ? '明天' : '后天',
            condition: describeWeatherCode(daily.weather_code[i]),
            high: `${daily.temperature_2m_max[i]}°C`,
            low: `${daily.temperature_2m_min[i]}°C`,
            rainChance: `${daily.precipitation_probability_max[i]}%`
          }))
        : []

      const result = {
        city: location.name,
        region: location.admin1 || '',
        country: location.country,
        current: currentWeather,
        forecast,
        coordinates: {
          latitude: location.latitude,
          longitude: location.longitude
        }
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result)
          }
        ]
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误'
      return {
        content: [
          {
            type: 'text' as const,
            text: `天气查询失败: ${errorMessage}`
          }
        ],
        isError: true
      }
    }
  }
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // 使用 stderr 输出日志，避免干扰 stdio 通信
  console.error('MCP Weather Server 已启动 (stdio)')
}

main().catch((error) => {
  console.error('MCP Weather Server 启动失败:', error)
  process.exit(1)
})