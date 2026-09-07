import {
  DBGetClusterConfigs,
  DBGetActiveClusterConfig,
  DBMakeClusterConfigActive,
} from '../../bindings/kubegui/services/backend'
import type { Clusterconfig as GeneratedClusterconfig } from '../../bindings/kubegui/internal/db/models'

export type RuntimeClusterConfig = {
  ContextName?: string
  Context?: string
  FileName?: string
  Active?: number
  contextName?: string
  context?: string
  fileName?: string
  active?: number | boolean | string
}

function normalizeGeneratedClusterconfig(config: GeneratedClusterconfig): RuntimeClusterConfig {
  return {
    ContextName: config.ContextName,
    Context: config.Context,
    FileName: config.FileName,
    Active: config.Active,
    contextName: config.ContextName,
    context: config.Context,
    fileName: config.FileName,
    active: config.Active,
  }
}

export async function getRuntimeClusterConfigs(): Promise<RuntimeClusterConfig[]> {
  const configs = await DBGetClusterConfigs()
  return configs.map(normalizeGeneratedClusterconfig)
}

export async function getRuntimeActiveClusterConfig(): Promise<RuntimeClusterConfig> {
  try {
    const config = await DBGetActiveClusterConfig()
    return normalizeGeneratedClusterconfig(config)
  } catch {
    // No active config or DB not ready — return empty normalized object
    return {} as RuntimeClusterConfig
  }
}

export async function connectRuntimeClusterConfig(context: string, fileName: string): Promise<void> {
  await DBMakeClusterConfigActive(context, fileName)
}