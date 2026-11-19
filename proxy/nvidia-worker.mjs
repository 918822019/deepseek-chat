const upstreamOrigin = 'https://integrate.api.nvidia.com'
const routes = new Map([
  ['/v1/models', 'GET'],
  ['/v1/chat/completions', 'POST'],
])

const jsonError = (status, message, headers) =>
  Response.json({ error: { message } }, { status, headers })

// eslint-disable-next-line import/no-default-export
export default {
  async fetch(request, env) {
    const headers = new Headers({ 'cache-control': 'no-store', vary: 'Origin' })
    const origin = request.headers.get('Origin')
    if (!origin || (origin !== env.PAGES_ORIGIN && origin !== env.ANDROID_ORIGIN)) {
      return jsonError(403, 'This origin cannot use the NVIDIA relay.', headers)
    }
    headers.set('access-control-allow-origin', origin)

    const { pathname } = new URL(request.url)
    const prefix = env.PATH_PREFIX
    const upstreamPath = prefix && pathname.startsWith(`${prefix}/`)
      ? pathname.slice(prefix.length)
      : pathname
    const allowedMethod = routes.get(upstreamPath)
    if (!allowedMethod) {
      return jsonError(404, 'Unknown NVIDIA API route.', headers)
    }
    if (request.method === 'OPTIONS') {
      headers.set('access-control-allow-methods', allowedMethod)
      headers.set('access-control-allow-headers', 'Authorization, Content-Type, Accept')
      headers.set('access-control-max-age', '600')
      return new Response(null, { status: 204, headers })
    }
    if (request.method !== allowedMethod) {
      headers.set('allow', `${allowedMethod}, OPTIONS`)
      return jsonError(405, 'Method not allowed.', headers)
    }

    const authorization = request.headers.get('Authorization') ?? ''
    if (!/^Bearer nvapi-[^\s,]+$/i.test(authorization)) {
      return jsonError(401, 'Enter your NVIDIA API Catalog key (nvapi-…).', headers)
    }
    const upstreamHeaders = new Headers({ authorization })
    for (const name of ['accept', 'content-type']) {
      const value = request.headers.get(name)
      if (value) upstreamHeaders.set(name, value)
    }

    try {
      const response = await fetch(`${upstreamOrigin}${upstreamPath}`, {
        method: allowedMethod,
        headers: upstreamHeaders,
        body: request.body,
        cache: 'no-store',
        redirect: 'manual',
        signal: request.signal,
      })
      if (response.status >= 300 && response.status < 400) {
        return jsonError(502, 'NVIDIA NIM returned an unexpected redirect.', headers)
      }
      headers.set('content-type', response.headers.get('content-type') ?? 'application/json')
      return new Response(response.body, { status: response.status, headers })
    } catch {
      return jsonError(502, 'Could not connect to NVIDIA NIM.', headers)
    }
  },
}
