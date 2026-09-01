// Shared persistence key so the namespace picked in one resource view (Pods,
// generic resources, CRD resources) carries over when switching views.
export const NAMESPACE_STORAGE_KEY = 'kubegui:selected-namespace'
