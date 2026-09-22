import {useEffect, useState} from 'react'
import type {ChangeEvent, FormEvent} from 'react'
import type {Connector, Intake, LocalFaceEngineStatus, NavigatorResult} from './types'
import {observeFace, observeWithLocalOpenFace} from './face-landmarker'
import './gmail.css'
import './guided.css'
import './image-analysis.css'

const initial: Intake = {
  situation: '', prefecture: '', municipality: '', age: '', department: '精神科・心療内科',
  outpatient: '不明', continuousTreatment: '不明', monthlyPayment: '', insuranceType: '不明',
  currentPrograms: '', goal: '医療費を下げたい', onlinePreferred: false,
  imageDataUrl: '', imageName: '', imageContext: '',
  faceObservation: {status: 'not_run', engine: 'MediaPipe Face Landmarker', faceCount: 0, observations: [], blendshapes: [], limitations: []},
  allowCloudFaceAnalysis: false
}

const connectorIcon: Record<string, string> = {openfisca: '計', egov: '法', localgov: '地', estat: '統', web: '網'}
const supportLevelLabel: Record<string, string> = {
  insufficient_information: '追加情報が必要', support_recommended: '支援候補を確認',
  prompt_support_recommended: '早めの支援確認を推奨', immediate_safety_check: '安全確認を優先'
}
const safeUrl = (value?: string) => Boolean(value && /^https?:\/\//i.test(value))

const prepareImage = async (file: File) => {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('JPEG・PNG・WebPの画像を選んでください')
  if (file.size > 10 * 1024 * 1024) throw new Error('元画像は10MB以下にしてください')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('画像を読み込めませんでした')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('画像を変換できませんでした')), 'image/jpeg', .82))
  if (blob.size > 4 * 1024 * 1024) throw new Error('変換後の画像が大きすぎます。小さい画像を選んでください')
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('画像を読み込めませんでした'))
    reader.readAsDataURL(blob)
  })
}

