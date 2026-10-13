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
 * @param {{ commands: string[], toolArguments?: (command: string) => Record<string, unknown> }} script
 * @returns {Promise<{ url: string, requests: any[], close: () => Promise<void>, setScript: (s: typeof script) => void }>}
 */
export async function startMockLlm(script) {
  let current = script
  const requests = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      if (req.method === 'GET' && req.url?.endsWith('/models')) {
        return json(res, { object: 'list', data: [{ id: 'mock-model', object: 'model', owned_by: 'lightcode-e2e' }] })
      }
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) { res.writeHead(404).end(); return }
      let request
      try { request = JSON.parse(body) } catch { res.writeHead(400).end(); return }
      requests.push(request)
      const message = reply(request, current)
      if (request.stream) stream(res, message)
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
    setScript: next => { current = next },
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
  // Auxiliary requests (titles, summaries) carry no tools: answer briefly.
  if (!Array.isArray(request.tools) || request.tools.length === 0) return { content: 'LightCode e2e' }
  const step = request.messages.filter(message => message.role === 'tool').length
  if (step >= script.commands.length) return { content: 'done' }
  const command = script.commands[step]
  const args = script.toolArguments ? script.toolArguments(command) : { command }
  return { content: null, tool_calls: [{ id: `call_${step + 1}`, type: 'function', function: { name: 'bash', arguments: JSON.stringify(args) } }] }
}

function stream(res, message) {
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
  res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: now(), model: 'mock-model', choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })}\n\n`)
  res.end('data: [DONE]\n\n')
}

const json = (res, value) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
const now = () => Math.floor(Date.now() / 1000)
const usage = () => ({ prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 })
