import { useState } from 'react'
import { ApiError, verifyApiKey } from '../../services/api/client.js'
import { classifyApiError } from '../../services/api/errors.js'
import { PROVIDER_PRESETS } from '../../services/api/providers.js'
import { apiKeyScope, setApiKey, useSettings } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'

/** 输入 API Key 后先用 GET /models 校验，通过才保存 */
export const useApiKeyForm = (onSaved?: () => void) => {
  const t = useTranslate()
  const scope = useSettings(apiKeyScope)
  const provider = useSettings((state) => state.provider)
  const providerBaseUrl = useSettings((state) => state.providerBaseUrl)
  const nvidiaDirect =
    provider === 'nvidia' &&
    (!providerBaseUrl.trim() ||
      providerBaseUrl.trim().replace(/\/+$/, '') === PROVIDER_PRESETS.nvidia.baseUrl)
  const [draft, setDraft] = useState({ scope, value: '' })
  const value = draft.scope === scope ? draft.value : ''
  const setValue = (value: string) => setDraft({ scope, value })
  const [verifying, setVerifying] = useState(false)
  const [failure, setFailure] = useState<{ scope: string; baseUrl: string; cause: unknown } | null>(
    null
  )
  const currentFailure =
    failure?.scope === scope && failure.baseUrl === providerBaseUrl ? failure : null
  const cause = currentFailure?.cause
  const error =
    currentFailure === null
      ? null
      : classifyApiError(cause) === 'unauthorized'
        ? t('apiKeyInvalid')
        : classifyApiError(cause) === 'network'
          ? t(nvidiaDirect ? 'nvidiaDirectUnavailable' : 'commonNetworkErrorToast')
          : t('apiKeyVerificationFailed', {
              message:
                cause instanceof ApiError && cause.localMessage
                  ? t(cause.localMessage.key, cause.localMessage.params)
                  : cause instanceof Error
                    ? cause.message
                    : String(cause),
            })

  const submit = async () => {
    const apiKey = value.trim()
    if (!apiKey || verifying) {
      return
    }
    const isCurrentConnection = () => {
      const current = useSettings.getState()
      return current.provider === provider && current.providerBaseUrl === providerBaseUrl
    }
    if (!isCurrentConnection()) {
      return
    }
    setVerifying(true)
    setFailure(null)
    try {
      await verifyApiKey(apiKey)
      if (!isCurrentConnection()) {
        return
      }
      setApiKey(apiKey)
      setValue('')
      onSaved?.()
    } catch (e) {
      if (isCurrentConnection()) {
        setFailure({ scope, baseUrl: providerBaseUrl, cause: e })
      }
    } finally {
      setVerifying(false)
    }
  }

  return { value, setValue, verifying, error, submit }
}
