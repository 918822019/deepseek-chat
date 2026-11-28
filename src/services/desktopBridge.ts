type DesktopBridge = {
  postMessage(message: object): void
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
}

type MacHandler = { postMessage(message: object): Promise<unknown> }

const macHandler = () =>
  location.protocol === 'http:' && location.hostname === '127.0.0.1'
    ? (window as Window & { webkit?: { messageHandlers?: { workspace?: MacHandler } } }).webkit
        ?.messageHandlers?.workspace
    : undefined

const events = new EventTarget()
const macBridge: DesktopBridge = {
  postMessage(message) {
    const handler = macHandler()
    if (!handler) {
      throw new Error('Workspace is unavailable')
    }
    const send = (data: unknown) => events.dispatchEvent(new MessageEvent('message', { data }))
    void handler.postMessage(message).then(send, () => {
      send({ id: (message as { Id?: string }).Id, channel: 'task-workspace', error: 'failed' })
    })
  },
  addEventListener: (type, listener) => events.addEventListener(type, listener as EventListener),
  removeEventListener: (type, listener) =>
    events.removeEventListener(type, listener as EventListener),
}

export const isMacDesktop = () => Boolean(macHandler())

export const getDesktopBridge = () =>
  location.origin === 'https://desktop.chat-demo.localhost'
    ? (window as Window & { chrome?: { webview?: DesktopBridge } }).chrome?.webview
    : isMacDesktop()
      ? macBridge
      : undefined
