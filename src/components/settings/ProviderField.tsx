import { PROVIDERS, PROVIDER_PRESETS, type ProviderId } from '../../services/api/providers.js'
import { setProviderConfig, useSettings } from '../../services/settings.js'
import { Select } from '../base/Select.js'
import styles from './Settings.module.css'

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 12px',
  marginTop: 8,
  borderRadius: 8,
  border: '1px solid var(--border, #d0d0d0)',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
} as const

/** 后端选择：DeepSeek 官方，或 NVIDIA / ModelScope / 自定义的 OpenAI 兼容接口 */
export const ProviderField = () => {
  const { provider, providerBaseUrl, providerModel } = useSettings()
  const preset = PROVIDER_PRESETS[provider]
  const update = (patch: Partial<{ provider: ProviderId; providerBaseUrl: string; providerModel: string }>) =>
    setProviderConfig({ provider, providerBaseUrl, providerModel, ...patch })

  return (
    <div className={styles.cell}>
      <div style={{ width: '100%' }}>
        <div className={styles.label}>模型后端</div>
        <Select
          value={provider}
          options={PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
          // 切换后端时清空覆盖项，回到该后端的默认地址与模型；API Key 需要重新填写
          onChange={(value) => update({ provider: value, providerBaseUrl: '', providerModel: '' })}
        />
        {provider !== 'deepseek' ? (
          <>
            <input
              style={inputStyle}
              spellCheck={false}
              placeholder={`Base URL（默认 ${preset.baseUrl || '必填'}）`}
              value={providerBaseUrl}
              onChange={(event) => update({ providerBaseUrl: event.target.value })}
            />
            <input
              style={inputStyle}
              spellCheck={false}
              placeholder={`模型 ID（默认 ${preset.model || '必填'}）`}
              value={providerModel}
              onChange={(event) => update({ providerModel: event.target.value })}
            />
          </>
        ) : null}
      </div>
    </div>
  )
}
