import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { TranslationMessage } from '../../i18n/index.js'
import type { TaskDocument } from './workspace.js'

export type TaskStatus = 'running' | 'completed' | 'failed' | 'stopped' | 'interrupted' | 'unsaved'
export type TaskEvent = { at: number; message: TranslationMessage }
export type PriorDocument = { id: string; title: string }
export type TaskRun = {
  id: string
  title: string
  objective: string
  workspaceId: string
  workspacePath: string
  files: string[]
  model: string
  createdAt: number
  updatedAt: number
  status: TaskStatus
  events: TaskEvent[]
  error?: TranslationMessage
  hasMarkdown?: boolean
  document?: TaskDocument
  basedOn?: PriorDocument
}

interface TasksDB extends DBSchema {
  runs: { key: string; value: TaskRun }
  markdown: { key: string; value: string }
}

let connection: Promise<IDBPDatabase<TasksDB>> | undefined
const database = () =>
  (connection ??= openDB<TasksDB>('desktop-workspace-tasks', 1, {
    upgrade(db) {
      db.createObjectStore('runs', { keyPath: 'id' })
      db.createObjectStore('markdown')
    },
  }).catch((error: unknown) => {
    connection = undefined
    throw error
  }))

export const loadRuns = async () => (await database()).getAll('runs')
export const loadRun = async (id: string) => (await database()).get('runs', id)
export const loadMarkdown = async (id: string) => (await database()).get('markdown', id)

export async function saveRun(run: TaskRun, markdown?: string) {
  const db = await database()
  const tx = db.transaction(['runs', 'markdown'], 'readwrite')
  const runs = tx.objectStore('runs')
  const current = await runs.get(run.id)
  if (current && current.updatedAt > run.updatedAt) {
    await tx.done
    return current
  }
  await Promise.all([
    runs.put(run),
    markdown !== undefined && tx.objectStore('markdown').put(markdown, run.id),
    tx.done,
  ])
  return run
}
