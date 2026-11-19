import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, net, protocol, session, shell } from 'electron'

const origin = 'app://chat'
const indexUrl = `${origin}/index.html`
const nvidiaPrefix = '/proxy/nvidia'
const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "connect-src 'self' https: http:",
  "img-src 'self' data: blob: https: http:",
  "media-src 'self' blob:",
].join('; ')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
])

const isAppUrl = (value) => {
  const url = URL.parse(value)
  return url?.protocol === 'app:' && url.host === 'chat' && !url.username && !url.password
}

async function fetchNvidia(request, url) {
  const route = `${request.method} ${url.pathname}`
  if (route !== 'GET /proxy/nvidia/v1/models' && route !== 'POST /proxy/nvidia/v1/chat/completions') {
    return new Response(null, { status: 404 })
  }
  const headers = new Headers()
  for (const name of ['authorization', 'content-type', 'accept']) {
    const value = request.headers.get(name)
    if (value) {
      headers.set(name, value)
    }
  }
  try {
    const upstream = await fetch(`https://integrate.api.nvidia.com${url.pathname.slice(nvidiaPrefix.length)}${url.search}`, {
      method: request.method,
      headers,
      body: request.method === 'POST' ? await request.text() : undefined,
      redirect: 'error',
      signal: request.signal,
    })
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream' },
    })
  } catch {
    return Response.json({ error: { message: 'Could not connect to NVIDIA NIM' } }, { status: 502 })
  }
}

async function serveApp(request) {
  if (!isAppUrl(request.url)) {
    return new Response(null, { status: 404 })
  }
  const url = new URL(request.url)
  if (url.pathname.startsWith(`${nvidiaPrefix}/`)) {
    return fetchNvidia(request, url)
  }
  // The build emits only these files. Keep local files outside dist inaccessible.
  if (request.method !== 'GET' || !/^\/(?:index\.html|static\/[\w./-]+)$/.test(url.pathname)) {
    return new Response(null, { status: 404 })
  }
  const file = path.join(app.getAppPath(), 'dist', url.pathname.slice(1))
  try {
    const response = await net.fetch(pathToFileURL(file).href)
    const headers = new Headers(response.headers)
    headers.set('content-security-policy', contentSecurityPolicy)
    return new Response(response.body, { status: response.status, headers })
  } catch {
    return new Response(null, { status: 404 })
  }
}

function openExternal(url) {
  const protocol = URL.parse(url)?.protocol
  if (protocol === 'https:' || protocol === 'http:') {
    void shell.openExternal(url).catch(() => {})
  }
}

function createWindow() {
  const window = new BrowserWindow({
    title: 'Chat Demo',
    width: 1180,
    height: 820,
    minWidth: 420,
    minHeight: 520,
    autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  window.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame && event.url === indexUrl) {
      return
    }
    event.preventDefault()
    if (event.isMainFrame) {
      openExternal(event.url)
    }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`blob:${origin}/`)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } }
    }
    openExternal(url)
    return { action: 'deny' }
  })
  void window.loadURL(indexUrl)
}

app.whenReady().then(() => {
  app.setAppUserModelId('dev.chatdemo.client')
  protocol.handle('app', serveApp)
  session.defaultSession.setPermissionCheckHandler(
    (_contents, permission, requestingOrigin, details) =>
      isAppUrl(requestingOrigin) &&
      (permission === 'clipboard-sanitized-write' || (permission === 'media' && details.mediaType === 'audio'))
  )
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(
      isAppUrl(details.requestingUrl) &&
      (permission === 'clipboard-sanitized-write' ||
        (permission === 'media' && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio'))
    )
  })
  createWindow()
})
app.on('window-all-closed', () => app.quit())
