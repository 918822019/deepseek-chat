import type { OpenAIProvider } from './openai.js'

export type ProviderId = 'deepseek' | 'nvidia' | 'modelscope' | 'custom'

export type ProviderPreset = {
  id: ProviderId
  label: string
  baseUrl: string
  /** 默认模型；用户可在设置中改 */
  model: string
}

/** deepseek 走原有的 Anthropic 兼容接口；其余走 OpenAI 兼容 /chat/completions */
export const PROVIDER_PRESETS: Record<ProviderId, ProviderPreset> = {
  deepseek: { id: 'deepseek', label: 'DeepSeek', baseUrl: '', model: '' },
  nvidia: {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    baseUrl: __NVIDIA_BASE_URL__,
    model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  },
  modelscope: {
    id: 'modelscope',
    label: 'ModelScope',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    // ModelScope 允许浏览器跨域，直连即可；模型列表公开：GET /v1/models
    model: 'deepseek-ai/DeepSeek-V4.1-Flash',
  },
  custom: { id: 'custom', label: '自定义 (OpenAI 兼容)', baseUrl: '', model: '' },
}

export const PROVIDERS = Object.values(PROVIDER_PRESETS)

export const isProviderId = (value: unknown): value is ProviderId =>
  PROVIDERS.some((p) => p.id === value)

export const resolveProvider = (
  id: ProviderId,
  override: { baseUrl: string; model: string }
): OpenAIProvider | null => {
  if (id === 'deepseek') {
    return null
  }
  const preset = PROVIDER_PRESETS[id]
  return {
    baseUrl: override.baseUrl.trim() || preset.baseUrl,
    model: override.model.trim() || preset.model,
  }
}
