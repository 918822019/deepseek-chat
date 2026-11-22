import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { listNvidiaChatModels } from '../../services/api/client.js'
import { classifyApiError } from '../../services/api/errors.js'
import { PROVIDER_PRESETS } from '../../services/api/providers.js'
import { useSettings } from '../../services/settings.js'
import styles from './Settings.module.css'

export const NvidiaModelField = ({
  baseUrl,
  model,
  onChange,
}: {
  baseUrl: string
  model: string
  onChange: (model: string) => void
}) => {
  const t = useTranslate()
  const id = useId()
  const apiKey = useSettings((state) => state.apiKey)
  const [attempt, setAttempt] = useState(0)
  const request = useMemo(() => ({ baseUrl, apiKey, attempt }), [baseUrl, apiKey, attempt])
  const [result, setResult] = useState<{
    request: typeof request
    models: string[]
    error?: TranslationKey
  } | null>(null)
  const catalog = result?.request === request ? result : null

  useEffect(() => {
    if (!request.apiKey) {
      return
    }
    const controller = new AbortController()
    const { signal } = controller
    const timer = window.setTimeout(() => {
      setResult({ request, models: [], error: 'nvidiaModelsFailed' })
      controller.abort()
    }, 15000)

    void listNvidiaChatModels(request.baseUrl, request.apiKey, signal)
      .then((models) => {
        if (!signal.aborted) {
          setResult({ request, models })
        }
      })
      .catch((error: unknown) => {
        if (!signal.aborted) {
          const condition = classifyApiError(error)
          setResult({
            request,
            models: [],
            error:
              condition === 'unauthorized'
                ? 'apiKeyInvalid'
                : condition === 'network' && request.baseUrl === PROVIDER_PRESETS.nvidia.baseUrl
                  ? 'nvidiaDirectUnavailable'
                  : 'nvidiaModelsFailed',
          })
        }
      })
      .finally(() => window.clearTimeout(timer))

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [request])

  const models = catalog?.models ?? []
  const listed = models.includes(model)
  let status: TranslationKey | undefined
  if (!apiKey) {
    status = 'nvidiaModelsNeedKey'
  } else if (!catalog) {
    status = 'nvidiaModelsLoading'
  } else if (catalog.error) {
    status = catalog.error
  } else if (models.length === 0) {
    status = 'nvidiaModelsEmpty'
  } else if (!listed) {
    status = 'nvidiaModelMissing'
  }

  return (
    <div className={styles.modelPicker}>
      <label className={styles.label} htmlFor={id}>
        {t('nvidiaModelLabel')}
      </label>
      <select
        id={id}
        className={styles.modelSelect}
        value={listed ? model : ''}
        disabled={models.length === 0}
        aria-describedby={status ? `${id}-status` : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {!listed ? (
          <option value="" disabled>
            {model}
          </option>
        ) : null}
        {models.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      {status ? (
        <div id={`${id}-status`} role="status" className={styles.description}>
          {t(status)}
        </div>
      ) : null}
      {catalog && models.length === 0 ? (
        <button
          type="button"
          className={styles.confirm}
          onClick={() => setAttempt((count) => count + 1)}
        >
          {t('nvidiaModelsRetry')}
        </button>
      ) : null}
    </div>
  )
}
