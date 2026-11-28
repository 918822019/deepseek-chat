import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconPanelLeftOutline16, IconSettingsOutline16, NewChatIcon } from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { newChat, removeSession, useChatStore } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import {
  goToChat,
  goToHistory,
  taskLabels,
  useTaskStore,
  viewTask,
} from '../../services/tasks/store.js'
import { TaskIcon } from '../tasks/TaskIcon.js'
import styles from './Sider.module.css'

/** 展开的侧边栏：名称与收起按钮、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = ({
  mobile = false,
  onNewTask,
}: {
  mobile?: boolean
  onNewTask?: () => void
}) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const page = useTaskStore((state) => state.page)
  const runs = useTaskStore((state) => state.runs)
  const selectedTask = useTaskStore((state) => state.selectedId)
  const running = useTaskStore(
    (state) => state.runs.filter((run) => run.status === 'running').length
  )
  const [now, setNow] = useState(Date.now)
  const groups = useMemo(() => groupSessions(sessions, now, t), [sessions, now, t])
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.appName}>{t(onNewTask ? 'desktopWorkspace' : 'appName')}</div>
        <IconButton
          size="m"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('collapseSiderbarButton')}
          tooltipPlacement="bottom"
          onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
        />
      </div>
      {onNewTask ? (
        <button type="button" className={clsx(styles.newChat, styles.newTask)} onClick={onNewTask}>
          <span className={styles.newChatIcon}>
            <TaskIcon name="add" size={16} />
          </span>
          {t('newTask')}
        </button>
      ) : null}
      <button
        type="button"
        className={styles.newChat}
        onClick={() => {
          if (onNewTask) {
            goToChat()
          }
          newChat()
          closeMobileSider()
        }}
      >
        <span className={styles.newChatIcon}>
          <NewChatIcon />
        </span>
        {t('newChat')}
      </button>
      {onNewTask ? (
        <button
          type="button"
          className={styles.historyNav}
          aria-current={page === 'history' ? 'page' : undefined}
          onClick={() => {
            goToHistory()
            closeMobileSider()
          }}
        >
          <TaskIcon name="history" size={17} />
          {t('taskHistory')}
          {running ? <small>{t('taskActiveCount', { count: running })}</small> : null}
        </button>
      ) : null}
      <div className={styles.listWrap}>
        <div className={styles.list}>
          {onNewTask && (page === 'chat' || page === 'detail') && runs.length > 0 ? (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>{t('taskLatest')}</div>
              {runs.slice(0, 5).map((run) => (
                <button
                  key={run.id}
                  className={styles.recentLink}
                  aria-current={page === 'detail' && selectedTask === run.id ? 'page' : undefined}
                  title={run.title + ' · ' + t(taskLabels[run.status])}
                  onClick={() => {
                    viewTask(run.id)
                    closeMobileSider()
                  }}
                >
                  <TaskIcon name="file" size={15} />
                  <span>{run.title}</span>
                </button>
              ))}
            </div>
          ) : null}
          {groups.map((group) => (
            <div key={group.key} className={styles.section}>
              <div className={styles.sectionHeader}>{group.label}</div>
              {group.sessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  active={session.id === activeId && (!onNewTask || page === 'chat')}
                  onOpen={onNewTask ? goToChat : undefined}
                  onDelete={() => setDeleting(session)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.bottom}>
        <button type="button" className={styles.settings} onClick={() => openSettings('general')}>
          <span className={styles.settingsIcon}>
            <IconSettingsOutline16 />
          </span>
          <span className={styles.settingsLabel}>{t('settings')}</span>
        </button>
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：浮在页面上方，点空白区域关闭。 */
export const MobileSider = ({ onNewTask }: { onNewTask?: () => void }) => {
  const open = useMobileSider((state) => state.open)
  if (!open) {
    return null
  }
  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div className={styles.drawer}>
        <Sider mobile onNewTask={onNewTask} />
      </div>
    </>
  )
}
