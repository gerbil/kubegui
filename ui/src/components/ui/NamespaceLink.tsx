import { useResourcesStore } from '@/store/useResourcesStore'

interface NamespaceLinkProps {
  namespace: string
  targetResource?: string
  className?: string
  onSelectNamespace?: (namespace: string) => void
}

/**
 * Clickable namespace link with dashed underline.
 * By default it updates namespace in the current resource view.
 */
export function NamespaceLink({ namespace, targetResource, className = '', onSelectNamespace }: NamespaceLinkProps) {
  const { setSelectedNamespace, setSelectedResource } = useResourcesStore()

  const activate = () => {
    if (onSelectNamespace) {
      onSelectNamespace(namespace)
      return
    }

    setSelectedNamespace(namespace)
    if (targetResource) {
      setSelectedResource(targetResource)
    }
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    activate()
  }

  const title = targetResource
    ? `View ${targetResource} in ${namespace}`
    : `Set namespace filter to ${namespace}`

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center cursor-pointer bg-transparent border-0 p-0 font-inherit text-inherit underline decoration-dotted underline-offset-3 hover:opacity-70 transition-opacity ${className}`}
      title={title}
    >
      {namespace}
    </button>
  )
}
