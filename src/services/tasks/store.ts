import { create } from 'zustand'
import type { TranslationKey, TranslationMessage } from '../../i18n/index.js'
import { ApiError } from '../api/client.js'
import { resolveProvider } from '../api/providers.js'
import { DEFAULT_CHAT_MODEL } from '../api/types.js'
import { useSettings } from '../settings.js'
import { generateTaskMarkdown, type TaskSource } from './generate.js'
import {
  loadMarkdown,
  loadRun,
  loadRuns,
  saveRun,
  type PriorDocument,
  type TaskRun,
} from './history.js'
import {
  readSource,
  restoreWorkspace,
  saveDocument,
  selectWorkspace,
  TaskWorkspaceError,
  type Workspace,
} from './workspace.js'

type Draft = {
  objective: string
  workspaceId?: string
  path?: string
  files: string[]
  basedOn?: PriorDocument
}
type Page = 'compose' | 'history' | 'detail' | 'chat'
export type LiveTask = {
  phase: 'reading' | 'batch' | 'writing' | 'saving'
  message: TranslationMessage
  text?: string
}
type State = {
  page: Page
  selectedId: string | null
  runs: TaskRun[]
  live: Record<string, LiveTask>
  draft: Draft
  workspace: Workspace | null
  picking: boolean
  folderMessage: TranslationMessage | null
  historyError: boolean
  ready: boolean
}

const draftKey = 'desktop-workspace:draft'
const emptyDraft = (): Draft => ({ objective: '', files: [] })
export const useTaskStore = create<State>(() => ({
  page: 'compose',
  selectedId: null,
  runs: [],
  live: {},
  draft: emptyDraft(),
  workspace: null,
  picking: false,
  folderMessage: null,
  historyError: false,
  ready: false,
}))
const { getState: get, setState: set } = useTaskStore
const controllers = new Map<string, AbortController>()
const dirty = new Map<string, { run: TaskRun; markdown?: string }>()
let channel: BroadcastChannel | undefined
let initialized: Promise<void> | undefined
let selectionVersion = 0

export const taskLabels: Record<TaskRun['status'], TranslationKey> = {
  running: 'taskInProgress',
  completed: 'taskDone',
  failed: 'taskFailed',
  stopped: 'taskWasStopped',
  interrupted: 'taskInterrupted',
  unsaved: 'taskAwaitingSave',
}

function mergeRun(run: TaskRun) {
  set((state) => {
    const index = state.runs.findIndex((other) => other.id === run.id)
    if (index < 0) {
      return { runs: [...state.runs, run].sort((a, b) => b.createdAt - a.createdAt) }
    }
    if (state.runs[index] === run || state.runs[index].updatedAt > run.updatedAt) {
      return state
    }
    const runs = state.runs.slice()
    runs[index] = run
    return { runs }
  })
}

async function commit(run: TaskRun, markdown?: string) {
  mergeRun(run)
  const change = { run, markdown: markdown ?? dirty.get(run.id)?.markdown }
  dirty.set(run.id, change)
  try {
    const stored = await saveRun(run, change.markdown)
    if (stored !== run) {
      mergeRun(stored)
    }
    if (dirty.get(run.id) === change) {
      dirty.delete(run.id)
    }
    channel?.postMessage({ changed: run.id })
  } catch {
    set({ historyError: true })
  }
}

export const taskMarkdown = async (id: string) =>
  dirty.get(id)?.markdown ?? (await loadMarkdown(id))
const withTaskLock = (id: string, action: () => Promise<void>) =>
  navigator.locks.request('desktop-task:' + id, { ifAvailable: true }, async (lock) => {
    if (lock) {
      await action()
    }
  })

export function initTasks() {
  initialized ??= (async () => {
    if (!channel) {
      channel = new BroadcastChannel('desktop-workspace-tasks')
      channel.onmessage = async ({ data }: MessageEvent<{ changed?: string; stop?: string }>) => {
        if (data.stop) {
          controllers.get(data.stop)?.abort()
        }
        if (data.changed && !dirty.has(data.changed)) {
          try {
            const run = await loadRun(data.changed)
            if (run && !dirty.has(run.id) && !controllers.has(run.id)) {
              mergeRun(run)
            }
          } catch {
            set({ historyError: true })
          }
        }
      }
    }
    try {
      const stored = await loadRuns()
      const byId = new Map(stored.map((run) => [run.id, run]))
      for (const run of get().runs) {
        if ((byId.get(run.id)?.updatedAt ?? 0) <= run.updatedAt) {
          byId.set(run.id, run)
        }
      }
      set({ runs: [...byId.values()].sort((a, b) => b.createdAt - a.createdAt) })
      for (const run of stored) {
        if (run.status === 'running') {
          await withTaskLock(run.id, async () => {
            const latest = await loadRun(run.id)
            if (latest?.status === 'running') {
              const message = { key: 'taskInterruptedMessage' } as const
              await commit(
                event(latest, message, {
                  status: 'interrupted',
                  error: message,
                })
              )
            }
          })
        }
      }
    } catch {
      set({ historyError: true })
    }
    if (!get().ready) {
      let draft: Draft = emptyDraft()
      try {
        const saved = JSON.parse(localStorage.getItem(draftKey) ?? 'null') as Partial<Draft> | null
        if (saved && typeof saved.objective === 'string' && Array.isArray(saved.files)) {
          draft = {
            objective: saved.objective,
            files: saved.files.filter((f) => typeof f === 'string'),
            workspaceId: saved.workspaceId,
            path: saved.path,
            basedOn: saved.basedOn,
          }
        }
      } catch {
        /* An unavailable draft must not prevent opening task history. */
      }
      set({ draft, ready: true })
      if (draft.workspaceId) {
        await pickFolder(draft.workspaceId, draft.files)
      }
    }
  })()
  return initialized
}

