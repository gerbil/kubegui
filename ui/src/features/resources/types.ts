export type FetchStatus = 'idle' | 'loading' | 'succeeded' | 'failed'

export interface K8sResource {
  apiVersion?: string
  kind?: string
  metadata: {
    uid: string
    name: string
    namespace?: string
    creationTimestamp?: string
    labels?: Record<string, string>
  }
  status?: {
    phase?: string
    reason?: string
    conditions?: Array<{ type?: string; status?: string; reason?: string }>
  }
  spec?: Record<string, unknown>
  [key: string]: unknown
}

export interface ResourceMenuItem {
  resource: string
  label: string
  group?: string
  version?: string
  kind?: string
  namespaced: boolean
}

export interface ResourceMenuGroup {
  key: string
  label: string
  items: ResourceMenuItem[]
}

export interface NavigationResponse {
  groups: ResourceMenuGroup[]
  crdDefinitions: ResourceMenuItem
  crdGroups: ResourceMenuGroup[]
}