/**
 * @file 天气查询工具 — Open-Meteo API 集成
 *
 * 本文件定义了 AI SDK 的天气查询工具，供 streamText 调用。
 * 当 AI 判断需要获取天气信息时，会自动调用此工具查询实时天气。
 *
 * 使用场景：
 *   - 学生询问天气相关的问题（如"明天要不要带伞"）
 *   - 地理课上讨论不同城市的气候差异
 *   - 日常生活中的天气查询需求
 *
 * 技术方案：
 *   - 使用 Open-Meteo API（完全免费、无需 API Key、无需注册）
 *   - 先通过 Geocoding API 将城市名转为经纬度
 *   - 再通过 Weather API 获取当前和未来天气数据
 *   - 通过原生 fetch 调用，无需额外 SDK 依赖
 *
 * API 说明：
 *   - Geocoding: https://open-meteo.com/en/docs/geocoding-api
 *   - Weather:   https://open-meteo.com/en/docs
 *   - 两个 API 均为免费开源服务，无需认证
 */

import { tool } from 'ai'
import { z } from 'zod'

/** Open-Meteo Geocoding API 端点，用于将城市名转为经纬度 */
const GEOCODING_API_URL = 'https://geocoding-api.open-meteo.com/v1/search'

/** Open-Meteo Weather API 端点，用于获取天气数据 */
const WEATHER_API_URL = 'https://api.open-meteo.com/v1/forecast'

/**
 * WMO 天气代码到中文描述的映射表
 *
 * Open-Meteo 返回的 weather_code 是 WMO 标准代码，
 * 需要转换为用户可读的中文天气描述。
 *
 * @see https://open-meteo.com/en/docs#weathervariables
 */
const WEATHER_CODE_MAP: Record<number, string> = {
  0: '晴朗',
  1: '大部晴朗',
  2: '局部多云',
  3: '多云',
  45: '有雾',
  48: '雾凇',
  51: '小毛毛雨',
  53: '中毛毛雨',
  55: '大毛毛雨',
  56: '冻毛毛雨（小）',
  57: '冻毛毛雨（大）',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨（小）',
  67: '冻雨（大）',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪粒',
  80: '阵雨（小）',
  81: '阵雨（中）',
  82: '阵雨（大）',
  85: '阵雪（小）',
  86: '阵雪（大）',
  95: '雷暴',
  96: '雷暴伴小冰雹',
  99: '雷暴伴大冰雹'
}

/**
 * Geocoding API 返回的地理位置结果
 */
interface GeocodingResult {
  name: string
  latitude: number
  longitude: number
  country: string
  admin1?: string
}

/**
 * Geocoding API 响应
 */
interface GeocodingResponse {
  results?: GeocodingResult[]
}

/**
 * Weather API 返回的当前天气数据
 */
interface CurrentWeather {
  temperature_2m: number
  relative_humidity_2m: number
  apparent_temperature: number
  weather_code: number
  wind_speed_10m: number
  wind_direction_10m: number
}

/**
 * Weather API 返回的每日预报数据
 */
interface DailyForecast {
  weather_code: number[]
  temperature_2m_max: number[]
  temperature_2m_min: number[]
  precipitation_probability_max: number[]
}

/**
 * Weather API 完整响应
 */
interface WeatherResponse {
  current?: CurrentWeather
  daily?: DailyForecast
}

/**
 * 将城市名转换为经纬度坐标
 *
 * 调用 Open-Meteo Geocoding API，将中文或英文城市名
 * 转换为经纬度坐标，供天气查询使用。
 *
 * @param cityName - 城市名称（支持中文如"深圳"、英文如"Beijing"）
 * @returns 匹配的第一个地理位置结果，未找到返回 null
 *
 * 示例：
 *   await geocodeCity("深圳") → { name: "Shenzhen", latitude: 22.5431, longitude: 114.0579, ... }
 *   await geocodeCity("Beijing") → { name: "Beijing", latitude: 39.9075, longitude: 116.3972, ... }
 */
async function geocodeCity(cityName: string): Promise<GeocodingResult | null> {
  const params = new URLSearchParams({
    name: cityName,
    count: '1',
    language: 'zh',
    format: 'json'
  })

  const response = await fetch(`${GEOCODING_API_URL}?${params}`)

  if (!response.ok) {
    throw new Error(`Geocoding API 请求失败 (${response.status})`)
  }

  const data = (await response.json()) as GeocodingResponse

  if (!data.results || data.results.length === 0) {
    return null
  }

  return data.results[0]
}

/**
 * 根据经纬度获取天气数据
 *
 * 调用 Open-Meteo Weather API，获取指定位置的当前天气和未来 3 天预报。
 *
 * @param latitude - 纬度
 * @param longitude - 经度
 * @returns 天气数据（包含当前天气和每日预报）
 *
 * 请求的天气参数说明：
 *   - current: 当前温度、体感温度、湿度、天气代码、风速、风向
 *   - daily: 未来3天的天气代码、最高/最低温度、降水概率
 */
