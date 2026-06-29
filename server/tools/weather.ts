/**
 * @file 天气查询工具 — Open-Meteo API 集成
 *
 * 本文件导出天气查询的核心函数，供 MCP Server 和其他模块复用。
 * 当 AI 判断需要获取天气信息时，会通过 MCP 协议调用此工具查询实时天气。
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
export interface GeocodingResult {
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
export interface WeatherResponse {
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
export async function geocodeCity(cityName: string): Promise<GeocodingResult | null> {
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
export async function fetchWeather(latitude: number, longitude: number): Promise<WeatherResponse> {
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
export function describeWeatherCode(code: number): string {
  return WEATHER_CODE_MAP[code] || '未知天气'
}

/**
 * 将风向角度转换为中文方位描述
 *
 * @param degrees - 风向角度（0-360°，0° 为正北）
 * @returns 中文方位描述，如"北风"、"东南风"
 */
export function describeWindDirection(degrees: number): string {
  const directions = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']
  const index = Math.round(degrees / 45) % 8
  return `${directions[index]}风`
}