export async function retryHistory() {
  set({ historyError: false })
  for (const change of [...dirty.values()]) {
    await commit(change.run, change.markdown)
  }
  initialized = undefined
  await initTasks()
}

export function setDraft(values: Partial<Draft>) {
  const draft = { ...get().draft, ...values }
  set({ draft })
  try {
    localStorage.setItem(draftKey, JSON.stringify(draft))
  } catch {
    /* The draft remains editable in memory. */
  }
}

export const goToChat = () => set({ page: 'chat' })
export const goToTasks = () => set({ page: 'compose' })
export const goToHistory = () => set({ page: 'history' })
export const viewTask = (id: string) => set({ page: 'detail', selectedId: id })

export async function pickFolder(savedId?: string, previousFiles?: string[]) {
  const version = ++selectionVersion
  set({ picking: true, folderMessage: null })
  try {
    const workspace = savedId
      ? await restoreWorkspace(savedId)
      : await selectWorkspace(useSettings.getState().locale)
    if (!workspace || version !== selectionVersion) {
      return
    }
    const names = workspace.files.map((file) => file.name)
    const allowed = new Set(names)
    const previous =
      previousFiles ?? (get().draft.workspaceId === workspace.id ? get().draft.files : undefined)
    const files = previous
      ? previous.filter((name) => allowed.has(name))
      : names.length <= 12
        ? names
        : []
    set({
      workspace,
      folderMessage:
        previous && files.length !== previous.length
          ? { key: 'taskFilesMissing', params: { count: previous.length - files.length } }
          : null,
    })
    setDraft({ workspaceId: workspace.id, path: workspace.path, files })
  } catch {
    if (version === selectionVersion) {
      set({ folderMessage: { key: 'taskFolderFailed' } })
    }
  } finally {
    if (version === selectionVersion) {
      set({ picking: false })
    }
  }
}

export async function reuseTask(run: TaskRun, retry = false) {
  set({ page: 'compose', workspace: null })
  setDraft({
    objective: run.objective,
    workspaceId: run.workspaceId,
    path: run.workspacePath,
    files: run.files,
    basedOn: run.basedOn,
  })
  await pickFolder(run.workspaceId, run.files)
  const state = get()
  if (
    retry &&
    state.page === 'compose' &&
    !state.folderMessage &&
    state.workspace?.id === run.workspaceId &&
    state.draft.objective === run.objective &&
    state.draft.files.length === run.files.length
  ) {
    startTask()
  }
}

export function reviseTask(run: TaskRun) {
  set({ page: 'compose', workspace: null })
  setDraft({
    objective: '',
    workspaceId: run.workspaceId,
    path: run.workspacePath,
    files: [],
    basedOn: { id: run.id, title: run.title },
  })
  void pickFolder(run.workspaceId, [])
}

function setLive(id: string, live?: LiveTask) {
  set((state) => {
    if (live) {
      return { live: { ...state.live, [id]: live } }
    }
    const { [id]: previous, ...remaining } = state.live
    return previous ? { live: remaining } : state
  })
}

function event(run: TaskRun, message: TranslationMessage, values: Partial<TaskRun> = {}): TaskRun {
  const now = Math.max(Date.now(), run.updatedAt + 1)
  return { ...run, ...values, updatedAt: now, events: [...run.events, { at: now, message }] }
}

function errorMessage(cause: unknown, fallback: TranslationMessage): TranslationMessage {
  if (cause instanceof ApiError) {
    if (cause.localMessage) {
      return cause.localMessage
    }
    if (cause.status) {
      return { key: 'taskModelStatus', params: { status: cause.status } }
    }
  }
  if (cause instanceof TaskWorkspaceError) {
    const keys: Partial<Record<typeof cause.code, TranslationKey>> = {
      missing: 'taskReadMissing',
      tooLarge: 'taskReadTooLarge',
      encoding: 'taskReadEncoding',
      format: 'taskReadFormat',
      empty: 'taskReadEmpty',
      outputChanged: 'taskOutputChanged',
    }
    const key = keys[cause.code]
    if (key) {
      return { key, params: fallback.params }
    }
  }
  return fallback
}

