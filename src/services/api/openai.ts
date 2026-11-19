/**
 * OpenAI 兼容后端适配（NVIDIA NIM、ModelScope 等）。
 * 应用内部使用 Anthropic Messages 的请求/流式事件格式；这里把请求转成
 * /chat/completions，再把 SSE 分片还原成 MessageStreamEvent，UI 与存储层无需改动。
 */
import { readServerSentEvents } from './sse.js'
import type { CreateMessageRequest, MessageStreamEvent } from './types.js'

export type OpenAIProvider = {
  baseUrl: string
  model: string
}

type OpenAIMessage = { role: 'system' | 'user' | 'assistant'; content: string }

const toOpenAIMessages = (body: CreateMessageRequest): OpenAIMessage[] => {
  const out: OpenAIMessage[] = [{ role: 'system', content: body.system }]
  let reminder = ''
  for (const message of body.messages) {
    if (message.role === 'latest_reminder') {
      reminder = message.content
    } else if (message.role === 'user') {
      const text =
        typeof message.content === 'string'
          ? message.content
          : message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
      out.push({ role: 'user', content: reminder ? `${reminder}\n\n${text}` : text })
      reminder = ''
    } else {
      // 思考块与服务端工具块不回传，只保留正文
      const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
      if (text) {
        out.push({ role: 'assistant', content: text })
      }
    }
  }
  return out
}

type Chunk = {
  choices?: {
    delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null }
    finish_reason?: string | null
  }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
}

const OPEN = '<think>'
const CLOSE = '</think>'

/** 部分模型把思考写在 <think> 标签里；按流切分，并保留可能是半个标签的尾部。 */
class ThinkSplitter {
  private inThink = false
  private pending = ''

  push(text: string, flush = false): { kind: 'text' | 'thinking'; text: string }[] {
    this.pending += text
    const result: { kind: 'text' | 'thinking'; text: string }[] = []
    for (;;) {
      const tag = this.inThink ? CLOSE : OPEN
      const at = this.pending.indexOf(tag)
      if (at >= 0) {
        if (at > 0) {
          result.push({ kind: this.inThink ? 'thinking' : 'text', text: this.pending.slice(0, at) })
        }
        this.pending = this.pending.slice(at + tag.length)
        this.inThink = !this.inThink
        continue
      }
      let keep = 0
      if (!flush) {
        for (let n = Math.min(tag.length - 1, this.pending.length); n > 0; n -= 1) {
          if (tag.startsWith(this.pending.slice(-n))) {
            keep = n
            break
          }
        }
      }
      const emit = this.pending.slice(0, this.pending.length - keep)
      if (emit) {
        result.push({ kind: this.inThink ? 'thinking' : 'text', text: emit })
      }
      this.pending = this.pending.slice(this.pending.length - keep)
      return result
    }
  }
}

export async function* streamOpenAI(
  provider: OpenAIProvider,
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal,
  fetcher: (url: string, init: RequestInit) => Promise<Response>
): AsyncGenerator<MessageStreamEvent> {
  const response = await fetcher(`${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model: provider.model,
      messages: toOpenAIMessages(body),
      stream: true,
    }),
    signal,
  })
  if (!response.body) {
    throw new Error('Empty response body')
  }

  const id = crypto.randomUUID()
  yield { type: 'message_start', message: { id, model: provider.model } }

  let index = -1
  let open: 'text' | 'thinking' | null = null
  let stop: 'end_turn' | 'max_tokens' = 'end_turn'
  let outputTokens = 0
  const splitter = new ThinkSplitter()

  function* close(): Generator<MessageStreamEvent> {
    if (open === 'thinking') {
      yield { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: id } }
    }
    if (open) {
      yield { type: 'content_block_stop', index }
      open = null
    }
  }
  function* emit(kind: 'text' | 'thinking', text: string): Generator<MessageStreamEvent> {
    if (!text) {
      return
    }
    if (open !== kind) {
      yield* close()
      index += 1
      open = kind
      yield {
        type: 'content_block_start',
        index,
        content_block:
          kind === 'text'
            ? { type: 'text', text: '' }
            : { type: 'thinking', thinking: '', signature: '' },
      }
    }
    yield {
      type: 'content_block_delta',
      index,
      delta: kind === 'text' ? { type: 'text_delta', text } : { type: 'thinking_delta', thinking: text },
    }
  }

  for await (const { data } of readServerSentEvents(response.body, signal)) {
    if (data.trim() === '[DONE]') {
      break
    }
    let chunk: Chunk
    try {
      chunk = JSON.parse(data) as Chunk
    } catch {
      continue
    }
    if (chunk.error?.message) {
      throw new Error(chunk.error.message)
    }
    outputTokens = chunk.usage?.completion_tokens ?? outputTokens
    const choice = chunk.choices?.[0]
    if (!choice) {
      continue
    }
    const delta = choice.delta
    const reasoning = delta?.reasoning_content ?? delta?.reasoning
    if (reasoning) {
      yield* emit('thinking', reasoning)
    }
    if (delta?.content) {
      for (const part of splitter.push(delta.content)) {
        yield* emit(part.kind, part.text)
      }
    }
    if (choice.finish_reason === 'length') {
      stop = 'max_tokens'
    }
  }
  for (const part of splitter.push('', true)) {
    yield* emit(part.kind, part.text)
  }
  yield* close()
  yield {
    type: 'message_delta',
    delta: { stop_reason: stop, stop_sequence: null },
    usage: {
      input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: outputTokens,
    },
  }
  yield { type: 'message_stop' }
}
