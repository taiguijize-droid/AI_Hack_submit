export type Connector = {
  id: string
  label: string
  purpose: string
  transport?: 'http' | 'stdio' | null
  status: 'ready' | 'not_configured' | 'error'
  toolCount: number
  tools: string[]
  error?: string
}

export type FaceObservation = {
  status: 'not_run' | 'face_detected' | 'no_face' | 'multiple_faces' | 'error'
  engine: string
  faceCount: number
  observations: string[]
  blendshapes: Array<{name: string; score: number}>
  openFace?: {
    status: 'observed' | 'low_quality' | 'unavailable' | 'error'
    confidence: number
    actionUnits: Array<{name: string; intensity: number}>
    observations: string[]
    headPose: {pitch: number; yaw: number; roll: number} | null
    gaze: {horizontal: number; vertical: number} | null
    limitations: string[]
    error?: string
  }
  limitations: string[]
  error?: string
}

export type LocalFaceEngineStatus = {
  ready: boolean
  version: string
  mode: 'local'
}

export type Intake = {
  situation: string
  prefecture: string
  municipality: string
  age: string
  department: string
  outpatient: string
  continuousTreatment: string
  monthlyPayment: string
  insuranceType: string
  currentPrograms: string
  goal: string
  onlinePreferred: boolean
  imageDataUrl: string
  imageName: string
  imageContext: string
  faceObservation: FaceObservation
  allowCloudFaceAnalysis: boolean
}

export type NavigatorResult = {
  mentalState?: {
    supportLevel: 'insufficient_information' | 'support_recommended' | 'prompt_support_recommended' | 'immediate_safety_check'
    summary: string
    selfReportedSignals: string[]
    functionalImpact: string[]
    protectiveFactors: string[]
    uncertainties: string[]
    recommendedQuestions: string[]
    basis: string[]
  }
  imageAnalysis?: {
    provided: boolean
    summary: string
    observations: string[]
    readableText: string[]
    userMeaning: string
    limitations: string
    faceObservationStatus?: FaceObservation['status']
    hypotheses?: Array<{
      label: string
      confidence: 'low'
      basis: string[]
      needsConfirmation: true
    }>
    confirmationQuestions?: string[]
  }
  modelDecision?: {
    complexity: 'low' | 'medium' | 'high'
    reasons: string[]
    routerModel: string
    responseModel: string
  }
  caseSummary: Array<{label: string; value: string}>
  missingInformation: Array<{field: string; question: string; reason: string}>
  routing: Array<{connector: string; reason: string; status: 'used' | 'unavailable' | 'not_needed'}>
  supportCandidates: Array<{
    name: string
    whyCandidate: string
    verifiedFacts: string[]
    missingConditions: string[]
    confirmationTarget: string
    evidenceStatus: 'verified' | 'partial' | 'unverified'
    evidence: Array<{traceId: string; connector: string; tool: string; retrievedAt: string; title?: string; url?: string}>
  }>
  actions: Array<{priority: number; text: string; owner: string}>
  inquiryDraft: {subject: string; body: string}
  safety: {level: 'normal' | 'urgent'; message: string}
  notice: string
  trace: Array<{
    id: string
    actor: string
    action: string
    target: string
    status: 'success' | 'error' | 'skipped' | 'running'
    detail: string
    at: string
  }>
}
