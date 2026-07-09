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

// ============================================================================
// IP 定位能力（ip-api.com 集成）
// ============================================================================

/**
 * ip-api.com 端点（HTTP，非 HTTPS）
 *
 * 为什么用 HTTP 而非 HTTPS：
 *   - ip-api.com 免费版仅支持 HTTP，HTTPS 需付费
 *   - 本调用由 MCP Server 子进程发起（服务端出站），不经过浏览器，无 mixed content 问题
 *   - 若未来部署到强制 HTTPS 出站的环境，可切换到 ipinfo.io（仅需改 URL，核心逻辑不变）
 *
 * 限流：免费版 45 次/分钟，对本项目（单用户对话）完全够用。
 */
const IP_API_URL = 'http://ip-api.com/json'

/**
 * IP 定位请求超时（10 秒）
 *
 * 参考 OCR 工具的 30 秒超时，IP 定位比 OCR 推理轻量，10 秒足够；
 * 超时后返回错误对象，防止 MCP 工具调用卡住。
 */
const IP_API_TIMEOUT_MS = 10_000

/**
 * 内网/保留 IP 黑名单（IPv4 + IPv6）
 *
 * 覆盖范围（与 OCR 工具的 PRIVATE_IP_PATTERNS 保持一致）：
 *   - IPv4: 127.0.0.0/8、10.0.0.0/8、172.16.0.0/12、192.168.0.0/16、169.254.0.0/16（含云元数据）、0.0.0.0
 *   - IPv6: ::1（loopback）、fe80::/10（link-local）、fc00::/7（ULA，含 fd00::/8）
 *
 * 命中黑名单时短路返回 isLocal: true，不发起外部 HTTP 请求：
 *   - 节省 API 调用（本地/内网 IP 反查无意义）
 *   - 快速反馈，让 LLM 立即知道需反问用户城市
 */
const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^fe80:/i,
  /^fc00:/i,
  /^fd[0-9a-f]{2}:/i
]

/**
 * IPv4 正则（四段 0-255）
 *
 * 不使用 Node.js net.isIP() 是因为：
 *   - 还需额外区分 IPv4/IPv6 才能用对应黑名单正则
 *   - 显式正则更直观，便于审查和单元测试
 *   - IPv6 正则复杂度高，net.isIP() 仅返回 0/4/6 无法识别具体格式问题
 */
const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/**
 * IPv6 正则（简化版，支持 :: 压缩和 IPv4 内嵌）
 *
 * IPv6 格式多变，此正则覆盖常见写法，对极端格式可能误判；
 * 实际使用中客户端 IP 几乎都是标准格式，此正则足够。
 * 关键作用是拦截非 IP 字符串（如 "not-an-ip"、含 CRLF 的注入字符串）。
 */
