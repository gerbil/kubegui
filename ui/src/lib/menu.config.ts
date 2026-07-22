import {
  Boxes,
  CheckCircle2,
  Container,
  Database,
  Grid3X3,
  Globe,
  HardDrive,
  Layers,
  Lock,
  Router,
  LucideIcon,
  Zap,
  Shield,
  BarChart3,
  AlertCircle,
  Activity,
  Users,
  Puzzle,
  ShieldCheck,
} from 'lucide-react'
export type MenuItem = {
  id: string
  label: string
  icon: LucideIcon
  href?: string
  section?: string
  subsections?: MenuItem[]
  badge?: string
  badgeColor?: 'emerald' | 'amber' | 'red' | 'blue'
}
export type MenuSection = {
  id: string
  label: string
  items: MenuItem[]
}
export const INFORMER_RESOURCE_NAMES = [
  'clusterrolebindings',
  'clusterroles',
  'configmaps',
  'cronjobs',
  'daemonsets',
  'deployments',
  'endpoints',
  'events',
  'horizontalpodautoscalers',
  'ingresses',
  'jobs',
  'limitranges',
  'namespaces',
  'networkpolicies',
  'nodes',
  'persistentvolumeclaims',
  'persistentvolumes',
  'poddisruptionbudgets',
  'pods',
  'priorityclasses',
  'replicasets',
  'resourcequotas',
  'rolebindings',
  'roles',
  'runtimeclasses',
  'secrets',
  'serviceaccounts',
  'services',
  'statefulsets',
  'storageclasses',
  'volumeattachments',
] as const
type InformerResourceName = typeof INFORMER_RESOURCE_NAMES[number]
const INFORMER_RESOURCE_LABEL_OVERRIDES: Record<InformerResourceName, string> = {
  clusterrolebindings: 'ClusterRoleBindings',
  clusterroles: 'ClusterRoles',
  configmaps: 'ConfigMaps',
  cronjobs: 'CronJobs',
  daemonsets: 'DaemonSets',
  deployments: 'Deployments',
  endpoints: 'Endpoints',
  events: 'Events',
  horizontalpodautoscalers: 'HorizontalPodAutoscalers',
  ingresses: 'Ingresses',
  jobs: 'Jobs',
  limitranges: 'LimitRanges',
  namespaces: 'Namespaces',
  networkpolicies: 'NetworkPolicies',
  nodes: 'Nodes',
  persistentvolumeclaims: 'PersistentVolumeClaims',
  persistentvolumes: 'PersistentVolumes',
  poddisruptionbudgets: 'PodDisruptionBudgets',
  pods: 'Pods',
  priorityclasses: 'PriorityClasses',
  replicasets: 'ReplicaSets',
  resourcequotas: 'ResourceQuotas',
  rolebindings: 'RoleBindings',
  roles: 'Roles',
  runtimeclasses: 'RuntimeClasses',
  secrets: 'Secrets',
  serviceaccounts: 'ServiceAccounts',
  services: 'Services',
  statefulsets: 'StatefulSets',
  storageclasses: 'StorageClasses',
  volumeattachments: 'VolumeAttachments',
}
export function getInformerResourceLabel(resource: string): string {
  if ((INFORMER_RESOURCE_NAMES as readonly string[]).includes(resource)) {
    return INFORMER_RESOURCE_LABEL_OVERRIDES[resource as InformerResourceName]
  }
  return resource
}
function informerItem(resource: InformerResourceName, icon: LucideIcon, href?: string): MenuItem {
  return {
    id: `resource-${resource}`,
    label: getInformerResourceLabel(resource),
    icon,
    href: href ?? `/resources/${resource}`,
  }
}
export const menuConfig: MenuSection[] = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        icon: Grid3X3,
        href: '/',
      },
    ],
  },
  {
    id: 'cluster-core',
    label: 'Cluster Core',
    items: [
      informerItem('namespaces', Layers, '/namespaces'),
      informerItem('events', AlertCircle),
    ],
  },
  {
    id: 'workloads',
    label: 'Workloads',
    items: [
      {
        id: 'workloads-group',
        label: 'Workloads',
        icon: Container,
        subsections: [
          informerItem('pods', Boxes, '/pods'),
          informerItem('deployments', Container),
          informerItem('daemonsets', Zap),
          informerItem('statefulsets', Database),
          informerItem('replicasets', Boxes),
          informerItem('jobs', CheckCircle2),
          informerItem('cronjobs', CheckCircle2),
          informerItem('horizontalpodautoscalers', Activity),
        ],
      },
    ],
  },
  {
    id: 'configuration',
    label: 'Configuration',
    items: [
      {
        id: 'configuration-group',
        label: 'Configuration',
        icon: HardDrive,
        subsections: [
          informerItem('configmaps', HardDrive),
          informerItem('secrets', Lock),
          informerItem('serviceaccounts', Users),
          informerItem('limitranges', BarChart3),
          informerItem('resourcequotas', BarChart3),
          informerItem('runtimeclasses', Zap),
        ],
      },
    ],
  },
  {
    id: 'network',
    label: 'Network',
    items: [
      {
        id: 'network-group',
        label: 'Network',
        icon: Router,
        subsections: [
          informerItem('services', Router),
          informerItem('endpoints', Router),
          informerItem('ingresses', Globe),
          informerItem('networkpolicies', Shield),
        ],
      },
    ],
  },
  {
    id: 'storage',
    label: 'Storage',
    items: [
      {
        id: 'storage-group',
        label: 'Storage',
        icon: Database,
        subsections: [
          informerItem('persistentvolumes', Database),
          informerItem('persistentvolumeclaims', Database),
          informerItem('storageclasses', HardDrive),
          informerItem('volumeattachments', HardDrive),
        ],
      },
    ],
  },
  {
    id: 'rbac',
    label: 'RBAC',
    items: [
      {
        id: 'rbac-group',
        label: 'RBAC',
        icon: Lock,
        subsections: [
          informerItem('roles', Lock),
          informerItem('rolebindings', Lock),
          informerItem('clusterroles', Shield),
          informerItem('clusterrolebindings', Shield),
        ],
      },
      {
        id: 'my-permissions',
        label: 'My Permissions',
        icon: ShieldCheck,
        href: '/my-permissions',
      },
    ],
  },
  {
    id: 'policy',
    label: 'Policy',
    items: [
      {
        id: 'policy-group',
        label: 'Policy',
        icon: Shield,
        subsections: [
          informerItem('poddisruptionbudgets', Shield),
          informerItem('priorityclasses', Zap),
        ],
      },
    ],
  },
  {
    id: 'crd-definitions-section',
    label: 'Custom Resources',
    items: [
      {
        id: 'crd-definitions',
        label: 'CRD Definitions',
        icon: Puzzle,
        href: '/crd-definitions',
      },
    ],
  },
]
export const sidebarConfig = {
  logo: {
    name: 'KubeGUI',
    subtitle: 'Kubernetes client',
    imageSrc: '/build/appicon.png',
    imageFallbackSrc: '/build/icon.ico',
    icon: Boxes,
  },
  health: {
    label: 'Health',
    value: '98%',
    delta: '+2.1%',
    status: 'healthy' as const,
  },
}
export function getMenuConfigForUser(_userRole: 'admin' | 'user' | 'viewer'): MenuSection[] {
  return menuConfig
}
