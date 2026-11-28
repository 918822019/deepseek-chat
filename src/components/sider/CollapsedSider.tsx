import { IconPanelLeftOutline16, NewChatIcon } from '../base/icons.js'
import { TaskIcon } from '../tasks/TaskIcon.js'
import { goToChat } from '../../services/tasks/store.js'
import { useTranslate } from '../../i18n/index.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { newChat } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import styles from './Sider.module.css'

/** 收起后左上角的按钮组 */
export const CollapsedSider = ({ onNewTask }: { onNewTask?: () => void }) => {
  const t = useTranslate()
  return (
    <div className={styles.collapsed}>
      <div className={styles.collapsedGroup}>
        <IconButton
          size="m"
          tone="primary"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('expandSiderbarButton')}
          onClick={() => setSiderCollapsed(false)}
        />
        <IconButton
          size="m"
          tone="primary"
          icon={<NewChatIcon />}
          tooltip={t('newChat')}
          onClick={() => {
            if (onNewTask) {
              goToChat()
            }
            newChat()
          }}
        />
        {onNewTask ? (
          <IconButton
            size="m"
            tone="primary"
            icon={<TaskIcon name="tasks" size={16} />}
            tooltip={t('newTask')}
            onClick={onNewTask}
          />
        ) : null}
      </div>
    </div>
  )
}