const IPV6_REGEX = /^([0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{0,4}$|^([0-9a-fA-F]{1,4}:){1,7}:([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$|^::([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{0,4}$|^([0-9a-fA-F]{1,4}:){0,6}::$/

/**
 * IP 定位结果
 *
 * 成功时 city/region/country/lat/lon 有值，isLocal 为 false，error 为 null。
 * 本地/内网 IP 时 isLocal 为 true，city 等字段为 null，error 描述原因。
 * API 故障时 isLocal 为 false，city 等字段为 null，error 描述错误。
 */
export interface IpLocationResult {
  city: string | null
  region: string | null
  country: string | null
  lat: number | null
  lon: number | null
  /** 是否为本地/内网 IP（127.0.0.1、::1、10.x、192.168.x 等） */
  isLocal: boolean
  /** 错误描述（成功时为 null） */
  error: string | null
}

/**
 * 校验 IP 字符串格式是否合法（IPv4 或 IPv6）
 *
 * @param ip - 待校验的 IP 字符串
 * @returns true 表示格式合法
 */
export function isValidIp(ip: string): boolean {
  if (typeof ip !== 'string' || ip.length === 0 || ip.length > 45) return false

  // IPv4 校验：四段 0-255
  const v4Match = ip.match(IPV4_REGEX)
  if (v4Match) {
    return v4Match.slice(1).every((seg) => {
      const n = Number(seg)
      return n >= 0 && n <= 255
    })
  }

  // IPv6 校验（简化正则，主要拦截非 IP 字符串和注入字符）
  if (ip.includes(':')) {
    return IPV6_REGEX.test(ip)
  }

  return false
}

/**
 * 判断 IP 是否为内网/保留地址
 *
 * @param ip - 已通过 isValidIp 校验的 IP 字符串
 * @returns true 表示为内网/保留地址
 */
export function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(ip))
}

/**
 * 通过 IP 反查城市信息
 *
 * 调用 ip-api.com 免费 API（无需 Key），返回城市名/区域/国家/经纬度。
 * 函数入口执行严格安全校验，防止通过 URL 注入向内网发起请求。
 *
 * SSRF 防护策略（不做 DNS 双重校验，原因见下）：
 *   1. 严格 IP 格式正则校验（核心防线，拦截非 IP 字符串和注入字符）
 *   2. 内网/保留 IP 黑名单短路（节省 API 调用，非安全必需）
 *   3. encodeURIComponent 编码 IP 参数（防止 CRLF、/、@ 等字符导致 URL 路径逃逸）
 *   4. AbortController 10 秒超时（防止网络挂起）
 *
 * 为什么不做 DNS 双重校验：
 *   本工具始终连接固定主机 ip-api.com，用户传入的 IP 仅作为 URL 路径参数（/json/{ip}），
 *   不作为连接目标主机名，不存在 DNS rebinding 攻击面（DNS rebinding 需要攻击者控制
 *   连接目标主机名，本场景不满足此前提）。对 IP 字符串做 dns.lookup 语义错误——
 *   要么直接返回该 IP（IP 不需要解析），要么报错。
 *
 * 错误处理：
 *   所有失败路径（格式校验失败、内网拦截、网络错误、API 返回失败、超时）均返回
 *   `{ city: null, ..., error: string }` 结构化对象，不抛异常。
 *   符合 AGENTS.md「执行失败返回 { error, detail } 不 throw，由 LLM 决定重试/换工具」原则。
 *
 * @param ip - IPv4 或 IPv6 字符串
 * @returns IP 定位结果（成功/失败均返回结构化对象）
 *
 * 示例：
 *   await getCityByIp("119.29.29.29") → { city: "深圳", region: "广东", country: "中国", ... }
 *   await getCityByIp("127.0.0.1") → { city: null, isLocal: true, error: "本地/内网 IP，无法定位" }
 *   await getCityByIp("not-an-ip") → { city: null, isLocal: false, error: "IP 格式不合法" }
 */
export async function getCityByIp(ip: string): Promise<IpLocationResult> {
  const emptyResult = (
    isLocal: boolean,
    error: string
  ): IpLocationResult => ({
    city: null,
    region: null,
    country: null,
    lat: null,
    lon: null,
    isLocal,
    error
  })

  // 1. 严格 IP 格式校验
  if (!isValidIp(ip)) {
    return emptyResult(false, 'IP 格式不合法')
  }

  // 2. 内网/保留地址短路（不发起 HTTP 请求）
  if (isPrivateIp(ip)) {
    return emptyResult(true, '本地/内网 IP，无法定位')
  }

  // 3. 构造请求 URL，encodeURIComponent 防御性编码
  const encodedIp = encodeURIComponent(ip)
  const fields = 'status,message,city,regionName,country,lat,lon'
  const url = `${IP_API_URL}/${encodedIp}?lang=zh&fields=${fields}`

  // 4. AbortController 超时控制
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), IP_API_TIMEOUT_MS)

  try {
    const response = await fetch(url, { signal: controller.signal })

    if (!response.ok) {
      return emptyResult(false, `IP 定位服务暂时不可用 (HTTP ${response.status})`)
    }

    const data = (await response.json()) as {
      status: string
      message?: string
      city?: string
      regionName?: string
      country?: string
      lat?: number
      lon?: number
    }

    if (data.status !== 'success') {
      return emptyResult(false, `IP 定位失败: ${data.message || '未知原因'}`)
    }

    return {
      city: data.city ?? null,
      region: data.regionName ?? null,
      country: data.country ?? null,
      lat: data.lat ?? null,
      lon: data.lon ?? null,
      isLocal: false,
      error: null
    }
  } catch (error) {
    // AbortController 超时
    if (error instanceof Error && error.name === 'AbortError') {
      return emptyResult(false, `IP 定位请求超时（${IP_API_TIMEOUT_MS / 1000}秒）`)
    }
    const msg = error instanceof Error ? error.message : String(error)
    return emptyResult(false, `IP 定位服务暂时不可用: ${msg}`)
  } finally {
    clearTimeout(timeoutId)
  }
}