async function fetchWeather(latitude: number, longitude: number): Promise<WeatherResponse> {
  const params = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    current: [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'weather_code',
      'wind_speed_10m',
      'wind_direction_10m'
    ].join(','),
    daily: [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_probability_max'
    ].join(','),
    timezone: 'auto',
    forecast_days: '3'
  })

  const response = await fetch(`${WEATHER_API_URL}?${params}`)

  if (!response.ok) {
    throw new Error(`Weather API 请求失败 (${response.status})`)
  }

  return (await response.json()) as WeatherResponse
}

/**
 * 将 WMO 天气代码转换为中文描述
 *
 * @param code - WMO 标准天气代码
 * @returns 中文天气描述，未知代码返回"未知天气"
 */
function describeWeatherCode(code: number): string {
  return WEATHER_CODE_MAP[code] || '未知天气'
}

/**
 * 将风向角度转换为中文方位描述
 *
 * @param degrees - 风向角度（0-360°，0° 为正北）
 * @returns 中文方位描述，如"北风"、"东南风"
 */
function describeWindDirection(degrees: number): string {
  const directions = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']
  const index = Math.round(degrees / 45) % 8
  return `${directions[index]}风`
}

/**
 * 天气查询工具定义
 *
 * 使用 AI SDK 的 tool() 函数创建，供 streamText 的 tools 参数使用。
 * 当 LLM 判断需要查询天气时，会自动生成工具调用请求，
 * AI SDK 框架会执行 execute 函数并将结果返回给模型。
 *
 * 工作流程：
 *   1. 用户提问 "深圳今天天气怎么样？"
 *   2. LLM 判断需要查询天气 → 生成工具调用 { city: "深圳" }
 *   3. AI SDK 执行 execute 函数：
 *      a. 调用 Geocoding API 将 "深圳" 转为经纬度
 *      b. 调用 Weather API 获取天气数据
 *      c. 格式化返回结果
 *   4. 天气数据返回给 LLM
 *   5. LLM 基于天气数据生成自然语言回答
 *
 * 无需任何 API Key，完全免费使用。
 */
export const weatherTool = tool({
  /**
   * description — 工具描述，告诉 LLM 这个工具是干什么的
   *
   * LLM 会根据这段描述判断是否需要调用此工具。
   * 描述越清晰，LLM 越能准确判断何时该调用。
   * 这段文字不会展示给用户，只给 LLM 看。
   */
  description:
    '查询指定城市的实时天气和未来3天预报。当用户询问天气、气温、是否下雨、是否需要带伞等问题时使用此工具。',

  /**
   * parameters — 工具参数定义，告诉 LLM 调用此工具需要传什么参数
   *
   * 使用 Zod schema 定义参数的结构和类型。
   * LLM 会根据 schema 生成符合格式的参数值。
   *
   * z.string().describe(...) 中的 describe 很重要：
   *   它告诉 LLM 这个参数应该填什么内容，帮助 LLM 生成更准确的参数值。
   *
   * 例如：当用户问"深圳天气"时，LLM 会根据 describe 的提示，
   *   生成 { city: "深圳" } 而不是 { city: "广东省" } 或其他不合适的值。
   */
  parameters: z.object({
    city: z
      .string()
      .describe('城市名称，支持中文（如"深圳"、"北京"）或英文（如"Tokyo"、"New York"）')
  }),

  /**
   * execute — 工具的执行函数，当 LLM 决定调用此工具时，AI SDK 会执行这个函数
   *
   * 参数来自 LLM 生成的工具调用请求（即 parameters 中定义的 city）
   * 返回值会作为工具结果返回给 LLM，LLM 据此生成最终回答
   *
   * 执行流程：
   *   1. LLM 生成 { city: "深圳" }
   *   2. AI SDK 调用 execute({ city: "深圳" })
   *   3. execute 返回天气数据
   *   4. LLM 拿到天气数据，生成自然语言回答
   */
  execute: async ({ city }) => {
    try {
      // 第一步：将城市名转为经纬度
      const location = await geocodeCity(city)

      if (!location) {
        return {
          error: `未找到城市 "${city}"，请检查城市名称是否正确`,
          city
        }
      }

      // 第二步：根据经纬度获取天气数据
      const weatherData = await fetchWeather(location.latitude, location.longitude)

      // 第三步：格式化当前天气
      const current = weatherData.current
      if (!current) {
        return {
          error: `无法获取 ${city} 的天气数据，请稍后重试`,
          city
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

      return {
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误'
      return {
        error: `天气查询失败: ${errorMessage}`,
        city
      }
    }
  }
})
