/**
 * A scripted OpenAI Chat Completions endpoint for end-to-end runs. It plays
 * one agent turn per request — call `bash` with the next scripted command,
 * then answer "done" — and records every request, so a test reads exactly
 * what the host sent the model.
 *
 * The step is derived from the conversation itself (how many tool results it
 * already carries), so retries and auxiliary requests (session titles, which
 * carry no tools) never desynchronize the script.
 */
import { createServer } from 'node:http'

/**
 * `respond`, when given, answers first; returning undefined falls back to the script.
 * @param {{ commands: string[], toolArguments?: (command: string) => Record<string, unknown>, respond?: (request: any) => any }} script
 * @returns {Promise<{ url: string, requests: any[], replies: any[], close: () => Promise<void>, setScript: (s: typeof script) => void }>}
 */
export async function startMockLlm(script) {
  let current = script
  const requests = []
  /** What each request in `requests` was answered with, at the same index. */
  const replies = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      if (req.method === 'GET' && req.url?.endsWith('/models')) {
        return json(res, { object: 'list', data: [{ id: 'mock-model', object: 'model', owned_by: 'tokenwise-e2e' }] })
      }
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) { res.writeHead(404).end(); return }
      let request
      try { request = JSON.parse(body) } catch { res.writeHead(400).end(); return }
      requests.push(request)
      const message = reply(request, current)
      replies.push(message)
      if (request.stream) stream(res, message, request)
      else json(res, { id: `cmpl-${requests.length}`, object: 'chat.completion', created: now(), model: request.model,
        choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
        usage: usage(request) })
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    replies,
    setScript: next => { current = next },
    get script() { return current },
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()) }),
  }
}

/** Tool results, in order, as the model received them in one request. */
export function toolResults(request) {
  return request.messages.filter(message => message.role === 'tool').map(message => ({
    id: message.tool_call_id,
    text: typeof message.content === 'string' ? message.content : message.content.map(part => part.text ?? '').join(''),
  }))
}

function reply(request, script) {
  const own = script.respond?.(request)
  if (own !== undefined) return own
  // Auxiliary requests (titles, summaries) carry no tools: answer briefly.
  if (!Array.isArray(request.tools) || request.tools.length === 0) return { content: 'TokenWise e2e' }
  const step = request.messages.filter(message => message.role === 'tool').length
  if (step >= script.commands.length) return { content: 'done' }
  const command = script.commands[step]
  const args = script.toolArguments ? script.toolArguments(command) : { command }
  return { content: null, tool_calls: [{ id: `call_${step + 1}`, type: 'function', function: { name: 'bash', arguments: JSON.stringify(args) } }] }
}

function stream(res, message, request) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  const id = `chunk-${Date.now()}`
  const send = (delta, finish = null, extra = {}) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: now(), model: 'mock-model',
    choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`)
  if (message.tool_calls) {
    send({ role: 'assistant', content: null, tool_calls: message.tool_calls.map((call, index) => ({ index, ...call })) })
    send({}, 'tool_calls')
  } else {
    send({ role: 'assistant', content: message.content })
    send({}, 'stop')
  }
  res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: now(), model: 'mock-model', choices: [], usage: usage(request) })}\n\n`)
  res.end('data: [DONE]\n\n')
}

const json = (res, value) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
const now = () => Math.floor(Date.now() / 1000)
// Hosts that decide when to compact from reported usage need a realistic prompt size.
const usage = request => {
  const prompt = Math.ceil(JSON.stringify(request?.messages ?? []).length / 4)
  return { prompt_tokens: prompt, completion_tokens: 10, total_tokens: prompt + 10 }
}
