import { useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import { PROVIDER_PRESETS } from '../../services/api/providers.js'
import { pickFolder, setDraft, startTask, useTaskStore } from '../../services/tasks/store.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { IconRefreshOutline16, IconSearchOutline16 } from '../base/icons.js'
import { TaskIcon } from './TaskIcon.js'
import styles from './Workbench.module.css'

const templates: [TranslationKey, TranslationKey][] = [
  ['taskMeeting', 'taskMeetingGoal'],
  ['taskWeekly', 'taskWeeklyGoal'],
  ['taskCompare', 'taskCompareGoal'],
]

export const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

export function TaskComposer() {
  const t = useTranslate()
  const draft = useTaskStore((s) => s.draft)
  const workspace = useTaskStore((s) => s.workspace)
  const runs = useTaskStore((s) => s.runs)
  const picking = useTaskStore((s) => s.picking)
  const ready = useTaskStore((s) => s.ready)
  const message = useTaskStore((s) => s.folderMessage)
  const provider = useSettings((s) => s.provider)
  const [query, setQuery] = useState('')
  const selected = new Set(draft.files)
  const visible =
    workspace?.files.filter((f) =>
      f.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    ) ?? []
  const allVisible = visible.length > 0 && visible.every((f) => selected.has(f.name))
  const recent = [...new Map(runs.map((r) => [r.workspaceId, r.workspacePath])).entries()]
    .filter(([id]) => id !== workspace?.id)
    .slice(0, 3)

  const toggle = (names: string[], checked: boolean) => {
    const next = new Set(selected)
    for (const name of names) {
      if (checked) {
        next.add(name)
      } else {
        next.delete(name)
      }
    }
    setDraft({ files: [...next] })
  }

  return (
    <>
      <h1 className={styles.heading}>{t(draft.basedOn ? 'taskRevise' : 'newTask')}</h1>
      <div className={styles.composeGrid}>
        <form
          className={styles.card}
          onSubmit={(e) => {
            e.preventDefault()
            if (ensureApiKey()) {
              startTask()
            }
          }}
        >
          {draft.basedOn ? (
            <div className={styles.basedOn}>
              <TaskIcon name="file" size={17} />
              <span>{t('taskBasedOn', { name: draft.basedOn.title })}</span>
              <button
                type="button"
                className={styles.textButton}
                onClick={() => setDraft({ basedOn: undefined })}
              >
                {t('taskRemoveReference')}
              </button>
            </div>
          ) : null}
          <h2>
            <label htmlFor="task-objective">
              {t(draft.basedOn ? 'taskRevisionGoal' : 'taskObjective')}
            </label>
          </h2>
          <textarea
            id="task-objective"
            className={styles.objective}
            value={draft.objective}
            disabled={!ready}
            maxLength={4000}
            placeholder={t(draft.basedOn ? 'taskRevisionExample' : 'taskObjectiveExample')}
            onChange={(e) => setDraft({ objective: e.currentTarget.value })}
          />
          {!draft.basedOn && !draft.objective.trim() ? (
            <div className={styles.templates}>
              {templates.map(([label, prompt]) => (
                <button
                  key={label}
                  type="button"
                  disabled={!ready}
                  onClick={() => setDraft({ objective: t(prompt) })}
                >
                  {t(label)}
                </button>
              ))}
            </div>
          ) : null}
          <div className={styles.composeFooter}>
            <p className={styles.note}>
              {t(draft.basedOn ? 'taskRevisionNotice' : 'taskDataNotice', {
                provider: PROVIDER_PRESETS[provider].label,
              })}
            </p>
            <Button
              type="submit"
              disabled={
                !ready ||
                picking ||
                !workspace ||
                (!selected.size && !draft.basedOn) ||
                !draft.objective.trim()
              }
            >
              {t('taskStartAction')} <TaskIcon name="arrow" size={16} />
            </Button>
          </div>
        </form>
        <section className={styles.card}>
          <div className={styles.cardTitle}>
            <h2>{t('taskSources')}</h2>
            {workspace ? (
              <IconButton
                icon={<IconRefreshOutline16 />}
                disabled={picking}
                tooltip={t('taskRefresh')}
                onClick={() => void pickFolder(workspace.id, draft.files)}
              />
            ) : null}
          </div>
          <button
            className={styles.folder}
            type="button"
            aria-label={t(workspace ? 'taskChangeFolder' : 'taskChooseFolder')}
            disabled={picking || !ready}
            onClick={() => {
              setQuery('')
              void pickFolder()
            }}
          >
            <span className={styles.folderIcon}>
              <TaskIcon name="folder" size={23} />
            </span>
            <span className={styles.folderText}>
              <strong>
                {picking
                  ? t('taskPickingFolder')
                  : workspace
                    ? folderName(workspace.path)
                    : t('taskChooseFolder')}
              </strong>
              <small title={draft.path}>
                {workspace?.path || draft.path || t('taskSourceTypes')}
              </small>
            </span>
            {workspace ? (
              <small className={styles.folderChange}>{t('taskChangeFolder')}</small>
            ) : (
              <TaskIcon name="arrow" size={15} />
            )}
          </button>
          {workspace && workspace.files.length > 0 ? (
            <div className={styles.filesPanel}>
              <div className={styles.search}>
                <IconSearchOutline16 />
                <input
                  type="search"
                  value={query}
                  aria-label={t('taskFindFiles')}
                  placeholder={t('taskFindFiles')}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className={styles.selection}>
                <span>
                  {t('taskSelection', { selected: selected.size, total: workspace.files.length })}
                </span>
                <button
                  type="button"
                  className={styles.textButton}
                  disabled={picking || !visible.length}
                  onClick={() =>
                    toggle(
                      visible.map((f) => f.name),
                      !allVisible
                    )
                  }
                >
                  {t(allVisible ? 'taskUncheckVisible' : 'taskCheckVisible')}
                </button>
              </div>
              <div className={styles.files}>
                {visible.map((file) => (
                  <label key={file.name} className={styles.file}>
                    <input
                      type="checkbox"
                      disabled={picking}
                      checked={selected.has(file.name)}
                      onChange={(e) => toggle([file.name], e.currentTarget.checked)}
                    />
                    <span title={file.name}>{file.name}</span>
                    <small>
                      {file.bytes < 1024 * 1024
                        ? Math.ceil(file.bytes / 1024) + ' KB'
                        : (file.bytes / (1024 * 1024)).toFixed(1) + ' MB'}
                    </small>
                  </label>
                ))}
                {!visible.length ? <p className={styles.note}>{t('taskNoMatch')}</p> : null}
              </div>
            </div>
          ) : workspace ? (
            <p className={styles.note}>{t('taskNoSources')}</p>
          ) : null}
          {workspace?.limited ? <p className={styles.note}>{t('taskScanLimited')}</p> : null}
          {workspace && workspace.skipped > 0 ? (
            <p className={styles.note}>{t('taskSkippedFiles', { count: workspace.skipped })}</p>
          ) : null}
          {message ? (
            <p className={styles.notice} role="status">
              {t(message.key, message.params)}
            </p>
          ) : null}
          {recent.length ? (
            <div className={styles.recentFolders}>
              <span>{t('taskRecentFolders')}</span>
              {recent.map(([id, path]) => (
                <button
                  type="button"
                  disabled={picking}
                  key={id}
                  title={path}
                  onClick={() => {
                    setQuery('')
                    void pickFolder(id)
                  }}
                >
                  <TaskIcon name="folder" size={15} />
                  {folderName(path)}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </>
  )
}