async function writeDocument(run: TaskRun, markdown: string) {
  setLive(run.id, { phase: 'saving', message: { key: 'taskSaving' } })
  try {
    const document = await saveDocument(run, markdown)
    await commit(
      event(run, { key: 'taskCompleted' }, { document, error: undefined, status: 'completed' })
    )
  } catch (cause) {
    const error = errorMessage(cause, { key: 'taskSaveFailed' })
    await commit(event(run, error, { status: 'unsaved', error }))
  } finally {
    setLive(run.id)
  }
}

export async function retrySave(id: string) {
  await withTaskLock(id, async () => {
    const run = dirty.get(id)?.run ?? (await loadRun(id))
    if (run?.status !== 'unsaved') {
      if (run) {
        mergeRun(run)
      }
      return
    }
    const markdown = await taskMarkdown(id)
    if (!markdown) {
      throw new Error('Missing saved Markdown')
    }
    await writeDocument(run, markdown)
  }).catch(() => set({ historyError: true }))
}

export function stopTask(id: string) {
  controllers.get(id)?.abort()
  channel?.postMessage({ stop: id })
}

export function startTask() {
  const { draft, workspace, picking } = get()
  const { apiKey, provider, providerModel, providerBaseUrl, locale } = useSettings.getState()
  const objective = draft.objective.trim()
  if (
    !apiKey ||
    picking ||
    !workspace ||
    draft.workspaceId !== workspace.id ||
    (!draft.basedOn && !draft.files.length) ||
    !objective
  ) {
    return
  }
  const selected = new Set(draft.files)
  const files = workspace.files.filter((file) => selected.has(file.name)).map((file) => file.name)
  if (files.length !== selected.size) {
    return
  }
  const endpoint = resolveProvider(provider, { model: providerModel, baseUrl: providerBaseUrl })
  const id = crypto.randomUUID()
  const now = Date.now()
  let run: TaskRun = {
    id,
    objective,
    title: objective.split(/\r?\n/)[0].slice(0, 80),
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    files,
    basedOn: draft.basedOn,
    model: endpoint?.model ?? DEFAULT_CHAT_MODEL,
    createdAt: now,
    updatedAt: now,
    status: 'running',
    events: [{ at: now, message: { key: 'taskStarted' } }],
  }
  const controller = new AbortController()
  const { signal } = controller
  controllers.set(id, controller)
  mergeRun(run)
  viewTask(id)
  setDraft({ objective: '', basedOn: undefined })
  void withTaskLock(id, async () => {
    let failure: TranslationMessage = { key: 'taskGenerateFailed' }
    try {
      await commit(run)
      const sources: TaskSource[] = []
      let bytes = 0
      if (run.basedOn) {
        failure = { key: 'taskBaseMissing' }
        const content = await taskMarkdown(run.basedOn.id)
        if (!content) {
          throw new Error('The prior version is unavailable')
        }
        sources.push({ name: run.basedOn.title, content })
        bytes = new TextEncoder().encode(content).byteLength
        run = event(run, { key: 'taskBaseRead', params: { name: run.basedOn.title } })
      }
      let read = 0
      for (const name of files) {
        failure = { key: 'taskReadFailed', params: { name } }
        const message: TranslationMessage = {
          key: 'taskReading',
          params: { name, index: ++read, total: files.length },
        }
        setLive(id, { phase: 'reading', message })
        const source = await readSource(workspace.id, name, signal)
        signal.throwIfAborted()
        bytes += source.bytes
        if (bytes > workspace.inputLimit) {
          throw new ApiError('protocol', {
            key: 'taskInputLimit',
            params: { limit: workspace.inputLimit / 1024 },
          })
        }
        sources.push({ name, content: source.content })
        run = event(run, { key: 'taskFileRead', params: { name } })
        mergeRun(run)
      }
      await commit(run)
      failure = { key: 'taskGenerateFailed' }
      let lastRender = 0
      const markdown = await generateTaskMarkdown({
        apiKey,
        provider: endpoint,
        locale,
        objective,
        sources,
        signal,
        priorTitle: run.basedOn?.title,
        async onBatch(index, total, round) {
          const message: TranslationMessage = { key: 'taskBatch', params: { index, total, round } }
          run = event(run, message)
          setLive(id, { phase: 'batch', message })
          await commit(run)
        },
        onText(text) {
          if (!text || Date.now() - lastRender >= 100) {
            lastRender = Date.now()
            setLive(id, { phase: 'writing', message: { key: 'taskGenerating' }, text })
          }
        },
      })
      signal.throwIfAborted()
      const title =
        markdown
          .match(/^#\s+(.+)$/m)?.[1]
          ?.trim()
          .slice(0, 80) || run.title
      run = event(run, { key: 'taskDraftReady' }, { status: 'unsaved', title, hasMarkdown: true })
      await commit(run, markdown)
      await writeDocument(run, markdown)
    } catch (cause) {
      const error: TranslationMessage = signal.aborted
        ? { key: 'taskStopped' }
        : errorMessage(cause, failure)
      await commit(event(run, error, { status: signal.aborted ? 'stopped' : 'failed', error }))
    }
  })
    .catch(async () => {
      const error = { key: 'taskGenerateFailed' } as const
      await commit(event(run, error, { status: 'failed', error }))
    })
    .finally(() => {
      controllers.delete(id)
      setLive(id)
    })
}
