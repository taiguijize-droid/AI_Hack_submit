const baseUrl = 'https://laws.e-gov.go.jp/api/2'

const tools = [
  {
    name: 'search_laws',
    description: 'e-Gov法令APIで法令名を検索する。制度名から法令IDを確認するときに使う。',
    inputSchema: {
      type: 'object', required: ['keyword'], additionalProperties: false,
      properties: {keyword: {type: 'string', description: '法令名または法令名の一部'}, limit: {type: 'integer', minimum: 1, maximum: 20}}
    }
  },
  {
    name: 'get_law_article',
    description: 'e-Gov法令APIから指定した法令ID・条番号の現行条文を取得する。',
    inputSchema: {
      type: 'object', required: ['lawId', 'articleNum'], additionalProperties: false,
      properties: {lawId: {type: 'string'}, articleNum: {type: 'string'}, paragraphNum: {type: 'string'}}
    }
  }
]

const officialFetch = async url => {
  const response = await fetch(url, {signal: AbortSignal.timeout(30000), headers: {'User-Agent': 'JapanMentalHealthNavigator/0.2'}})
  if (!response.ok) throw new Error(`e-Gov API error (${response.status})`)
  return response.json()
}

const findNode = (node, tag, num) => {
  if (!node || typeof node !== 'object') return null
  if (node.tag === tag && String(node.attr?.Num) === String(num)) return node
  for (const child of Array.isArray(node.children) ? node.children : []) {
    const found = findNode(child, tag, num)
    if (found) return found
  }
  return null
}

const callTool = async (name, args) => {
  if (name === 'search_laws') {
    const params = new URLSearchParams({law_title: String(args.keyword), limit: String(Math.min(Number(args.limit) || 5, 20))})
    const sourceUrl = `${baseUrl}/laws?${params}`
    const data = await officialFetch(sourceUrl)
    return {source: 'e-Gov法令API Version 2', sourceUrl, retrievedAt: new Date().toISOString(), data}
  }
  if (name === 'get_law_article') {
    const asof = new Date().toISOString().slice(0, 10)
    const sourceUrl = `${baseUrl}/law_data/${encodeURIComponent(args.lawId)}?law_full_text_format=json&asof=${asof}`
    const data = await officialFetch(sourceUrl)
    const article = findNode(data.law_full_text, 'Article', args.articleNum)
    if (!article) throw new Error(`第${args.articleNum}条が見つかりません`)
    const paragraph = args.paragraphNum ? findNode(article, 'Paragraph', args.paragraphNum) : null
    if (args.paragraphNum && !paragraph) throw new Error(`第${args.articleNum}条第${args.paragraphNum}項が見つかりません`)
    return {
      source: 'e-Gov法令API Version 2', sourceUrl, retrievedAt: new Date().toISOString(),
      lawInfo: data.law_info, revisionInfo: data.revision_info, article: paragraph || article
    }
  }
  throw new Error(`Unknown e-Gov tool: ${name}`)
}

const toolResult = value => ({
  content: [{type: 'text', text: JSON.stringify(value)}],
  structuredContent: value,
  isError: false
})

export async function handleEgovMcp(payload) {
  if (payload.method === 'initialize') return {
    jsonrpc: '2.0', id: payload.id,
    result: {protocolVersion: '2025-03-26', capabilities: {tools: {listChanged: false}}, serverInfo: {name: 'navigator-egov-mcp', version: '0.2.0'}}
  }
  if (payload.method === 'notifications/initialized') return null
  if (payload.method === 'tools/list') return {jsonrpc: '2.0', id: payload.id, result: {tools}}
  if (payload.method === 'tools/call') {
    try {
      return {jsonrpc: '2.0', id: payload.id, result: toolResult(await callTool(payload.params?.name, payload.params?.arguments || {}))}
    } catch (error) {
      return {jsonrpc: '2.0', id: payload.id, result: {content: [{type: 'text', text: String(error?.message || error)}], isError: true}}
    }
  }
  return {jsonrpc: '2.0', id: payload.id, error: {code: -32601, message: 'Method not found'}}
}
