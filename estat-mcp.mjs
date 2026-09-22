const apiBase = 'https://api.e-stat.go.jp/rest/3.0/app/json'

const tools = [
  {
    name: 'search_statistics',
    description: 'e-Statで政府統計表をキーワード検索する。地域背景の把握だけに使い、個人の制度資格判定には使わない。',
    inputSchema: {
      type: 'object', required: ['keyword'], additionalProperties: false,
      properties: {keyword: {type: 'string'}, limit: {type: 'integer', minimum: 1, maximum: 20}}
    }
  },
  {
    name: 'get_statistic_meta',
    description: '統計表の分類軸を調べ、地域名・時点名・項目名からAPI用コードを逆引きする。データ取得前に使う。',
    inputSchema: {
      type: 'object', required: ['statsDataId'], additionalProperties: false,
      properties: {
        statsDataId: {type: 'string'},
        keyword: {type: 'string', description: '例：東京都、世田谷区、2024、精神保健。省略時は各分類の先頭を返す'},
        limitPerDimension: {type: 'integer', minimum: 1, maximum: 100}
      }
    }
  },
  {
    name: 'get_statistic_data',
    description: 'メタ情報で確認した分類コードを使い、統計表IDから必要な統計値だけを取得する。',
    inputSchema: {
      type: 'object', required: ['statsDataId'], additionalProperties: false,
      properties: {
        statsDataId: {type: 'string'}, limit: {type: 'integer', minimum: 1, maximum: 100},
        cdArea: {type: 'string'}, cdTime: {type: 'string'},
        filters: {type: 'object', description: 'メタ情報が返したfilterParameterとcodeの組み合わせ', additionalProperties: {type: 'string'}}
      }
    }
  }
]

const estatFetch = async (path, appId, params) => {
  const query = new URLSearchParams({appId, ...params})
  const response = await fetch(`${apiBase}/${path}?${query}`, {
    signal: AbortSignal.timeout(60000), headers: {'User-Agent': 'JapanMentalHealthNavigator/0.2'}
  })
  if (!response.ok) throw new Error(`e-Stat API error (${response.status})`)
  const data = await response.json()
  const status = data?.GET_STATS_LIST?.RESULT?.STATUS ?? data?.GET_META_INFO?.RESULT?.STATUS ?? data?.GET_STATS_DATA?.RESULT?.STATUS
  if (status !== undefined && Number(status) !== 0) throw new Error('e-Stat APIがエラーを返しました')
  return data
}

