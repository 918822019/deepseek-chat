import { getDesktopBridge } from '../desktopBridge.js'
import type { Locale } from '../settings.js'

const CHANNEL = 'task-workspace'

export type WorkspaceFile = { name: string; bytes: number }
export type Workspace = {
  id: string
  path: string
  files: WorkspaceFile[]
  limited: boolean
  skipped: number
  inputLimit: number
}
export type TaskDocument = { name: string; path: string }
export type SourceText = { content: string; bytes: number }

type WorkspaceRequest =
  | { Action: 'select'; Locale: Locale }
  | { Action: 'restore'; WorkspaceId: string }
  | { Action: 'read'; WorkspaceId: string; Name: string }
  | { Action: 'save'; WorkspaceId: string; TaskId: string; Title: string; Content: string }
  | { Action: 'open' | 'reveal'; WorkspaceId: string; TaskId: string; Title: string }

type WorkspaceError =
  | 'missing'
  | 'tooLarge'
  | 'encoding'
  | 'format'
  | 'empty'
  | 'access'
  | 'workspaceLost'
  | 'outputChanged'
  | 'failed'

export class TaskWorkspaceError extends Error {
  constructor(readonly code: WorkspaceError) {
    super(code)
    this.name = 'TaskWorkspaceError'
  }
}

function request<T>(body: WorkspaceRequest, signal?: AbortSignal): Promise<T> {
  const bridge = getDesktopBridge()
  if (!bridge) {
    return Promise.reject(new TaskWorkspaceError('failed'))
  }
  if (signal?.aborted) {
    return Promise.reject(signal.reason)
  }

  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    const cleanup = () => {
      bridge.removeEventListener('message', receive)
      signal?.removeEventListener('abort', abort)
    }
    const abort = () => {
      cleanup()
      reject(signal?.reason)
    }
    const receive = ({ data }: MessageEvent<unknown>) => {
      const reply = data as {
        id?: string
        channel?: string
        value: T
        error?: WorkspaceError
      } | null
      if (reply?.id !== id || reply.channel !== CHANNEL) {
        return
      }
      cleanup()
      if (reply.error) {
        reject(new TaskWorkspaceError(reply.error))
      } else {
        resolve(reply.value)
      }
    }
    bridge.addEventListener('message', receive)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      bridge.postMessage({ Id: id, Type: CHANNEL, ...body })
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

export const selectWorkspace = (locale: Locale) =>
  request<Workspace | null>({ Action: 'select', Locale: locale })

export const restoreWorkspace = (id: string) =>
  request<Workspace>({ Action: 'restore', WorkspaceId: id })

export const readSource = (id: string, name: string, signal: AbortSignal) =>
  request<SourceText>({ Action: 'read', WorkspaceId: id, Name: name }, signal)

export type DocumentRef = { workspaceId: string; id: string; title: string }

export const saveDocument = (run: DocumentRef, content: string) =>
  request<TaskDocument>({
    Action: 'save',
    WorkspaceId: run.workspaceId,
    TaskId: run.id,
    Title: run.title,
    Content: content,
  })

export const openDocument = (run: DocumentRef, reveal = false) =>
  request<null>({
    Action: reveal ? 'reveal' : 'open',
    WorkspaceId: run.workspaceId,
    TaskId: run.id,
    Title: run.title,
  })
