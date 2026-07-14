import { Plug, PlugZap, Square } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Browser } from '@wailsio/runtime'
import { PortForwardList, PortForwardStart, PortForwardStop } from '../../../bindings/kubegui/services/backend'
import type { PortForwardSession } from '../../../bindings/kubegui/services/models'
import { uiNotify } from './UiNotify'

interface ContainerPort {
  name?: string
  containerPort: number
  protocol?: string
}

interface PortForwardBadgesProps {
  namespace: string
  podName: string
  ports: ContainerPort[]
}

export function PortForwardBadges({ namespace, podName, ports }: PortForwardBadgesProps) {
  const [activeForwards, setActiveForwards] = useState<Map<string, PortForwardSession>>(new Map())
  const [loadingPort, setLoadingPort] = useState<string | null>(null)

  // Poll active forwards for this pod
  const refreshForwards = useCallback(async () => {
    try {
      const all = await PortForwardList()
      const podForwards = all.filter(
        (pf) => pf.namespace === namespace && pf.podName === podName && pf.status === 'active'
      )
      const map = new Map<string, PortForwardSession>()
      for (const pf of podForwards) {
        map.set(pf.remotePort, pf)
      }
      setActiveForwards(map)
    } catch {
      // ignore
    }
  }, [namespace, podName])

  useEffect(() => {
    void refreshForwards()
    const interval = setInterval(refreshForwards, 3000)
    return () => clearInterval(interval)
  }, [refreshForwards])

  const handleStart = async (remotePort: string) => {
    setLoadingPort(remotePort)
    try {
      const session = await PortForwardStart(namespace, podName, remotePort, '0')
      if (session.status === 'active') {
        uiNotify.success(`Port ${remotePort} → localhost:${session.localPort}`)
        void Browser.OpenURL(`http://localhost:${session.localPort}`)
      } else {
        uiNotify.error(`Port forward failed: ${session.error || 'unknown error'}`)
      }
      await refreshForwards()
    } catch (e) {
      uiNotify.error(`Port forward error: ${e instanceof Error ? e.message : 'unknown'}`)
    } finally {
      setLoadingPort(null)
    }
  }

  const handleStop = async (sessionID: string) => {
    try {
      await PortForwardStop(sessionID)
      uiNotify.success('Port forward stopped')
      await refreshForwards()
    } catch (e) {
      uiNotify.error(`Stop error: ${e instanceof Error ? e.message : 'unknown'}`)
    }
  }

  if (!ports.length) return null

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        Port Forwarding
        <span className="ml-1.5 text-muted-foreground/50 normal-case tracking-normal">
          ({ports.length})
        </span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {ports.map((port) => {
          const key = `${port.containerPort}`
          const active = activeForwards.get(key)
          const isLoading = loadingPort === key

          if (active) {
            return (
              <div
                key={key}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium bg-emerald-500/15 border border-emerald-500/30 text-emerald-400"
              >
                <PlugZap size={12} className="shrink-0" />
                <span>
                  {port.name ? `${port.name}: ` : ''}
                  {port.containerPort}
                  {port.protocol ? `/${port.protocol}` : ''}
                </span>
                <span className="text-emerald-400/60">→</span>
                <span className="font-mono">:{active.localPort}</span>
                <button
                  onClick={() => handleStop(active.id)}
                  className="ml-1 p-0.5 rounded hover:bg-emerald-500/20 transition-colors"
                  title="Stop port forward"
                >
                  <Square size={10} className="fill-current" />
                </button>
              </div>
            )
          }

          return (
            <button
              key={key}
              onClick={() => handleStart(key)}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium border border-border/60 text-muted-foreground hover:text-foreground hover:border-foreground/30 hover:bg-accent/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Plug size={12} className="shrink-0" />
              <span>
                {port.name ? `${port.name}: ` : ''}
                {port.containerPort}
                {port.protocol ? `/${port.protocol}` : ''}
              </span>
              {isLoading && <span className="w-3 h-3 rounded-full border border-current border-t-transparent animate-spin" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}