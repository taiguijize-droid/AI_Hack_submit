const defaultBaseUrl = 'https://localgov.jp'

const tools = [
  {
    name: 'search_local_supports',
    description: 'LocalGov.jpで国・都道府県・市区町村の補助制度を検索する。医療・福祉・生活支援の候補探索に使うが、相談窓口を網羅する情報源ではない。',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        keyword: {type: 'string', description: '例：精神、医療費、障害、生活困窮'},
        prefecture: {type: 'string', description: '例：東京都'},
        municipalityCode: {type: 'string', pattern: '^\\d{6}$', description: 'JIS X 0402の6桁自治体コード'},
        openOnly: {type: 'boolean'},
        limit: {type: 'integer', minimum: 1, maximum: 20}
      }
    }
  },
  {
    name: 'get_local_support_detail',
    description: 'LocalGov.jpの制度IDから、対象条件・期限・金額・自治体公式の出典URLを取得する。',
    inputSchema: {
      type: 'object', required: ['id'], additionalProperties: false,
      properties: {id: {type: 'string'}}
    }
  },
  {
    name: 'list_municipality_supports',
    description: '6桁の自治体コードを使い、その自治体の補助制度一覧を取得する。結果は自治体公式ページで最終確認する。',
    inputSchema: {
      type: 'object', required: ['municipalityCode'], additionalProperties: false,
      properties: {
        municipalityCode: {type: 'string', pattern: '^\\d{6}$'},
        limit: {type: 'integer', minimum: 1, maximum: 50}
      }
    }
  }
]

const localGovFetch = async (baseUrl, path, params = {}) => {
  const url = new URL(path, `${baseUrl.replace(/\/$/, '')}/`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: {'Accept': 'application/json', 'User-Agent': 'JapanMentalHealthNavigator/0.3'}
  })
  if (!response.ok) throw new Error(`LocalGov.jp API error (${response.status})`)
  return {url: url.toString(), data: await response.json()}
}

const callTool = async (name, args, configuredBaseUrl) => {
  const baseUrl = configuredBaseUrl || defaultBaseUrl
  let response
  if (name === 'search_local_supports') {
    if (!args.keyword && !args.prefecture && !args.municipalityCode) throw new Error('検索語、都道府県、自治体コードのいずれかが必要です')
    response = await localGovFetch(baseUrl, '/api/grants/search', {
      keyword: args.keyword,
      prefecture: args.prefecture,
      municipality_code: args.municipalityCode,
      open_only: args.openOnly ? 'true' : undefined,
      limit: Math.min(Number(args.limit) || 10, 20)
    })
  } else if (name === 'get_local_support_detail') {
    response = await localGovFetch(baseUrl, `/api/grants/${encodeURIComponent(String(args.id))}`)
  } else if (name === 'list_municipality_supports') {
    if (!/^\d{6}$/.test(String(args.municipalityCode || ''))) throw new Error('自治体コードは6桁で指定してください')
    response = await localGovFetch(baseUrl, `/api/local/${encodeURIComponent(String(args.municipalityCode))}/grants`, {
      limit: Math.min(Number(args.limit) || 20, 50)
    })
  } else {
    throw new Error(`Unknown LocalGov tool: ${name}`)
  }
  return {
    source: 'LocalGov.jp（構造化データ層 CC BY 4.0）',
    sourceUrl: response.url,
    attribution: 'via LocalGov.jp',
    retrievedAt: new Date().toISOString(),
    note: '自治体独自制度と相談窓口を完全に網羅するものではありません。原典の自治体公式ページで最終確認してください。',
    data: response.data
  }
}

export async function handleLocalGovMcp(payload, baseUrl) {
  if (payload.method === 'initialize') return {
    jsonrpc: '2.0', id: payload.id,
    result: {protocolVersion: '2025-03-26', capabilities: {tools: {listChanged: false}}, serverInfo: {name: 'navigator-localgov-mcp', version: '0.3.0'}}
  }
  if (payload.method === 'notifications/initialized') return null
  if (payload.method === 'tools/list') return {jsonrpc: '2.0', id: payload.id, result: {tools}}
  if (payload.method === 'tools/call') {
    try {
      const value = await callTool(payload.params?.name, payload.params?.arguments || {}, baseUrl)
      return {jsonrpc: '2.0', id: payload.id, result: {content: [{type: 'text', text: JSON.stringify(value)}], structuredContent: value, isError: false}}
    } catch (error) {
      return {jsonrpc: '2.0', id: payload.id, result: {content: [{type: 'text', text: String(error?.message || error)}], isError: true}}
    }
  }
  return {jsonrpc: '2.0', id: payload.id, error: {code: -32601, message: 'Method not found'}}
}
