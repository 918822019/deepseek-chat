import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { goToHistory, goToTasks, retryHistory, useTaskStore } from '../../services/tasks/store.js'
import { IconMenuOutline20 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import { TaskComposer } from './TaskComposer.js'
import { TaskDetail } from './TaskDetail.js'
import { TaskHistory } from './TaskHistory.js'
import { TaskIcon } from './TaskIcon.js'
import styles from './Workbench.module.css'

export function TaskWorkbench({ collapsed }: { collapsed: boolean }) {
  const t = useTranslate()
  const mobile = useIsMobile()
  const page = useTaskStore((s) => s.page)
  const selectedId = useTaskStore((s) => s.selectedId)
  const run = useTaskStore((s) => s.runs.find((task) => task.id === s.selectedId))
  const historyError = useTaskStore((s) => s.historyError)
  const scroll = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroll.current?.scrollTo(0, 0)
  }, [page, selectedId])
  return (
    <section className={styles.workbench}>
      <header className={clsx(styles.topbar, collapsed && styles.collapsed)}>
        <div className={styles.barLabel}>
          {mobile ? (
            <IconButton
              size="m"
              icon={<IconMenuOutline20 />}
              aria-label={t('expandSiderbarButton')}
              onClick={openMobileSider}
            />
          ) : (
            <TaskIcon name="tasks" />
          )}
          <span>{t('taskWorkspace')}</span>
        </div>
        <button className={styles.topAction} onClick={page === 'history' ? goToTasks : goToHistory}>
          <TaskIcon name={page === 'history' ? 'add' : 'history'} size={16} />
          {t(page === 'history' ? 'newTask' : 'taskHistory')}
        </button>
      </header>
      <div className={styles.scroll} ref={scroll}>
        <div className={styles.body}>
          {historyError ? (
            <div className={styles.notice} role="alert">
              {t('taskHistoryFailed')}
              <button className={styles.textButton} onClick={() => void retryHistory()}>
                {t('retry')}
              </button>
            </div>
          ) : null}
          {page === 'compose' ? (
            <>
              <TaskComposer />
              <TaskHistory recent />
            </>
          ) : page === 'detail' && run ? (
            <TaskDetail key={run.id} run={run} />
          ) : (
            <TaskHistory />
          )}
        </div>
      </div>
    </section>
  )
}