export default function App() {
  const [input, setInput] = useState<Intake>(initial)
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [apiOk, setApiOk] = useState(false)
  const [orcaConfigured, setOrcaConfigured] = useState(false)
  const [openFace, setOpenFace] = useState<LocalFaceEngineStatus>({ready: false, version: '2.2.0', mode: 'local'})
  const [model, setModel] = useState('')
  const [hypothesisModel, setHypothesisModel] = useState('orcarouter/auto')
  const [result, setResult] = useState<NavigatorResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [faceBusy, setFaceBusy] = useState(false)
  const [error, setError] = useState('')
  const [approved, setApproved] = useState(false)
  const [mailTo, setMailTo] = useState('')
  const [mailSubject, setMailSubject] = useState('')
  const [mailBody, setMailBody] = useState('')
  const [followUpIndex, setFollowUpIndex] = useState(0)
  const [followUpAnswers, setFollowUpAnswers] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch('/api/health').then(r => r.json()).then(data => {
      setApiOk(data.status === 'ok')
      setOrcaConfigured(Boolean(data.orcaConfigured))
      setConnectors(data.connectors || [])
      setModel(data.model || '')
      setHypothesisModel(data.hypothesisModel || 'orcarouter/auto')
      setOpenFace(data.openFace || {ready: false, version: '2.2.0', mode: 'local'})
    }).catch(() => setApiOk(false))
  }, [])

  useEffect(() => {
    if (!result) return
    setMailSubject(result.inquiryDraft.subject)
    setMailBody(result.inquiryDraft.body)
    setMailTo('')
    setFollowUpIndex(0)
    setFollowUpAnswers({})
  }, [result])

  const update = (key: keyof Intake, value: string | boolean) => setInput(current => ({...current, [key]: value}))

  const selectImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    try {
      const imageDataUrl = await prepareImage(file)
      setFaceBusy(true)
      setInput(current => ({...current, imageDataUrl, imageName: file.name, faceObservation: {...initial.faceObservation, status: 'not_run'}}))
      try {
        const [mediaPipeResult, openFaceResult] = await Promise.allSettled([
          observeFace(imageDataUrl),
          openFace.ready ? observeWithLocalOpenFace(imageDataUrl) : Promise.resolve({
            status: 'unavailable' as const, confidence: 0, actionUnits: [], observations: [], headPose: null, gaze: null,
            limitations: ['OpenFace 2はこのPCで利用できないため、MediaPipeだけで観察しました']
          })
        ])
        if (mediaPipeResult.status === 'rejected') throw mediaPipeResult.reason
        const localOpenFace = openFaceResult.status === 'fulfilled' ? openFaceResult.value : {
          status: 'error' as const, confidence: 0, actionUnits: [], observations: [], headPose: null, gaze: null,
          limitations: ['OpenFace 2の観察値は使用していません'],
          error: openFaceResult.reason instanceof Error ? openFaceResult.reason.message : 'OpenFace 2のローカル解析に失敗しました'
        }
        const faceObservation = {
          ...mediaPipeResult.value,
          engine: localOpenFace.status === 'observed' ? 'MediaPipe Face Landmarker + OpenFace 2' : mediaPipeResult.value.engine,
          observations: [...mediaPipeResult.value.observations, ...localOpenFace.observations].slice(0, 10),
          limitations: [...mediaPipeResult.value.limitations, ...localOpenFace.limitations],
          openFace: localOpenFace
        }
        setInput(current => ({...current, faceObservation}))
      } catch (faceCause) {
        const message = faceCause instanceof Error ? faceCause.message : 'ローカルの顔観察に失敗しました'
        setInput(current => ({...current, faceObservation: {
          status: 'error', engine: 'MediaPipe Face Landmarker', faceCount: 0,
          observations: [], blendshapes: [], limitations: ['顔の観察結果は支援判断に使用しません'], error: message
        }}))
      } finally {
        setFaceBusy(false)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '画像を読み込めませんでした')
      event.target.value = ''
    }
  }

  const navigate = async (payload: Intake, clearResult = false) => {
    setBusy(true); setError(''); setApproved(false)
    if (clearResult) setResult(null)
    try {
      const apiPayload = {
        ...payload,
        imageProvided: Boolean(payload.imageDataUrl),
        imageDataUrl: payload.allowCloudFaceAnalysis ? payload.imageDataUrl : ''
      }
      const response = await fetch('/api/navigate', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(apiPayload)})
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || `Agent API error (${response.status})`)
      setResult(data.result)
      setConnectors(data.connectorStatus || connectors)
      setModel(data.model || model)
      window.scrollTo({top: 0, behavior: 'smooth'})
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '処理に失敗しました')
    } finally { setBusy(false) }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    await navigate(input, true)
  }

  const applyFollowUp = async () => {
    if (!result) return
    const additions = result.missingInformation
      .map(item => ({question: item.question, answer: (followUpAnswers[item.field] || '').trim()}))
      .filter(item => item.answer)
    if (!additions.length) return
    const enriched = {
      ...input,
      situation: `${input.situation}\n\n【追加確認への回答】\n${additions.map(item => `・${item.question}：${item.answer}`).join('\n')}`
    }
    setInput(enriched)
    await navigate(enriched)
  }

  const validMailTo = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailTo.trim())
  const openGmailDraft = () => {
    if (!result || result.safety.level === 'urgent' || !approved || !validMailTo) return
    const params = new URLSearchParams({
      view: 'cm', fs: '1', to: mailTo.trim(), su: mailSubject.trim(), body: mailBody
    })
    window.open(`https://mail.google.com/mail/?${params.toString()}`, '_blank', 'noopener,noreferrer')
  }

  return <>
    <header>
      <div><div className="brand"><span>こころ</span> Japan Mental Health Navigator</div><p>診断ではなく、支援につながるための次の一歩を整理します</p></div>
      <div className={`connection ${apiOk && orcaConfigured ? 'ok' : 'down'}`}>{apiOk ? (orcaConfigured ? `Agent接続中 · ${model}` : 'Agent待機中 · APIキー未設定') : 'Agent未接続'}</div>
    </header>
    <main>
      <div className="steps">
        {['状況を整理', '支援を探索', '根拠を確認', '次の行動'].map((name, index) => <div className={index === 0 || result ? 'active' : ''} key={name}><b>{index + 1}</b><span>{name}</span></div>)}
      </div>

      {!result && <form onSubmit={submit}>
        <section className="hero">
          <div className="eyebrow">SUPPORT CONNECTION AGENT</div>
          <h1>いまの状況から、確認すべき支援と相談先を整理します</h1>
          <p className="lead">わかる範囲だけで大丈夫です。不明なことはAgentが「不足情報」として分けます。</p>
          <div className="notice">このサービスは診断、治療判断、制度の認定を行いません。緊急時の相談窓口でもありません。</div>
        </section>
        <section>
          <h2>あなたの状況</h2>
          <label className="wide">自由記述 <textarea value={input.situation} onChange={e => update('situation', e.target.value)} placeholder="例：精神科へ月1回、半年ほど通院しています。診察と薬で月17,000円ほどです。自立支援医療は使っていません。" required /></label>
          <div className="imageInput">
            <div>
              <b>今の気持ちを表す画像（任意）</b>
              <p>静止画の顔をMediaPipeとPC内のOpenFace 2で観察し、OrcaRouterが精神状態の仮説と確認質問を作ります。仮説は診断ではなく、支援を考える補助情報です。</p>
              <small className={openFace.ready ? 'engineReady' : 'engineUnavailable'}>{openFace.ready ? `OpenFace ${openFace.version}：このPC内で利用可能` : 'OpenFace 2：未検出（MediaPipeだけで継続可能）'}</small>
              <small className="hypothesisRoute">仮説モデル：{hypothesisModel}（画像がある場合に自動使用）</small>
              <label className="fileButton">画像を選ぶ<input type="file" accept="image/jpeg,image/png,image/webp" onChange={selectImage} /></label>
            </div>
            {input.imageDataUrl && <div className="imagePreview"><img src={input.imageDataUrl} alt="選択した気持ちを表す画像" /><span>{input.imageName}</span><button type="button" className="ghost" onClick={() => setInput(current => ({...current, imageDataUrl: '', imageName: '', faceObservation: initial.faceObservation, allowCloudFaceAnalysis: false}))}>画像を外す</button></div>}
          </div>
          {input.imageDataUrl && <div className={`faceStatus ${input.faceObservation.status}`}>
            <b>{faceBusy ? 'MediaPipeとOpenFace 2が顔を観察しています…' : input.faceObservation.status === 'face_detected' ? `顔を1件検出しました（${input.faceObservation.engine}）` : input.faceObservation.status === 'no_face' ? '顔を検出できませんでした' : input.faceObservation.status === 'multiple_faces' ? '複数の顔が検出されました' : input.faceObservation.status === 'error' ? '顔観察に失敗しました' : '顔観察の準備中です'}</b>
            {!faceBusy && input.faceObservation.observations.length > 0 && <span>{input.faceObservation.observations.join('／')}</span>}
            {!faceBusy && input.faceObservation.error && <span>{input.faceObservation.error}</span>}
          </div>}
          {input.imageDataUrl && <label className="wide">この画像で表したかった気持ち・背景（任意）<textarea className="imageContext" value={input.imageContext} maxLength={500} onChange={e => update('imageContext', e.target.value)} placeholder="例：先が見えず、ひとりで抱えている感じを表しました。" /></label>}
          {input.imageDataUrl && <label className="cloudConsent"><input type="checkbox" checked={input.allowCloudFaceAnalysis} onChange={e => update('allowCloudFaceAnalysis', e.target.checked)} /><span><b>顔画像をOrcaRouter経由の画像対応AIへ送信する</b><small>オンにすると、画像はOrcaRouterと選択された上流AI事業者で処理されます。精神状態の仮説作成にだけ使用し、MCPには渡しません。</small></span></label>}
          <div className="privacyNote">{input.allowCloudFaceAnalysis ? 'クラウド画像解析が有効です。顔画像、ローカル観察値、本人の説明、自由記述がOrcaRouter経由のAIへ送信されます。' : '顔画像はブラウザのMediaPipeと、このPC内のOpenFace 2だけで処理し、OrcaRouterには送信しません。OrcaRouterへ送るのは数値から作った観察文、本人の説明、自由記述です。'}</div>
          <div className="grid">
            <label>都道府県<input value={input.prefecture} onChange={e => update('prefecture', e.target.value)} placeholder="例：東京都" /></label>
            <label>市区町村<input value={input.municipality} onChange={e => update('municipality', e.target.value)} placeholder="例：世田谷区" /></label>
            <label>年齢<input type="number" min="0" max="120" value={input.age} onChange={e => update('age', e.target.value)} /></label>
            <label>診療科<input value={input.department} onChange={e => update('department', e.target.value)} /></label>
            <label>通院区分<select value={input.outpatient} onChange={e => update('outpatient', e.target.value)}><option>不明</option><option>外来</option><option>入院</option></select></label>
            <label>継続通院<select value={input.continuousTreatment} onChange={e => update('continuousTreatment', e.target.value)}><option>不明</option><option>継続中</option><option>初回・単発</option></select></label>
            <label>月の自己負担額<input type="number" min="0" value={input.monthlyPayment} onChange={e => update('monthlyPayment', e.target.value)} placeholder="円" /></label>
            <label>健康保険<select value={input.insuranceType} onChange={e => update('insuranceType', e.target.value)}><option>不明</option><option>国民健康保険</option><option>協会けんぽ</option><option>健康保険組合</option><option>共済組合</option><option>後期高齢者医療</option></select></label>
            <label>現在利用中の制度<input value={input.currentPrograms} onChange={e => update('currentPrograms', e.target.value)} placeholder="なければ空欄" /></label>
            <label>いちばんの希望<select value={input.goal} onChange={e => update('goal', e.target.value)}><option>医療費を下げたい</option><option>相談先を探したい</option><option>医療機関を探したい</option><option>就労・休職支援を探したい</option><option>家族向け支援を探したい</option></select></label>
          </div>
          <label className="check"><input type="checkbox" checked={input.onlinePreferred} onChange={e => update('onlinePreferred', e.target.checked)} />オンラインで利用できる支援を優先する</label>
          {error && <div className="alert error">⚠️ {error}</div>}
          <button className="primary" disabled={busy || faceBusy || input.situation.trim().length < 10}>{busy ? 'Agentが整理・探索しています…' : faceBusy ? '顔の観察を待っています…' : '支援へのルートを整理する'}</button>
        </section>
      </form>}

      {result && <>
        {result.safety.level === 'urgent' && <div className="urgent"><strong>安全を優先してください</strong><p>{result.safety.message}</p></div>}
        <section>
          <div className="sectionHead"><div><div className="eyebrow">CASE STRUCTURING</div><h2>現在わかっていること</h2></div><button className="ghost" onClick={() => setResult(null)}>入力を修正</button></div>
          {result.modelDecision && <div className={`modelDecision ${result.modelDecision.complexity}`}><b>ケース難易度：{result.modelDecision.complexity === 'high' ? '高' : result.modelDecision.complexity === 'medium' ? '中' : '低'}</b><span>{result.modelDecision.reasons.join('／')}</span><small>一次整理：{result.modelDecision.routerModel} → 回答：{result.modelDecision.responseModel}</small></div>}
          {result.mentalState && <div className={`mentalState ${result.mentalState.supportLevel}`}><div><small>MENTAL STATE SUPPORT SKILL</small><h3>{supportLevelLabel[result.mentalState.supportLevel] || '状態を整理'}</h3></div><p>{result.mentalState.summary}</p>{result.mentalState.selfReportedSignals.length > 0 && <p><b>本人が述べた状態：</b>{result.mentalState.selfReportedSignals.join('／')}</p>}{result.mentalState.functionalImpact.length > 0 && <p><b>生活への影響：</b>{result.mentalState.functionalImpact.join('／')}</p>}{result.mentalState.protectiveFactors.length > 0 && <p><b>利用できる支え：</b>{result.mentalState.protectiveFactors.join('／')}</p>}<small>診断や標準化尺度の推定採点ではありません。本人が入力した内容を支援接続のために整理しています。</small></div>}
          <div className="summaryGrid">{result.caseSummary.map((item, i) => <div key={`${item.label}-${i}`}><small>{item.label}</small><b>{item.value}</b></div>)}</div>
          {result.imageAnalysis?.provided && <div className="imageAnalysis"><h3>ローカル顔観察と仮説</h3><p>{result.imageAnalysis.summary}</p>{result.imageAnalysis.observations.length > 0 && <><b>観察できたこと</b><ul>{result.imageAnalysis.observations.map((item, i) => <li key={i}>{item}</li>)}</ul></>}{result.imageAnalysis.hypotheses && result.imageAnalysis.hypotheses.length > 0 && <div className="hypotheses"><b>精神状態の仮説（要確認）</b>{result.imageAnalysis.hypotheses.map((item, i) => <article key={i}><strong>{item.label}</strong><span>確信度：低</span><p>{item.basis.join('／')}</p></article>)}</div>}{result.imageAnalysis.confirmationQuestions && result.imageAnalysis.confirmationQuestions.length > 0 && <p><b>本人に確認したいこと：</b>{result.imageAnalysis.confirmationQuestions.join('／')}</p>}{result.imageAnalysis.userMeaning && <p><b>本人の説明：</b>{result.imageAnalysis.userMeaning}</p>}<small>{result.imageAnalysis.limitations}</small></div>}
          <h3>追加で確認が必要なこと</h3>
          {result.missingInformation.length ? <div className="missingList">{result.missingInformation.map((item, i) => <article key={i}><b>{item.question}</b><p>{item.reason}</p></article>)}</div> : <p className="muted">主要な不足情報はありません。</p>}
        </section>

        {result.safety.level !== 'urgent' && result.missingInformation.length > 0 && <section className="guidedIntake">
          <div className="eyebrow">GUIDED FOLLOW-UP</div><h2>一問ずつ、追加情報を補う</h2>
          <p className="muted">制度候補を絞るために必要な質問だけを表示します。診断のための質問ではありません。答えたくない項目はスキップできます。</p>
          {followUpIndex < result.missingInformation.length ? (() => {
            const item = result.missingInformation[followUpIndex]
            return <div className="questionCard">
              <div className="questionProgress"><span>確認 {followUpIndex + 1} / {result.missingInformation.length}</span><progress value={followUpIndex + 1} max={result.missingInformation.length} /></div>
              <h3>{item.question}</h3><p>{item.reason}</p>
              <textarea value={followUpAnswers[item.field] || ''} onChange={e => setFollowUpAnswers(current => ({...current, [item.field]: e.target.value}))} placeholder="わかる範囲で入力してください" />
              <div className="questionActions">
                <button className="ghost" type="button" disabled={followUpIndex === 0} onClick={() => setFollowUpIndex(index => Math.max(0, index - 1))}>戻る</button>
                <button className="ghost" type="button" onClick={() => setFollowUpIndex(index => index + 1)}>今は答えない</button>
                <button className="primary" type="button" onClick={() => setFollowUpIndex(index => index + 1)}>次へ</button>
              </div>
            </div>
          })() : <div className="followUpReview">
            <h3>回答内容の確認</h3>
            {result.missingInformation.filter(item => (followUpAnswers[item.field] || '').trim()).map(item => <div key={item.field}><b>{item.question}</b><p>{followUpAnswers[item.field]}</p></div>)}
            {!Object.values(followUpAnswers).some(value => value.trim()) && <p className="muted">回答された項目はありません。戻って入力するか、このまま現在の結果を利用できます。</p>}
            <div className="questionActions">
              <button className="ghost" type="button" onClick={() => setFollowUpIndex(Math.max(0, result.missingInformation.length - 1))}>戻る</button>
              <button className="primary" type="button" disabled={busy || !Object.values(followUpAnswers).some(value => value.trim())} onClick={applyFollowUp}>{busy ? '回答を反映しています…' : '回答を反映して支援を再確認'}</button>
            </div>
          </div>}
          {error && <div className="alert error">⚠️ {error}</div>}
        </section>}

        <section>
          <div className="eyebrow">LLM AGENT ROUTER</div><h2>情報源の振り分け</h2>
          <div className="connectorGrid">{connectors.map(connector => <article key={connector.id} className={`connector ${connector.status}`}><i>{connectorIcon[connector.id] || '接'}</i><b>{connector.label}</b><span>{connector.purpose}</span><small>{connector.status === 'ready' ? `${connector.toolCount} tools ready · ${connector.transport}` : connector.status === 'error' ? '接続エラー' : '未設定'}</small></article>)}</div>
          <div className="routeList">{result.routing.map((route, i) => <div key={i}><b>{route.connector}</b><span>{route.reason}</span><em>{route.status === 'used' ? '使用' : route.status === 'unavailable' ? '利用不可' : '不要'}</em></div>)}</div>
        </section>

        <section>
          <div className="eyebrow">EXECUTION TRACE</div><h2>誰が何をしたか</h2>
          <p className="muted">この回答内の処理履歴です。入力内容やMCPの生データを永続保存する監査ログではありません。</p>
          <div className="traceList">{(result.trace || []).map(item => <article key={item.id}>
            <span className={`traceStatus ${item.status}`}>{item.status === 'success' ? '成功' : item.status === 'error' ? 'エラー' : item.status === 'skipped' ? '未実行' : '実行中'}</span>
            <div><b>{item.actor}</b><strong>{item.action}：{item.target}</strong><small>{item.detail}</small><time>{new Date(item.at).toLocaleString('ja-JP')}</time></div>
          </article>)}</div>
        </section>

        <section>
          <div className="eyebrow">EVIDENCE CHECKER</div><h2>確認対象となる支援</h2>
          <div className="candidateList">{result.supportCandidates.map((candidate, i) => <article key={i}>
            <div className="candidateTitle"><h3>{candidate.name}</h3><span className={`badge ${candidate.evidenceStatus}`}>{candidate.evidenceStatus === 'verified' ? '根拠確認済み' : candidate.evidenceStatus === 'partial' ? '一部確認' : '要確認'}</span></div>
            <p>{candidate.whyCandidate}</p>
            <dl><dt>確認できたこと</dt><dd>{candidate.verifiedFacts.length ? candidate.verifiedFacts.join('／') : 'まだありません'}</dd><dt>不足条件</dt><dd>{candidate.missingConditions.length ? candidate.missingConditions.join('／') : 'なし'}</dd><dt>確認先</dt><dd>{candidate.confirmationTarget || '未確認'}</dd><dt>根拠</dt><dd>{candidate.evidence.length ? candidate.evidence.map((evidence, index) => <span className="evidence" key={evidence.traceId}>{safeUrl(evidence.url) ? <a href={evidence.url} target="_blank" rel="noreferrer">{evidence.title || evidence.url}</a> : evidence.title || '出典情報'}<small>{evidence.connector} · {evidence.tool} · {evidence.traceId}</small>{index < candidate.evidence.length - 1 ? '／' : ''}</span>) : 'まだありません'}</dd></dl>
          </article>)}</div>
          {!result.supportCandidates.length && <p className="muted">根拠を伴う支援候補はまだありません。MCP接続または追加情報が必要です。</p>}
        </section>

        <section>
          <div className="eyebrow">ACTION PLANNER</div><h2>次にやること</h2>
          <ol className="actions">{[...result.actions].sort((a, b) => a.priority - b.priority).map((action, i) => <li key={i}><span>{action.priority}</span><div><b>{action.text}</b><small>担当・確認先：{action.owner}</small></div></li>)}</ol>
          <div className="draft"><h3>相談メール</h3>
            <label>宛先メールアドレス<input type="email" value={mailTo} onChange={e => { setMailTo(e.target.value); setApproved(false) }} placeholder="公式サイトで確認した宛先を入力" /></label>
            <label>件名<input value={mailSubject} onChange={e => { setMailSubject(e.target.value); setApproved(false) }} /></label>
            <label>本文<textarea value={mailBody} onChange={e => { setMailBody(e.target.value); setApproved(false) }} /></label>
            {mailTo && !validMailTo && <small className="fieldError">メールアドレスの形式を確認してください。</small>}
          </div>
          <label className="approval"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} disabled={result.safety.level === 'urgent'} /><span><b>送信内容を確認</b> 宛先・件名・本文と、本文に含まれる個人情報を確認しました。Gmailを開いた後も、送信前にもう一度確認します。</span></label>
          <button className="primary" disabled={!approved || !validMailTo || !mailSubject.trim() || !mailBody.trim() || result.safety.level === 'urgent'} onClick={openGmailDraft}>Gmailで送信前画面を開く</button>
          <p className="muted mailHelp">自動送信はしません。ブラウザでログイン中のGmailに宛先・件名・本文を引き渡し、最後の送信操作は本人が行います。</p>
          {result.safety.level === 'urgent' && <div className="alert error">緊急性があるため、メール送信機能は停止しています。上の安全案内を優先してください。</div>}
          <p className="notice">{result.notice}</p>
        </section>
      </>}
    </main>
    <footer>Japan Mental Health Navigator · 支援候補の最終確認は医療機関・自治体・保険者等へ</footer>
  </>
}
