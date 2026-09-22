import {spawn} from 'node:child_process'

const parseSse = text => {
  const data = text.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('')
  return JSON.parse(data || text)
}

const initialize = async client => {
  await client.request('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: {name: 'japan-mental-health-navigator', version: '0.2.0'}
  })
  await client.notify('notifications/initialized')
  const result = await client.request('tools/list')
  return result?.tools || []
}

export class HttpMcpClient {
  constructor(name, url) {
    this.name = name
    this.url = url
    this.sessionId = null
    this.nextId = 1
  }

  async post(payload) {
    const response = await fetch(this.url, {
      method: 'POST',
      signal: AbortSignal.timeout(payload.method === 'tools/call' ? 20000 : 10000),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        ...(this.sessionId ? {'Mcp-Session-Id': this.sessionId} : {})
      },
      body: JSON.stringify(payload)
    })
    if (!response.ok && response.status !== 202) throw new Error(`${this.name}: HTTP ${response.status}`)
    this.sessionId = response.headers.get('mcp-session-id') || this.sessionId
    return response
  }

  async request(method, params = {}) {
    const response = await this.post({jsonrpc: '2.0', id: this.nextId++, method, params})
    const payload = parseSse(await response.text())
    if (payload.error) throw new Error(`${this.name}: ${payload.error.message || 'MCP error'}`)
    return payload.result
  }

  async notify(method, params = {}) { await this.post({jsonrpc: '2.0', method, params}) }
  discover() { return initialize(this) }
  call(toolName, args) { return this.request('tools/call', {name: toolName, arguments: args}) }
}

export class StdioMcpClient {
  constructor(name, command, args = [], childEnv = {}) {
    this.name = name
    this.command = command
    this.args = args
    this.childEnv = childEnv
    this.nextId = 1
    this.pending = new Map()
    this.buffer = ''
    this.process = null
    this.stderr = ''
  }

  start() {
    if (this.process) return
    this.process = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      env: {...process.env, ...this.childEnv}
    })
    this.process.stdout.setEncoding('utf8')
    this.process.stdout.on('data', chunk => this.consume(chunk))
    this.process.stderr.setEncoding('utf8')
    this.process.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-4000) })
    this.process.on('error', error => this.rejectAll(error))
    this.process.on('exit', code => {
      if (this.pending.size) this.rejectAll(new Error(`${this.name}: MCP process exited (${code ?? 'unknown'}) ${this.stderr}`.trim()))
      this.process = null
    })
  }

  consume(chunk) {
    this.buffer += chunk
    while (this.buffer.includes('\n')) {
      const index = this.buffer.indexOf('\n')
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (!line) continue
      let message
      try { message = JSON.parse(line) } catch { continue }
      if (message.id === undefined) continue
      const pending = this.pending.get(message.id)
      if (!pending) continue
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(`${this.name}: ${message.error.message || 'MCP error'}`))
      else pending.resolve(message.result)
    }
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  send(payload) {
    this.start()
    this.process.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  request(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${this.name}: ${method} timed out`))
      }, method === 'tools/call' ? 20000 : 10000)
      this.pending.set(id, {resolve: resolvePromise, reject, timer})
      this.send({jsonrpc: '2.0', id, method, params})
    })
  }

  async notify(method, params = {}) { this.send({jsonrpc: '2.0', method, params}) }
  discover() { return initialize(this) }
  call(toolName, args) { return this.request('tools/call', {name: toolName, arguments: args}) }
}

const jsonArgs = value => {
  if (!value) return []
  try { return JSON.parse(value) } catch { return [] }
}

export const connectorDefinitions = env => [
  {
    id: 'openfisca', label: 'OpenFisca', purpose: '所得・世帯等の計算可能な制度条件',
    url: env.MCP_OPENFISCA_URL, command: env.MCP_OPENFISCA_COMMAND,
    args: jsonArgs(env.MCP_OPENFISCA_ARGS), childEnv: {}
  },
  {
    id: 'egov', label: 'e-Gov', purpose: '法令・省令・制度根拠',
    url: env.MCP_EGOV_URL || `http://127.0.0.1:${env.PORT || 8787}/mcp/egov`,
    command: env.MCP_EGOV_COMMAND, args: jsonArgs(env.MCP_EGOV_ARGS), childEnv: {}
  },
  {
    id: 'localgov', label: 'LocalGov', purpose: '自治体制度・窓口',
    url: env.MCP_LOCALGOV_URL || `http://127.0.0.1:${env.PORT || 8787}/mcp/localgov`, command: env.MCP_LOCALGOV_COMMAND,
    args: jsonArgs(env.MCP_LOCALGOV_ARGS), childEnv: {}
  },
  {
    id: 'estat', label: 'e-Stat', purpose: '地域統計（個人の資格判定には使用しない）',
    url: env.MCP_ESTAT_URL || (env.ESTAT_APP_ID ? `http://127.0.0.1:${env.PORT || 8787}/mcp/estat` : ''), command: env.MCP_ESTAT_COMMAND,
    args: jsonArgs(env.MCP_ESTAT_ARGS), childEnv: env.ESTAT_APP_ID ? {ESTAT_APP_ID: env.ESTAT_APP_ID} : {}
  },
  {
    id: 'web', label: 'Web/API', purpose: '最新の公的機関・医療機関・相談窓口情報',
    url: env.MCP_WEB_URL, command: env.MCP_WEB_COMMAND,
    args: jsonArgs(env.MCP_WEB_ARGS), childEnv: {}
  }
]

export async function discoverConnectors(env) {
  return Promise.all(connectorDefinitions(env).map(async definition => {
    const transport = definition.url ? 'http' : definition.command ? 'stdio' : null
    if (!transport) return {...definition, transport: null, status: 'not_configured', tools: [], client: null}
    try {
      const client = transport === 'http'
        ? new HttpMcpClient(definition.id, definition.url)
        : new StdioMcpClient(definition.id, definition.command, definition.args, definition.childEnv)
      const tools = await client.discover()
      return {...definition, transport, status: 'ready', tools, client}
    } catch (error) {
      return {...definition, transport, status: 'error', tools: [], client: null, error: String(error?.message || error)}
    }
  }))
}
