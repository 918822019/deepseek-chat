import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import {
  retrySave,
  reuseTask,
  reviseTask,
  stopTask,
  taskMarkdown,
  useTaskStore,
  viewTask,
} from '../../services/tasks/store.js'
import { openDocument } from '../../services/tasks/workspace.js'
import type { TaskRun } from '../../services/tasks/history.js'
import { copyText } from '../../utils/clipboard.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import { Markdown } from '../markdown/Markdown.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { TaskStatus } from './TaskHistory.js'
import { TaskIcon } from './TaskIcon.js'
import styles from './Workbench.module.css'

export function TaskDetail({ run }: { run: TaskRun }) {
  const t = useTranslate()
  const locale = useSettings((s) => s.locale)
  const live = useTaskStore((s) => s.live[run.id])
  const [tab, setTab] = useState<'preview' | 'activity' | null>(null)
  const [markdown, setMarkdown] = useState('')
  const [loadError, setLoadError] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    if (run.hasMarkdown) {
      taskMarkdown(run.id)
        .then((text) => {
          if (active) {
            setMarkdown(text ?? '')
            setLoadError(!text)
          }
        })
        .catch(() => {
          if (active) {
            setLoadError(true)
          }
        })
    }
    return () => {
      active = false
    }
  }, [run.hasMarkdown, run.id, reload])

  const text = markdown || live?.text || ''
  const canPreview = !!text || !!run.hasMarkdown
  const view = tab ?? (canPreview ? 'preview' : 'activity')
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const running = run.status === 'running'
  const failed = ['failed', 'stopped', 'interrupted'].includes(run.status)
  const open = (reveal = false) => {
    void openDocument(run, reveal).catch(() => showToast({ key: 'taskOpenFailed', type: 'error' }))
  }

  return (
    <>
      <div className={styles.detailTitle}>
        <TaskStatus run={run} />
        <h1 className={styles.heading}>{run.title}</h1>
      </div>
      <div className={styles.actions}>
        {run.document ? (
          <Button size="m" onClick={() => open()}>
            {t('taskOpenDocument')}
          </Button>
        ) : null}
        {run.document ? (
          <Button size="m" variant="outlined" onClick={() => open(true)}>
            {t('taskShowInFolder')}
          </Button>
        ) : null}
        {run.status === 'unsaved' && live?.phase !== 'saving' ? (
          <Button size="m" onClick={() => void retrySave(run.id)}>
            {t('taskRetrySave')}
          </Button>
        ) : null}
        {failed ? (
          <Button
            size="m"
            onClick={() => {
              if (ensureApiKey()) {
                void reuseTask(run, true)
              }
            }}
          >
            {t('taskRetryRun')}
          </Button>
        ) : null}
        {running ? (
          <Button size="m" variant="outlined" onClick={() => stopTask(run.id)}>
            {t('taskStop')}
          </Button>
        ) : null}
        {run.hasMarkdown ? (
          <Button size="m" variant="outlined" onClick={() => reviseTask(run)}>
            {t('taskRevise')}
          </Button>
        ) : null}
        {!running ? (
          <Button size="m" variant="outlined" onClick={() => void reuseTask(run)}>
            {t('taskReuse')}
          </Button>
        ) : null}
      </div>
      {run.error ? (
        <p className={styles.notice} role="status">
          {t(run.error.key, run.error.params)}
        </p>
      ) : null}
      {live ? (
        <div className={styles.liveStatus} role="status">
          <i />
          {t(live.message.key, live.message.params)}
        </div>
      ) : null}

      <div className={styles.detailGrid}>
        <section className={styles.document}>
          <div className={styles.tabs}>
            <button
              aria-pressed={view === 'preview'}
              disabled={!canPreview}
              onClick={() => setTab('preview')}
            >
              {t('taskPreviewTab')}
            </button>
            <button aria-pressed={view === 'activity'} onClick={() => setTab('activity')}>
              {t('taskActivity')}
            </button>
            {markdown && view === 'preview' ? (
              <button
                className={styles.copyAction}
                onClick={async () => {
                  showToast({ key: (await copyText(markdown)) ? 'copied' : 'copyFailed' })
                }}
              >
                {t('taskCopyMarkdown')}
              </button>
            ) : null}
          </div>
          {view === 'preview' ? (
            <div className={styles.preview} aria-label={t('taskPreview')}>
              {text ? (
                <Markdown
                  content={text}
                  cacheKey={run.id}
                  loading={running}
                  disableLink={running}
                />
              ) : loadError ? (
                <Button size="m" variant="outlined" onClick={() => setReload((n) => n + 1)}>
                  {t('taskReloadPreview')}
                </Button>
              ) : (
                <p className={styles.note}>{t('taskLoadingPreview')}</p>
              )}
            </div>
          ) : (
            <ol className={styles.timeline}>
              {run.events.map((item, index) => (
                <li key={index}>
                  <time>{time.format(item.at)}</time>
                  <span>{t(item.message.key, item.message.params)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <aside className={styles.info}>
          {run.basedOn ? (
            <>
              <h2>{t('taskPrevious')}</h2>
              <button
                type="button"
                className={styles.textButton}
                onClick={() => {
                  if (run.basedOn) {
                    viewTask(run.basedOn.id)
                  }
                }}
              >
                {run.basedOn.title}
              </button>
            </>
          ) : null}
          <h2>{t('taskObjective')}</h2>
          <p>{run.objective}</p>
          <h2>{t('taskRunModel')}</h2>
          <p>{run.model}</p>
          <h2>{t('taskSources')}</h2>
          <p className={styles.path}>{run.workspacePath}</p>
          <details>
            <summary>{t('taskFileCount', { count: run.files.length })}</summary>
            <ul>
              {run.files.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </details>
          {run.document ? (
            <>
              <h2>{t('taskSavedFile')}</h2>
              <div className={styles.artifact}>
                <TaskIcon name="file" />
                <span>{run.document.name}</span>
              </div>
            </>
          ) : null}
        </aside>
      </div>
    </>
  )
}
