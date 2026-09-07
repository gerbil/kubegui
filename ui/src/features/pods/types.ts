// Minimal typed representation of a Kubernetes Pod from the API response
export interface PodContainer {
  name: string
  image: string
  ready?: boolean
  restartCount?: number
  state?: {
    running?: { startedAt: string }
    waiting?: { reason: string; message?: string }
    terminated?: { reason: string; exitCode: number }
  }
}

export interface PodCondition {
  type: string
  status: string
  reason?: string
}

export interface Pod {
  metadata: {
    name: string
    namespace: string
    creationTimestamp: string
    labels?: Record<string, string>
    uid: string
  }
  spec: {
    nodeName?: string
    containers: { name: string; image: string }[]
  }
  status: {
    phase?: string
    podIP?: string
    conditions?: PodCondition[]
    containerStatuses?: PodContainer[]
    initContainerStatuses?: PodContainer[]
    startTime?: string
    reason?: string
    message?: string
  }
}