import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync, zipSync } from 'fflate'

const root = fileURLToPath(new URL('../', import.meta.url))
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const runtimeVersion = 'v24.22.3'
const runtime = `node-${runtimeVersion}-win-x64`
const sha256 = 'e612af99f626ab415ea225af6bce5c971feb448cb5cae250bb1c3fa50c5f7d9f'
const cache = path.join(root, '.cache', 'web-runtime')
const runtimeZip = path.join(cache, `${runtime}.zip`)
const verified = (data) => createHash('sha256').update(data).digest('hex') === sha256

let archive = existsSync(runtimeZip) ? readFileSync(runtimeZip) : null
if (!archive || !verified(archive)) {
  console.log(`Downloading ${runtime}`)
  const response = await fetch(`https://nodejs.org/dist/${runtimeVersion}/${runtime}.zip`, {
    signal: AbortSignal.timeout(180_000),
  })
  if (!response.ok) {
    throw new Error(`Node.js download failed (HTTP ${response.status})`)
  }
  archive = Buffer.from(await response.arrayBuffer())
  if (!verified(archive)) {
    throw new Error('Node.js archive checksum did not match')
  }
  mkdirSync(cache, { recursive: true })
  writeFileSync(runtimeZip, archive)
}

const executable = `${runtime}/node.exe`
const license = `${runtime}/LICENSE`
const runtimeFiles = unzipSync(archive, { filter: ({ name }) => name === executable || name === license })
if (!runtimeFiles[executable] || !runtimeFiles[license]) {
  throw new Error('Node.js archive is missing node.exe or LICENSE')
}

const files = Object.fromEntries(
  readdirSync(path.join(root, 'dist'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const absolute = path.join(entry.parentPath, entry.name)
      return [path.relative(root, absolute).split(path.sep).join('/'), readFileSync(absolute)]
    })
)
for (const name of ['start-web.bat', 'stop-web.bat']) {
  const launcher = readFileSync(path.join(root, name), 'utf8')
  files[name] = Buffer.from(launcher.replace(/\r?\n/g, '\r\n'))
}
for (const name of ['proxy/server.mjs', 'proxy/windows-launcher.mjs']) {
  files[name] = readFileSync(path.join(root, name))
}
const goOptions = {
  env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' },
  windowsHide: true,
}
const readGoRoot = () => execFileSync('go', ['env', 'GOROOT'], { ...goOptions, encoding: 'utf8' }).trim()
let goRoot = readGoRoot()
if (!existsSync(path.join(goRoot, 'src', 'runtime'))) {
  delete goOptions.env.GOROOT
  goRoot = readGoRoot()
}
for (const [name, action] of [['Open Chat Demo.exe', 'start-service'], ['Stop Chat Demo.exe', 'stop']]) {
  const output = path.join(cache, name)
  execFileSync('go', [
    'build', '-trimpath', `-ldflags=-H=windowsgui -s -X main.action=${action}`,
    '-o', output, path.join(root, 'scripts', 'windows-web-launcher.go'),
  ], { ...goOptions, stdio: 'inherit' })
  files[name] = readFileSync(output)
}
files['licenses/Go.txt'] = readFileSync(path.join(goRoot, 'LICENSE'))
files['runtime/node.exe'] = runtimeFiles[executable]
files['runtime/LICENSE'] = runtimeFiles[license]

const release = path.join(root, 'release')
mkdirSync(release, { recursive: true })
const output = path.join(release, `Chat-Demo-${version}-web.zip`)
writeFileSync(output, zipSync(files, { level: 3 }))
console.log(output)
