import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { isProviderId, PROVIDER_PRESETS, type ProviderId } from './api/providers.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  apiKey: string | null
  provider: ProviderId
  providerBaseUrl: string
  providerModel: string
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  provider: 'chat-demo:provider',
  providerBaseUrl: 'chat-demo:provider-base-url',
  providerModel: 'chat-demo:provider-model',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
    return true
  } catch {
    // 存储不可用时只在内存中生效
    return false
  }
}

type ProviderConfig = Pick<Settings, 'provider' | 'providerBaseUrl' | 'providerModel'>

export const apiKeyScope = ({ provider, providerBaseUrl }: ProviderConfig) => {
  const key = `${KEYS.apiKey}:${provider}`
  const baseUrl = providerBaseUrl.trim().replace(/\/+$/, '')
  const { baseUrl: direct, relayBaseUrl } = PROVIDER_PRESETS.nvidia
  return provider === 'nvidia' && baseUrl && baseUrl !== direct && baseUrl !== relayBaseUrl
    ? `${key}:${baseUrl}`
    : key
}

const apiKeys = new Map<string, string | null>()
const getScopedApiKey = (scope: string) => {
  if (!apiKeys.has(scope)) {
    apiKeys.set(scope, read(scope))
  }
  return apiKeys.get(scope) ?? null
}

const savedProvider = read(KEYS.provider)
const initialProvider: ProviderConfig = {
  provider: isProviderId(savedProvider) ? savedProvider : 'deepseek',
  providerBaseUrl: read(KEYS.providerBaseUrl) ?? '',
  providerModel: read(KEYS.providerModel) ?? '',
}

// 旧版只有一个 Key。迁移到保存的后端，NVIDIA 官方 Key 可通过前缀识别。
const legacyApiKey = read(KEYS.apiKey)
if (legacyApiKey) {
  const legacyScope =
    legacyApiKey.startsWith('nvapi-') && initialProvider.provider !== 'nvidia'
      ? apiKeyScope({ provider: 'nvidia', providerBaseUrl: '', providerModel: '' })
      : apiKeyScope(initialProvider)
  // 当前后端可能刚从其他平台切到 NVIDIA，避免自动发送归属不明的旧 Key。
  const needsNvidiaKey = legacyScope === `${KEYS.apiKey}:nvidia`
  if (!needsNvidiaKey || legacyApiKey.startsWith('nvapi-')) {
    if (read(legacyScope) !== null || write(legacyScope, legacyApiKey)) {
      write(KEYS.apiKey, null)
    } else {
      apiKeys.set(legacyScope, legacyApiKey)
    }
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

export const useSettings = create<Settings>(() => ({
  ...initialProvider,
  apiKey: getScopedApiKey(apiKeyScope(initialProvider)),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  const scope = apiKeyScope(useSettings.getState())
  apiKeys.set(scope, apiKey)
  write(scope, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

export const setProviderConfig = (config: ProviderConfig) => {
  write(KEYS.provider, config.provider)
  write(KEYS.providerBaseUrl, config.providerBaseUrl)
  write(KEYS.providerModel, config.providerModel)
  useSettings.setState({ ...config, apiKey: getScopedApiKey(apiKeyScope(config)) })
}
