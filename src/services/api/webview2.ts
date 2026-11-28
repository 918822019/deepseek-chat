import { getDesktopBridge, isMacDesktop } from '../desktopBridge.js'

type RelayEvent =
  | { id: string; type: 'headers'; status: number; contentType: string | null }
  | { id: string; type: 'chunk'; data: string }
  | { id: string; type: 'end' }
  | { id: string; type: 'error'; message: string }

export function fetchWithDesktopRelay(url: string, init: RequestInit): Promise<Response> {
  const bridge = getDesktopBridge()
  const route =
    url === '/proxy/nvidia/v1/models' && init.method === 'GET'
      ? 'models'
      : url === '/proxy/nvidia/v1/chat/completions' && init.method === 'POST'
        ? 'chat'
        : null
  if (!bridge || !route) {
    return fetch(url, init)
  }
  if (isMacDesktop()) {
    const headers = new Headers(init.headers)
    headers.set('X-Workspace-Relay', '1')
    return fetch(url, { ...init, headers })
  }
  const { signal } = init
  if (signal?.aborted) {
    return Promise.reject(signal.reason)
  }

  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    let controller: ReadableStreamDefaultController<Uint8Array>
    let responseStarted = false
    const cleanup = () => {
      signal?.removeEventListener('abort', abort)
      bridge.removeEventListener('message', receive)
    }
    const cancel = () => {
      cleanup()
      bridge.postMessage({ Id: id, Type: 'cancel' })
    }
    const fail = (error: unknown) => {
      cleanup()
      if (responseStarted) {
        controller.error(error)
      } else {
        reject(error)
      }
    }
    const abort = () => {
      fail(signal?.reason)
      cancel()
    }
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value
      },
      cancel,
    })
    const receive = (event: MessageEvent<unknown>) => {
      const data = event.data as RelayEvent | null
      if (data?.id !== id) {
        return
      }
      switch (data.type) {
        case 'headers': {
          const { status, contentType } = data
          const body = status === 204 || status === 205 ? null : stream
          resolve(
            new Response(body, { status, headers: contentType ? { 'Content-Type': contentType } : {} })
          )
          responseStarted = true
          break
        }
        case 'chunk':
          controller.enqueue(Uint8Array.from(atob(data.data), (byte) => byte.charCodeAt(0)))
          break
        case 'end':
          controller.close()
          cleanup()
          break
        case 'error':
          fail(new Error(data.message))
          break
      }
    }
    bridge.addEventListener('message', receive)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      bridge.postMessage({
        Id: id,
        Type: 'request',
        Route: route,
        Authorization: new Headers(init.headers).get('Authorization'),
        Body: typeof init.body === 'string' ? init.body : null,
      })
    } catch (error) {
      fail(error)
    }
  })
}
