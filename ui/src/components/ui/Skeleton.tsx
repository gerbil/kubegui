import type { CSSProperties } from 'react'

interface SkeletonProps {
  className?: string
  style?: CSSProperties
}

/** Single shimmer block. Compose multiples to build skeleton layouts. */
export function Skeleton({ className = '', style }: SkeletonProps) {
  return <div className={`skeleton ${className}`} style={style} />
}

/** 4 pod-stat cards skeleton */
export function StatCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="lucid-panel rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-2 flex-1">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-7 w-12 mt-0.5" />
            </div>
            <Skeleton className="h-8 w-8 rounded-lg opacity-30" />
          </div>
          <div className="space-y-1.5">
            <Skeleton className="h-1.5 w-full rounded-full" />
            <Skeleton className="h-2.5 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Node card skeleton (cards view) */
export function NodeCardSkeleton() {
  return (
    <div className="lucid-panel rounded-xl p-4 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
        <Skeleton className="h-4 w-12 rounded-full" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((j) => (
          <div key={j} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-1">
              <Skeleton className="h-2 w-6" />
              <Skeleton className="h-2 w-6" />
            </div>
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-2 w-16" />
          <Skeleton className="h-2 w-10" />
        </div>
        <div className="flex flex-wrap gap-[3px]">
          {Array.from({ length: 12 }).map((_, k) => (
            <Skeleton key={k} className="w-2 h-2 rounded-sm" />
          ))}
        </div>
      </div>
    </div>
  )
}

/** Row of skeleton node cards (cards view) */
export function NodeCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => <NodeCardSkeleton key={i} />)}
    </div>
  )
}

/** Node table-row skeleton */
export function NodeRowSkeleton() {
  return (
    <div className="lucid-panel rounded-lg p-0 overflow-hidden">
      <div className="grid grid-cols-12">
        <div className="col-span-4 p-4 border-r border-border/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-36" />
              <Skeleton className="h-2 w-24" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            {[0, 1, 2, 3].map((j) => (
              <div key={j} className="flex flex-col gap-1 items-center">
                <Skeleton className="h-2 w-6" />
                <Skeleton className="h-2.5 w-6" />
              </div>
            ))}
          </div>
        </div>
        <div className="col-span-8 p-4 flex items-center">
          <div className="flex flex-wrap gap-[3px] flex-1">
            {Array.from({ length: 20 }).map((_, k) => (
              <Skeleton key={k} className="w-3 h-3 rounded-sm" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Stack of table-row skeletons (table view) */
export function NodeTableSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }).map((_, i) => <NodeRowSkeleton key={i} />)}
    </div>
  )
}

/** Log line skeletons for the Cluster Logs panel */
export function LogLinesSkeleton({ count = 6 }: { count?: number }) {
  const widths = ['w-3/4', 'w-5/6', 'w-2/3', 'w-4/5', 'w-3/5', 'w-5/6', 'w-2/4', 'w-4/6']
  return (
    <div className="space-y-2.5 p-1">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton className="h-2 w-12 shrink-0" />
          <Skeleton className="h-2 w-10 shrink-0" />
          <Skeleton className={`h-2 ${widths[i % widths.length]}`} />
        </div>
      ))}
    </div>
  )
}

/** Event line skeletons for the Cluster Events panel */
export function EventLinesSkeleton({ count = 5 }: { count?: number }) {
  const widths = ['w-2/3', 'w-3/4', 'w-1/2', 'w-4/5', 'w-3/5']
  return (
    <div className="space-y-2.5 p-1">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton className="h-2 w-12 shrink-0" />
          <Skeleton className="h-2 w-10 shrink-0" />
          <Skeleton className={`h-2 ${widths[i % widths.length]}`} />
        </div>
      ))}
    </div>
  )
}

/** Context card skeleton for the InitPage */
export function ContextCardSkeleton() {
  return (
    <div className="lucid-panel rounded-xl p-3.5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-1.5">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Skeleton className="w-6 h-6 rounded-md shrink-0" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      </div>
      <Skeleton className="h-px w-full" />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-2 w-2 rounded-sm shrink-0" />
          <Skeleton className="h-2 w-2/3" />
        </div>
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-2 w-2 rounded-sm shrink-0" />
          <Skeleton className="h-2 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-4 w-8 rounded-full mt-auto" />
    </div>
  )
}

/** Grid of context card skeletons */
export function ContextCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: count }).map((_, i) => <ContextCardSkeleton key={i} />)}
    </div>
  )
}