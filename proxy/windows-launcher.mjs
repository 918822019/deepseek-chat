import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createConnection, createServer } from 'node:net'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { appHeader, createWebServer, port } from './server.mjs'

const exec = promisify(execFile)
const user = createHash('sha256').update(homedir().toLowerCase()).digest('hex').slice(0, 16)
const controlPipe = `\\\\.\\pipe\\chat-demo-web-${user}-${port}`
const host = '127.0.0.1'
const url = `http://localhost:${port}`

async function isRunning() {
  const response = await fetch(`http://${host}:${port}/`, {
    method: 'HEAD',
    redirect: 'manual',
    signal: AbortSignal.timeout(1200),
  }).catch(() => null)
  return response?.ok && response.headers.get(appHeader) === '1'
}

async function start(openInBrowser) {
  if (!(await isRunning())) {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve'], {
      detached: true,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    let timer
    const result = await new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        child.kill()
        reject(new Error('Chat Demo Web did not start in time.'))
      }, 8000)
      child.once('message', resolve)
      child.once('error', reject)
      child.once('exit', () => reject(new Error('Chat Demo Web exited before it started.')))
    }).finally(() => {
      clearTimeout(timer)
      child.unref()
    })
    if (result.error && !(result.code === 'EADDRINUSE' && (await isRunning()))) {
      throw new Error(result.code === 'EADDRINUSE'
        ? `Port ${port} is already in use. Close the program using it and try again.`
        : result.error)
    }
  }
  if (!openInBrowser) {
    console.log(url)
    return
  }
  await exec('cmd.exe', ['/d', '/c', 'start', '', url], { windowsHide: true }).catch(() => {
    throw new Error(`Chat Demo Web is running. Open ${url} in your browser.`)
  })
}

function stop() {
  return new Promise((resolve, reject) => {
    const socket = createConnection(controlPipe, () => socket.write('stop'))
    socket.setTimeout(2500, () => socket.destroy(new Error('Chat Demo Web did not respond.')))
    socket.once('error', (error) => {
      if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') resolve()
      else reject(error)
    })
    let reply = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => { reply += chunk })
    socket.once('end', () => {
      if (reply === 'stopped') resolve()
      else reject(new Error('Chat Demo Web could not be stopped.'))
    })
  })
}

function serve() {
  const web = createWebServer()
  const control = createServer((socket) => {
    socket.on('error', () => {})
    socket.setTimeout(2500, () => socket.destroy())
    let command = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      command += chunk
      if (command.length < 4) return
      if (command !== 'stop') {
        socket.destroy()
        return
      }
      control.close()
      web.close(() => socket.end('stopped'))
      web.closeAllConnections()
    })
  })
  const report = (result) => {
    if (process.connected) {
      process.send(result, () => {
        if (process.connected) process.disconnect()
      })
    }
  }
  web.once('error', (error) => report({ error: error.message, code: error.code }))
  control.once('error', (error) => {
    web.close()
    web.closeAllConnections()
    report({ error: error.message, code: error.code })
  })
  web.listen(port, host, () => control.listen(controlPipe, () => report({ ready: true })))
}

try {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Set PORT to a number between 1 and 65535.')
  }
  if (process.argv[2] === 'serve' && process.connected) serve()
  else if (process.argv[2] === 'stop') await stop()
  else await start(process.argv[2] !== 'start-service')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
