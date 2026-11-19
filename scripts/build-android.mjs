import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'

const windows = process.platform === 'win32'
const gradleArgs = [':app:assembleDebug', '--console=plain']
const gradle = spawnSync(
  windows ? 'cmd.exe' : 'sh',
  windows ? ['/d', '/c', 'gradlew.bat', ...gradleArgs] : ['./gradlew', ...gradleArgs],
  { cwd: new URL('../android/', import.meta.url), stdio: 'inherit' }
)
if (gradle.error) {
  throw gradle.error
}
if (gradle.status !== 0) {
  process.exit(gradle.status ?? 1)
}

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const output = new URL('../release/android/', import.meta.url)
mkdirSync(output, { recursive: true })
copyFileSync(
  new URL('../android/app/build/outputs/apk/debug/app-debug.apk', import.meta.url),
  new URL(`Chat-Demo-${version}-debug.apk`, output)
)
