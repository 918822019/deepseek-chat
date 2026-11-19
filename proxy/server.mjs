// 零依赖的自托管服务：托管 dist/ 静态文件，并把 /proxy/nvidia/* 转发到 NVIDIA NIM（解决浏览器 CORS）。
// 用法：先 build，再运行  node proxy/server.mjs   （PORT 默认 8080）
// API Key 仍由浏览器通过 Authorization 头携带，代理不保存、不记录。
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
export const port = Number(process.env.PORT ?? 8080)
export const appHeader = 'x-chat-demo-web'
const routes = { '/proxy/nvidia/': 'https://integrate.api.nvidia.com/' }
const androidOrigin = 'https://chat-demo.localhost'
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

const proxy = async (req, res, target) => {
  const headers = {}
  for (const name of ['authorization', 'content-type', 'accept']) {
    if (req.headers[name]) headers[name] = req.headers[name]
  }
  const controller = new AbortController()
  res.on('close', () => controller.abort())
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Readable.toWeb(req),
      duplex: 'half',
      signal: controller.signal,
    })
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    })
    if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res)
    else res.end()
  } catch (error) {
    if (res.destroyed) return
    if (res.headersSent) {
      res.destroy()
      return
    }
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: `proxy error: ${error.message}` } }))
  }
}

export const createWebServer = () => createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  for (const [prefix, upstream] of Object.entries(routes)) {
    if (url.pathname.startsWith(prefix)) {
      res.setHeader('vary', 'Origin')
      if (req.headers.origin === androidOrigin) {
        res.setHeader('access-control-allow-origin', androidOrigin)
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'access-control-allow-methods': 'GET, POST',
            'access-control-allow-headers': 'Authorization, Content-Type, Accept',
          }).end()
          return
        }
      }
      return void proxy(req, res, upstream + url.pathname.slice(prefix.length) + url.search)
    }
  }
  let file = path.join(root, path.normalize(url.pathname))
  if (!file.startsWith(root)) {
    res.writeHead(403).end()
    return
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html')
  if (!existsSync(file)) {
    res.writeHead(404).end('Not found')
    return
  }
  if (file === path.join(root, 'index.html')) {
    res.setHeader(appHeader, '1')
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(file).pipe(res)
})

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createWebServer()
  const host = process.argv.includes('--local') ? '127.0.0.1' : undefined
  server.on('error', (error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  server.listen({ port, host }, () => console.log(`http://localhost:${server.address().port}`))
}
