import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import type { TaskRun } from '../../services/tasks/history.js'
import {
  goToHistory,
  goToTasks,
  taskLabels,
  useTaskStore,
  viewTask,
} from '../../services/tasks/store.js'
import { Button } from '../base/Button.js'
import { IconSearchOutline16 } from '../base/icons.js'
import { TaskIcon } from './TaskIcon.js'
import { folderName } from './TaskComposer.js'
import styles from './Workbench.module.css'

export function TaskStatus({ run }: { run: TaskRun }) {
  const t = useTranslate()
  const saving = useTaskStore((s) => s.live[run.id]?.phase === 'saving')
  return (
    <span className={styles.status} data-status={saving ? 'running' : run.status}>
      <i />
      {t(saving ? 'taskWritingFile' : taskLabels[run.status])}
    </span>
  )
}

export function TaskHistory({ recent = false }: { recent?: boolean }) {
  const t = useTranslate()
  const locale = useSettings((s) => s.locale)
  const runs = useTaskStore((s) => s.runs)
  const ready = useTaskStore((s) => s.ready)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('')
  const format = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  if (recent && !runs.length) {
    return null
  }
  const visible = recent
    ? runs.slice(0, 4)
    : runs.filter(
        (run) =>
          (!filter || run.status === filter) &&
          [run.title, run.objective, run.workspacePath]
            .join('\n')
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase())
      )
  return (
    <section className={recent ? styles.recentTasks : undefined}>
      <div className={styles.sectionHeading}>
        {recent ? (
          <h2>{t('taskLatest')}</h2>
        ) : (
          <h1 className={styles.heading}>{t('taskHistory')}</h1>
        )}
        {recent ? (
          <button className={styles.textButton} onClick={goToHistory}>
            {t('taskViewAll')} <TaskIcon name="arrow" size={14} />
          </button>
        ) : null}
      </div>
      {!recent && runs.length ? (
        <div className={styles.filters}>
          <div className={styles.search}>
            <IconSearchOutline16 />
            <input
              type="search"
              aria-label={t('taskSearchHistory')}
              placeholder={t('taskSearchHistory')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            aria-label={t('taskFilter')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">{t('taskAllStatus')}</option>
            {Object.entries(taskLabels).map(([status, key]) => (
              <option key={status} value={status}>
                {t(key)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {visible.length ? (
        <ul className={styles.historyList}>
          {visible.map((run) => (
            <li key={run.id}>
              <button type="button" className={styles.historyRow} onClick={() => viewTask(run.id)}>
                <span className={styles.docIcon}>
                  <TaskIcon name="file" size={20} />
                </span>
                <span className={styles.rowName}>
                  <strong>{run.title}</strong>
                  <small>
                    {folderName(run.workspacePath)} ·{' '}
                    {t('taskFileCount', { count: run.files.length + (run.basedOn ? 1 : 0) })}
                  </small>
                </span>
                <TaskStatus run={run} />
                <time dateTime={new Date(run.createdAt).toISOString()}>
                  {format.format(run.createdAt)}
                </time>
                <TaskIcon name="arrow" size={15} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.empty}>
          <TaskIcon name="history" size={28} />
          <p>
            {t(!ready ? 'taskHistoryLoading' : runs.length ? 'taskNoMatch' : 'taskHistoryEmpty')}
          </p>
          {ready && !runs.length ? (
            <Button size="m" variant="outlined" onClick={goToTasks}>
              {t('newTask')}
            </Button>
          ) : null}
        </div>
      )}
    </section>
  )
}
