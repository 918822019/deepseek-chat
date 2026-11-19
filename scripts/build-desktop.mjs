import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') throw new Error('Build the Windows desktop app on Windows.')

const root = fileURLToPath(new URL('../', import.meta.url))
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const stage = path.join(root, '.cache', 'desktop-package')
const app = path.join(stage, 'app')
const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options })

run('dotnet', [
  'build', 'desktop/ChatDemo.csproj', '-c', 'Release', '-p:Platform=x64',
  '-p:Version=' + version, '-o', app, '--nologo',
])

if (process.argv.includes('--run')) {
  cpSync(path.join(root, 'dist'), path.join(app, 'dist'), { recursive: true })
  run(path.join(app, 'ChatDemo.exe'), [])
} else {
  const bootstrap = path.join(stage, 'MicrosoftEdgeWebview2Setup.exe')
  const response = await fetch('https://go.microsoft.com/fwlink/p/?LinkId=2124703', {
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw new Error('WebView2 bootstrapper download failed (HTTP ' + response.status + ').')
  writeFileSync(bootstrap, Buffer.from(await response.arrayBuffer()))
  // Windows PowerShell must load its own security module, even when invoked from PowerShell 7.
  const signatureEnv = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'psmodulepath'),
  )
  run('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    "$signature = Get-AuthenticodeSignature -LiteralPath $env:CHAT_WEBVIEW2_BOOTSTRAP; " +
      "if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.GetNameInfo('SimpleName', $false) -ne 'Microsoft Corporation') " +
      "{ throw 'Invalid Microsoft WebView2 bootstrapper signature.' }",
  ], { env: { ...signatureEnv, CHAT_WEBVIEW2_BOOTSTRAP: bootstrap } })

  const nsisFolders = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles].filter(Boolean)
  const makensis = process.env.MAKENSIS_PATH ??
    nsisFolders.map((folder) => path.join(folder, 'NSIS', 'makensis.exe')).find(existsSync) ??
    'makensis.exe'
  const release = path.join(root, 'release', 'windows')
  mkdirSync(release, { recursive: true })
  const installer = path.join(release, 'Chat-Demo-' + version + '-x64-setup.exe')
  run(makensis, [
    '/INPUTCHARSET', 'UTF8', '/V3', '/DROOT=' + root, '/DSTAGE=' + stage,
    '/DAPP_VERSION=' + version, '/DOUTPUT=' + installer, path.join(root, 'desktop', 'setup.nsi'),
  ])
  console.log(installer)
}
