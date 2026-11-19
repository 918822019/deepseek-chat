import { Capacitor, registerPlugin } from '@capacitor/core'

const ChatFiles = registerPlugin<{
  appendHistoryChunk(options: { cacheName: string; data: string }): Promise<void>
  saveHistory(options: { name: string; cacheName: string }): Promise<void>
  discardHistory(options: { cacheName: string }): Promise<void>
}>('ChatFiles')

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

export async function saveHistoryArchive(name: string, blob: Blob) {
  if (Capacitor.getPlatform() === 'android') {
    const cacheName = `chat-demo-history-${crypto.randomUUID()}.zip`
    // Send bounded chunks across the Android bridge even for large history archives.
    const chunkSize = 512 * 1024
    try {
      for (let offset = 0; offset < blob.size; offset += chunkSize) {
        const data = await toBase64(blob.slice(offset, offset + chunkSize))
        await ChatFiles.appendHistoryChunk({ cacheName, data })
      }
      await ChatFiles.saveHistory({ name, cacheName })
    } finally {
      await ChatFiles.discardHistory({ cacheName }).catch(() => {})
    }
    return
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