const callTool = async (name, args, appId) => {
  if (!appId) throw new Error('ESTAT_APP_ID が設定されていません')
  if (name === 'search_statistics') {
    const data = await estatFetch('getStatsList', appId, {searchWord: String(args.keyword), limit: String(Math.min(Number(args.limit) || 5, 20))})
    const root = data?.GET_STATS_LIST
    const tableRaw = root?.DATALIST_INF?.TABLE_INF
    const tables = (Array.isArray(tableRaw) ? tableRaw : tableRaw ? [tableRaw] : []).map(table => ({
      statsDataId: table['@id'], title: table.TITLE?.['$'] || table.TITLE,
      description: table.DESCRIPTION?.['$'] || table.DESCRIPTION,
      surveyDate: table.SURVEY_DATE, updatedDate: table.UPDATED_DATE,
      governmentStatisticsName: table.GOV_ORG?.['$'] || table.GOV_ORG
    }))
    return {
      source: '政府統計の総合窓口 e-Stat API', sourceUrl: 'https://www.e-stat.go.jp/', retrievedAt: new Date().toISOString(),
      totalNumber: root?.DATALIST_INF?.NUMBER, tables
    }
  }
  if (name === 'get_statistic_meta') {
    const data = await estatFetch('getMetaInfo', appId, {statsDataId: String(args.statsDataId)})
    const metadata = data?.GET_META_INFO?.METADATA_INF || {}
    const classObjectsRaw = metadata?.CLASS_INF?.CLASS_OBJ
    const classObjects = Array.isArray(classObjectsRaw) ? classObjectsRaw : classObjectsRaw ? [classObjectsRaw] : []
    const keyword = String(args.keyword || '').trim().toLowerCase()
    const limit = Math.min(Number(args.limitPerDimension) || 30, 100)
    const dimensions = classObjects.map(dimension => {
      const classesRaw = dimension.CLASS
      const classes = (Array.isArray(classesRaw) ? classesRaw : classesRaw ? [classesRaw] : [])
        .filter(item => !keyword || String(item['@name'] || '').toLowerCase().includes(keyword) || String(item['@code'] || '').toLowerCase().includes(keyword))
        .slice(0, limit)
        .map(item => ({code: item['@code'], name: item['@name'], level: item['@level'], unit: item['@unit']}))
      const id = String(dimension['@id'] || '')
      const filterParameter = id ? `cd${id.charAt(0).toUpperCase()}${id.slice(1)}` : ''
      return {id, name: dimension['@name'], filterParameter, items: classes}
    }).filter(dimension => dimension.items.length)
    return {
      source: '政府統計の総合窓口 e-Stat API', sourceUrl: `https://www.e-stat.go.jp/dbview?sid=${encodeURIComponent(args.statsDataId)}`,
      retrievedAt: new Date().toISOString(), tableInfo: metadata.TABLE_INF, keyword: args.keyword || '', dimensions
    }
  }
  if (name === 'get_statistic_data') {
    const params = {statsDataId: String(args.statsDataId), limit: String(Math.min(Number(args.limit) || 20, 100))}
    if (args.cdArea) params.cdArea = String(args.cdArea)
    if (args.cdTime) params.cdTime = String(args.cdTime)
    for (const [key, value] of Object.entries(args.filters || {})) {
      if (/^cd(?:Tab|Time|Area|Cat\d{2})$/.test(key) && value !== undefined) params[key] = String(value)
    }
    const data = await estatFetch('getStatsData', appId, params)
    const statistics = data?.GET_STATS_DATA?.STATISTICAL_DATA || {}
    const valuesRaw = statistics?.DATA_INF?.VALUE
    const values = (Array.isArray(valuesRaw) ? valuesRaw : valuesRaw ? [valuesRaw] : []).map(value => ({...value}))
    return {
      source: '政府統計の総合窓口 e-Stat API', sourceUrl: `https://www.e-stat.go.jp/dbview?sid=${encodeURIComponent(args.statsDataId)}`,
      retrievedAt: new Date().toISOString(), tableInfo: statistics.TABLE_INF,
      totalNumber: statistics.RESULT_INF?.TOTAL_NUMBER, values
    }
  }
  throw new Error(`Unknown e-Stat tool: ${name}`)
}

export async function handleEstatMcp(payload, appId) {
  if (payload.method === 'initialize') return {
    jsonrpc: '2.0', id: payload.id,
    result: {protocolVersion: '2025-03-26', capabilities: {tools: {listChanged: false}}, serverInfo: {name: 'navigator-estat-mcp', version: '0.2.0'}}
  }
  if (payload.method === 'notifications/initialized') return null
  if (payload.method === 'tools/list') return {jsonrpc: '2.0', id: payload.id, result: {tools}}
  if (payload.method === 'tools/call') {
    try {
      const value = await callTool(payload.params?.name, payload.params?.arguments || {}, appId)
      return {jsonrpc: '2.0', id: payload.id, result: {content: [{type: 'text', text: JSON.stringify(value)}], structuredContent: value, isError: false}}
    } catch (error) {
      return {jsonrpc: '2.0', id: payload.id, result: {content: [{type: 'text', text: String(error?.message || error)}], isError: true}}
    }
  }
  return {jsonrpc: '2.0', id: payload.id, error: {code: -32601, message: 'Method not found'}}
}
