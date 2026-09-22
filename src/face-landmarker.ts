import {FaceLandmarker, FilesetResolver} from '@mediapipe/tasks-vision'
import type {FaceObservation} from './types'

let landmarkerPromise: Promise<FaceLandmarker> | null = null

const getLandmarker = () => {
  if (!landmarkerPromise) {
    landmarkerPromise = FilesetResolver.forVisionTasks('/mediapipe').then(fileset =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {modelAssetPath: '/mediapipe/face_landmarker.task'},
        runningMode: 'IMAGE',
        numFaces: 2,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false
      })
    )
  }
  return landmarkerPromise
}

const loadImage = (dataUrl: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('顔観察用の画像を読み込めませんでした'))
  image.src = dataUrl
})

const average = (scores: Map<string, number>, names: string[]) =>
  names.reduce((sum, name) => sum + (scores.get(name) || 0), 0) / names.length

const describeBlendshapes = (scores: Map<string, number>) => {
  const observations: string[] = []
  const paired = (left: string, right: string) => average(scores, [left, right])
  const add = (condition: boolean, text: string) => { if (condition) observations.push(text) }

  add(paired('eyeBlinkLeft', 'eyeBlinkRight') >= 0.45, '両目を閉じ気味にしている瞬間が写っています')
  add(paired('eyeWideLeft', 'eyeWideRight') >= 0.35, '両目を比較的大きく開いている瞬間が写っています')
  add(paired('browDownLeft', 'browDownRight') >= 0.35, '眉を下げている動きが検出されています')
  add((scores.get('browInnerUp') || 0) >= 0.35, '眉の内側を上げている動きが検出されています')
  add(paired('mouthSmileLeft', 'mouthSmileRight') >= 0.35, '口角を上げている動きが検出されています')
  add(paired('mouthFrownLeft', 'mouthFrownRight') >= 0.3, '口角を下げている動きが検出されています')
  add(paired('mouthPressLeft', 'mouthPressRight') >= 0.35, '唇を押し合わせる動きが検出されています')
  add((scores.get('jawOpen') || 0) >= 0.4, '口を開いている瞬間が写っています')

  return observations.slice(0, 5)
}

export async function observeFace(dataUrl: string): Promise<FaceObservation> {
  const [landmarker, image] = await Promise.all([getLandmarker(), loadImage(dataUrl)])
  const result = landmarker.detect(image)
  const faceCount = result.faceLandmarks.length
  if (!faceCount) {
    return {
      status: 'no_face', engine: 'MediaPipe Face Landmarker', faceCount: 0,
      observations: [], blendshapes: [], limitations: ['顔を検出できなかったため、顔からの仮説は作成しません']
    }
  }
  if (faceCount > 1) {
    return {
      status: 'multiple_faces', engine: 'MediaPipe Face Landmarker', faceCount,
      observations: [], blendshapes: [], limitations: ['複数の顔が検出されたため、誰の顔か判断せず解析を停止しました']
    }
  }

  const categories = result.faceBlendshapes[0]?.categories || []
  const scores = new Map(categories.map(item => [item.categoryName, item.score]))
  const blendshapes = categories
    .filter(item => item.categoryName && item.categoryName !== '_neutral')
    .sort((left, right) => right.score - left.score)
    .slice(0, 12)
    .map(item => ({name: item.categoryName, score: Math.round(item.score * 1000) / 1000}))

  return {
    status: 'face_detected', engine: 'MediaPipe Face Landmarker', faceCount: 1,
    observations: describeBlendshapes(scores), blendshapes,
    limitations: [
      '静止画1枚の撮影瞬間を示す値で、継続的な精神状態や診断を示すものではありません',
      '照明、顔の向き、撮影時の意図によって値が変わります'
    ]
  }
}

export async function observeWithLocalOpenFace(dataUrl: string): Promise<NonNullable<FaceObservation['openFace']>> {
  const response = await fetch('/api/face/openface', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({imageDataUrl: dataUrl})
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `OpenFace API error (${response.status})`)
  return data.observation
}
