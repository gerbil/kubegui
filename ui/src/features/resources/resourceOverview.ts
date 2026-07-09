export type OverviewFieldSpec = {
  path: string
  description: string
  resolve?: (resource: Record<string, unknown>) => unknown
  format?: (value: unknown) => string
}

// ── Generic K8s field descriptions ───────────────────────────────────────────
// Keyed by "section.fieldName" (e.g. "metadata.name", "spec.replicas").
// Used by TooltipResourceSection for hover tooltips on all fields.
export const K8S_FIELD_DESCRIPTIONS: Record<string, string> = {
  // metadata
  'metadata.name':                        'Name must be unique within a namespace. Required. Cannot be updated.',
  'metadata.generateName':                'Optional prefix used by the server to generate a unique name.',
  'metadata.namespace':                   'Namespace defines the space within which the name must be unique.',
  'metadata.uid':                         'Unique identifier in time and space. Set by the server.',
  'metadata.resourceVersion':             'Internal version string used for optimistic concurrency. Changes on every write.',
  'metadata.generation':                  'Sequence number incremented each time the desired state changes.',
  'metadata.creationTimestamp':           'RFC 3339 date-time when the object was created.',
  'metadata.deletionTimestamp':           'RFC 3339 date-time after which the object will be deleted. Set by server on graceful deletion.',
  'metadata.deletionGracePeriodSeconds':  'Seconds before the object is forcefully deleted.',
  'metadata.finalizers':                  'List of identifiers that must be removed before this object can be deleted.',
  'metadata.ownerReferences':             'List of objects this object depends on. GC will delete this object if all owners are removed.',
  'metadata.clusterName':                 'Deprecated: Cluster name this object belongs to.',
  'metadata.selfLink':                    'Deprecated: URL representing this object.',
  // spec – workloads
  'spec.replicas':                        'Desired number of pod replicas.',
  'spec.selector':                        'Label selector used to identify pods managed by this resource. Required; immutable.',
  'spec.template':                        'Pod template used to create pods. Changes trigger rolling updates.',
  'spec.strategy':                        'Update strategy: RollingUpdate or Recreate.',
  'spec.updateStrategy':                  'Update strategy for DaemonSet/StatefulSet.',
  'spec.podManagementPolicy':             'Pod creation order for StatefulSet: OrderedReady (default) or Parallel.',
  'spec.serviceName':                     'Governing Service name for StatefulSet. Required.',
  'spec.volumeClaimTemplates':            'PVC templates for StatefulSet — one PVC is created per pod.',
  'spec.minReadySeconds':                 'Seconds a pod must be ready before being considered available.',
  'spec.revisionHistoryLimit':            'Old ReplicaSets to keep for rollback.',
  'spec.paused':                          'When true, the deployment controller stops reconciling.',
  'spec.progressDeadlineSeconds':         'Seconds to wait for deployment progress before marking it as failed.',
  // spec – pod
  'spec.nodeName':                        'Node the pod was scheduled onto. Empty means scheduler will pick.',
  'spec.nodeSelector':                    'Key-value pairs that must match node labels for scheduling.',
  'spec.serviceAccountName':              'ServiceAccount the pod runs under. Defaults to "default".',
  'spec.automountServiceAccountToken':    'Whether to automount the service account token. Defaults to true.',
  'spec.hostNetwork':                     'Use the host network namespace (shares IP and ports with host).',
  'spec.hostPID':                         'Use the host PID namespace.',
  'spec.hostIPC':                         'Use the host IPC namespace.',
  'spec.containers':                      'List of application containers.',
  'spec.initContainers':                  'Init containers run to completion before app containers start.',
  'spec.ephemeralContainers':             'Temporary containers added to a running pod for debugging.',
  'spec.volumes':                         'Volumes that containers in the pod can mount.',
  'spec.restartPolicy':                   'Restart policy: Always, OnFailure, or Never.',
  'spec.terminationGracePeriodSeconds':   'Seconds to wait for graceful shutdown before SIGKILL.',
  'spec.dnsPolicy':                       'DNS resolution policy: ClusterFirstWithHostNet, ClusterFirst, Default, or None.',
  'spec.dnsConfig':                       'Custom DNS configuration for the pod.',
  'spec.tolerations':                     'Tolerations allow the pod to schedule onto nodes with matching taints.',
  'spec.affinity':                        'Affinity and anti-affinity scheduling rules.',
  'spec.priorityClassName':               'Priority class name, affecting pod scheduling priority.',
  'spec.priority':                        'Integer priority. Higher values are scheduled first.',
  'spec.schedulerName':                   'Scheduler to use. Defaults to "default-scheduler".',
  'spec.securityContext':                 'Security settings applied at the pod level.',
  'spec.imagePullSecrets':                'Secret names used to pull container images.',
  'spec.runtimeClassName':                'RuntimeClass for container runtime selection.',
  'spec.preemptionPolicy':                'Preemption policy: PreemptLowerPriority or Never.',
  'spec.overhead':                        'Resource overhead for the pod (added to container requests/limits).',
  'spec.topologySpreadConstraints':       'Rules for spreading pods across topology domains.',
  'spec.readinessGates':                  'Additional conditions evaluated for pod readiness.',
  'spec.os':                              'Target OS for the pod (linux/windows).',
  // spec – job / cronjob
  'spec.schedule':                        'Cron expression in UTC. E.g. "*/5 * * * *".',
  'spec.suspend':                         'Suspends new job executions when true.',
  'spec.jobTemplate':                     'Template for jobs created by this CronJob.',
  'spec.concurrencyPolicy':               'How to handle concurrent executions: Allow, Forbid, or Replace.',
  'spec.successfulJobsHistoryLimit':      'Completed jobs to retain for history.',
  'spec.failedJobsHistoryLimit':          'Failed jobs to retain for history.',
  'spec.startingDeadlineSeconds':         'Seconds after a missed schedule to still start the job.',
  'spec.completions':                     'Desired number of successfully finished pods.',
  'spec.parallelism':                     'Max pods running in parallel.',
  'spec.backoffLimit':                    'Retries before marking the job failed.',
  'spec.activeDeadlineSeconds':           'Duration (s) the job may be active. After this, all pods are terminated.',
  'spec.ttlSecondsAfterFinished':         'Seconds after completion before the job is auto-deleted.',
  'spec.completionMode':                  'Job completion mode: NonIndexed or Indexed.',
  // spec – service
  'spec.type':                            'Service type: ClusterIP, NodePort, LoadBalancer, or ExternalName.',
  'spec.clusterIP':                       'Virtual IP assigned to the service. "None" = headless.',
  'spec.clusterIPs':                      'Dual-stack IPs assigned to the service.',
  'spec.ports':                           'Ports exposed by the service.',
  'spec.sessionAffinity':                 'Session affinity: None or ClientIP.',
  'spec.sessionAffinityConfig':           'Configuration for session affinity timeout.',
  'spec.loadBalancerIP':                  'IP to use when provisioning a LoadBalancer.',
  'spec.loadBalancerSourceRanges':        'Client IPs allowed to use the LoadBalancer.',
  'spec.externalTrafficPolicy':           'External traffic routing: Cluster (default) or Local.',
  'spec.internalTrafficPolicy':           'Internal traffic routing: Cluster or Local.',
  'spec.externalIPs':                     'External IPs that route to this service.',
  'spec.externalName':                    'External DNS name (ExternalName services only).',
  'spec.publishNotReadyAddresses':        'Include unready endpoints in DNS.',
  'spec.ipFamilies':                      'IP families (IPv4, IPv6) assigned to the service.',
  'spec.ipFamilyPolicy':                  'IP family allocation policy: SingleStack, PreferDualStack, RequireDualStack.',
  // spec – ingress
  'spec.rules':                           'Host rules mapping paths to Service backends.',
  'spec.ingressClassName':                'IngressClass resource that implements this Ingress.',
  'spec.tls':                             'TLS configuration (host → secret mapping).',
  'spec.defaultBackend':                  'Default backend for requests that match no rule.',
  // spec – volumes / storage
  'spec.capacity':                        'Capacity map (e.g. storage: 10Gi) for PersistentVolume.',
  'spec.accessModes':                     'Supported access modes: ReadWriteOnce, ReadOnlyMany, ReadWriteMany.',
  'spec.persistentVolumeReclaimPolicy':   'What happens after PVC is deleted: Retain, Recycle, or Delete.',
  'spec.storageClassName':                'StorageClass that provisions this volume.',
  'spec.volumeMode':                      'Volume mode: Filesystem (default) or Block.',
  'spec.mountOptions':                    'Extra mount options (e.g. "hard", "nfsvers=4.1").',
  'spec.resources':                       'Requested storage resources.',
  'spec.volumeName':                      'Binding to a specific PersistentVolume.',
  'spec.volumeBindingMode':               'When volume binding occurs: Immediate or WaitForFirstConsumer.',
  'spec.allowVolumeExpansion':            'Whether volumes can be expanded after creation.',
  'spec.provisioner':                     'Volume provisioner plugin (e.g. kubernetes.io/aws-ebs).',
  'spec.reclaimPolicy':                   'Reclaim policy for dynamically provisioned volumes.',
  'spec.parameters':                      'Provisioner-specific parameters.',
  // spec – hpa
  'spec.minReplicas':                     'Lower bound for replica count. Defaults to 1.',
  'spec.maxReplicas':                     'Upper bound for replica count. Required.',
  'spec.metrics':                         'Metrics used to compute desired replica count.',
  'spec.scaleTargetRef':                  'Reference to the scalable object (Deployment, StatefulSet, etc.).',
  'spec.behavior':                        'Scale-up and scale-down stabilization policies.',
  // spec – node
  'spec.podCIDR':                         'Primary CIDR assigned to pods on this node.',
  'spec.podCIDRs':                        'All CIDR ranges assigned to pods on this node.',
  'spec.providerID':                      'Cloud-provider-specific instance ID.',
  'spec.unschedulable':                   'When true, new pods are not scheduled here (cordoned).',
  'spec.taints':                          'Taints that repel pods without matching tolerations.',
  'spec.configSource':                    'Dynamic kubelet configuration source.',
  // spec – network policy
  'spec.policyTypes':                     'Policy types enforced: Ingress, Egress, or both.',
  'spec.ingress':                         'Ingress whitelist rules.',
  'spec.egress':                          'Egress whitelist rules.',
  'spec.podSelector':                     'Selects pods this policy applies to. Empty = all pods in namespace.',
  // spec – rbac
  'spec.roleRef':                         'Reference to the Role or ClusterRole being bound.',
  'spec.subjects':                        'List of subjects (users, groups, service accounts) being bound.',
  // status – common
  'status.phase':                         'Current lifecycle phase.',
  'status.conditions':                    'Latest observations of the resource state.',
  'status.observedGeneration':            'Generation most recently observed by the controller.',
  'status.replicas':                      'Total non-terminated pods targeted by this resource.',
  'status.readyReplicas':                 'Pods that have been ready for at least minReadySeconds.',
  'status.availableReplicas':             'Pods available to serve traffic.',
  'status.updatedReplicas':               'Pods running the latest pod template.',
  'status.unavailableReplicas':           'Pods that should be ready but are not.',
  'status.collisionCount':                'Count of hash collisions for the controller.',
  'status.currentRevision':              'Current controller revision.',
  'status.updateRevision':               'Revision of the latest rolling update.',
  'status.desiredNumberScheduled':        'Total nodes that should run the daemon pod.',
  'status.currentNumberScheduled':        'Nodes currently running the daemon pod.',
  'status.numberMisscheduled':            'Nodes running the daemon pod that should not be.',
  'status.numberReady':                   'Nodes running the daemon pod and reporting Ready.',
  'status.numberAvailable':               'Nodes where the daemon pod is available.',
  'status.numberUnavailable':             'Nodes where the daemon pod is not yet available.',
  'status.active':                        'Number of actively running pods.',
  'status.succeeded':                     'Pods that completed successfully.',
  'status.failed':                        'Pods that have reached the Failed phase.',
  'status.completionTime':                'Time when the job finished.',
  'status.startTime':                     'Time when the job/pod was acknowledged by the system.',
  'status.podIP':                         'IP address allocated to the pod.',
  'status.podIPs':                        'All IP addresses allocated to the pod (dual-stack).',
  'status.hostIP':                        'IP address of the host running the pod.',
  'status.containerStatuses':             'Status of each container.',
  'status.initContainerStatuses':         'Status of each init container.',
  'status.ephemeralContainerStatuses':    'Status of each ephemeral container.',
  'status.nominatedNodeName':             'Node nominated to run a preempted pod.',
  'status.qosClass':                      'QoS class: Guaranteed, Burstable, or BestEffort.',
  'status.addresses':                     'Network addresses reachable to the node.',
  'status.allocatable':                   'Resources available for scheduling (capacity minus system reserved).',
  'status.capacity':                      'Total hardware resources of the node.',
  'status.nodeInfo':                      'Operating system and kernel info for the node.',
  'status.images':                        'Container image layers cached on the node.',
  'status.daemonEndpoints':               'Port of the kubelet daemon on this node.',
  'status.volumesAttached':               'Volumes currently attached to this node.',
  'status.volumesInUse':                  'Volume device paths in use by pods on this node.',
  'status.loadBalancer':                  'LoadBalancer ingress points (IP/hostname).',
  'status.currentMetrics':                'Current metric values used by the HPA.',
  'status.desiredReplicas':               'Desired replica count computed by the HPA controller.',
  'status.lastScaleTime':                 'Last time the HPA scaled the target.',
  'status.currentCPUUtilizationPercentage': 'Current average CPU utilization across all pods.',
  'status.accessModes':                   'Actual access modes for the PV/PVC.',
  'status.reason':                        'Brief machine-readable reason for the current condition.',
  'status.message':                       'Human-readable message indicating condition details.',
}

function getByPath(source: unknown, path: string): unknown {
  if (!source || typeof source !== 'object') return undefined
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (!acc || typeof acc !== 'object') return undefined
    return (acc as Record<string, unknown>)[segment]
  }, source)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function formatScalar(value: unknown): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '—'
    return value.map((entry) => formatScalar(entry)).join(', ')
  }
  return JSON.stringify(value)
}

function formatAddress(type: string) {
  return (resource: Record<string, unknown>) => {
    const status = asRecord(resource.status)
    const addresses = Array.isArray(status?.addresses) ? (status.addresses as unknown[]) : []
    for (const entry of addresses) {
      const address = asRecord(entry)
      if (address?.type === type) {
        return address.address
      }
    }
    return undefined
  }
}

function formatQuantityList(value: unknown): string {
  if (!Array.isArray(value)) return formatScalar(value)
  return value.join(', ')
}


export function resolveOverviewValue(resource: Record<string, unknown>, field: OverviewFieldSpec): string {
  const raw = field.resolve ? field.resolve(resource) : getByPath(resource, field.path)
  return field.format ? field.format(raw) : formatScalar(raw)
}

export const nodeOverviewFields: OverviewFieldSpec[] = [
  // ── Identity ──────────────────────────────────────────────────────────────
  {
    path: 'metadata.uid',
    description: 'Cluster-unique identifier assigned by Kubernetes to this node object.',
  },
  {
    path: 'metadata.creationTimestamp',
    description: 'Timestamp when the node resource object was first created in the API server.',
  },
  {
    path: 'metadata.resourceVersion',
    description: 'Internal resource version used for optimistic concurrency control.',
  },
  // ── Network addresses ─────────────────────────────────────────────────────
  {
    path: 'status.addresses[InternalIP]',
    description: 'Primary internal IP address reported by the kubelet for this node.',
    resolve: formatAddress('InternalIP'),
  },
  {
    path: 'status.addresses[ExternalIP]',
    description: 'External IP address of the node (if available).',
    resolve: formatAddress('ExternalIP'),
  },
  {
    path: 'status.addresses[Hostname]',
    description: 'Hostname address reported for this node by Kubernetes.',
    resolve: formatAddress('Hostname'),
  },
  // ── Spec ──────────────────────────────────────────────────────────────────
  {
    path: 'spec.podCIDR',
    description: 'Primary CIDR assigned to pods running on this node.',
  },
  {
    path: 'spec.podCIDRs',
    description: 'Full list of pod CIDR ranges assigned to this node.',
    format: formatQuantityList,
  },
  {
    path: 'spec.providerID',
    description: 'Cloud-provider-specific node identifier used to map the Kubernetes node to infrastructure.',
  },
  {
    path: 'spec.unschedulable',
    description: 'When true the node is cordoned and will not accept new pod scheduling.',
  },
  {
    path: 'spec.taints',
    description: 'Taints applied to this node that affect pod scheduling.',
    resolve: (resource) => {
      const spec = asRecord(resource.spec)
      const taints = Array.isArray(spec?.taints) ? (spec!.taints as Array<Record<string, unknown>>) : []
      if (taints.length === 0) return undefined
      return taints.map((t) => `${String(t.key ?? '')}:${String(t.effect ?? '')}${t.value ? '=' + String(t.value) : ''}`).join(', ')
    },
  },
  // ── Allocatable / Capacity ────────────────────────────────────────────────
  {
    path: 'status.allocatable.cpu',
    description: 'CPU allocatable to pods on this node.',
    resolve: (resource) => (asRecord(asRecord(resource.status)?.allocatable))?.cpu,
  },
  {
    path: 'status.allocatable.memory',
    description: 'Memory allocatable to pods on this node.',
    resolve: (resource) => (asRecord(asRecord(resource.status)?.allocatable))?.memory,
  },
  {
    path: 'status.allocatable.pods',
    description: 'Maximum number of pods that can be scheduled on this node.',
    resolve: (resource) => (asRecord(asRecord(resource.status)?.allocatable))?.pods,
  },
  {
    path: 'status.allocatable.ephemeral-storage',
    description: 'Ephemeral storage allocatable to pods on this node.',
    resolve: (resource) => (asRecord(asRecord(resource.status)?.allocatable))?.[
      'ephemeral-storage'
    ],
  },
  {
    path: 'status.capacity.cpu',
    description: 'Total CPU capacity of the node.',
    resolve: (resource) => (asRecord(asRecord(resource.status)?.capacity))?.cpu,
  },
  {
    path: 'status.capacity.memory',
    description: 'Total memory capacity of the node.',
    resolve: (resource) => (asRecord(asRecord(resource.status)?.capacity))?.memory,
  },
  // ── Volumes ───────────────────────────────────────────────────────────────
  {
    path: 'status.volumesAttached',
    description: 'Number of volumes currently attached to this node.',
    resolve: (resource) => {
      const v = (asRecord(resource.status)?.volumesAttached as unknown[]) ?? []
      return v.length > 0 ? v.length : undefined
    },
  },
  {
    path: 'status.volumesInUse',
    description: 'Number of volumes in use by pods on this node.',
    resolve: (resource) => {
      const v = (asRecord(resource.status)?.volumesInUse as unknown[]) ?? []
      return v.length > 0 ? v.length : undefined
    },
  },
  // ── Daemon endpoint ───────────────────────────────────────────────────────
  {
    path: 'status.daemonEndpoints.kubeletEndpoint.Port',
    description: 'Port on which the kubelet is listening.',
    resolve: (resource) => {
      const de = asRecord(asRecord(resource.status)?.daemonEndpoints)
      const ke = asRecord(de?.kubeletEndpoint)
      return ke?.Port
    },
  },
]

export const namespaceOverviewFields: OverviewFieldSpec[] = [
  {
    path: 'metadata.uid',
    description: 'Cluster-unique identifier assigned by Kubernetes to this namespace object.',
  },
  {
    path: 'metadata.creationTimestamp',
    description: 'Timestamp when this namespace was created in the API server.',
  },
  {
    path: 'status.phase',
    description: 'Current lifecycle phase of the namespace.',
  },
  {
    path: 'spec.finalizers',
    description: 'Finalizers that must complete before the namespace can be fully deleted.',
    format: formatQuantityList,
  },
]

export const podOverviewFields: OverviewFieldSpec[] = [
  { path: 'metadata.uid', description: 'Unique identifier assigned by the API server to this pod.' },
  { path: 'metadata.namespace', description: 'Namespace this pod belongs to.' },
  { path: 'metadata.creationTimestamp', description: 'When the pod was first created.' },
  { path: 'spec.nodeName', description: 'The node this pod was scheduled onto.' },
  { path: 'spec.serviceAccountName', description: 'Service account used by this pod.' },
  { path: 'spec.restartPolicy', description: 'Pod restart policy: Always, OnFailure, or Never.' },
  { path: 'spec.priorityClassName', description: 'Priority class that determines scheduling priority.' },
  { path: 'spec.hostNetwork', description: 'Whether the pod uses the host network namespace.' },
  { path: 'status.phase', description: 'Current lifecycle phase of the pod.' },
  { path: 'status.podIP', description: 'Primary IP address assigned to this pod.' },
  { path: 'status.hostIP', description: 'IP address of the node the pod is running on.' },
  { path: 'status.startTime', description: 'Time when the pod was acknowledged by the kubelet.' },
  {
    path: 'spec.containers',
    description: 'Container names and images running in this pod.',
    resolve: (resource) => {
      const spec = resource.spec as Record<string, unknown> | undefined
      const containers = Array.isArray(spec?.containers) ? (spec!.containers as Array<Record<string, unknown>>) : []
      return containers.map((c) => `${String(c.name ?? '')}=${String(c.image ?? '')}`).join(', ')
    },
  },
  {
    path: 'status.conditions',
    description: 'Pod condition types and their current status.',
    resolve: (resource) => {
      const status = resource.status as Record<string, unknown> | undefined
      const conditions = Array.isArray(status?.conditions) ? (status!.conditions as Array<Record<string, unknown>>) : []
      return conditions.map((c) => `${String(c.type ?? '')}=${String(c.status ?? '')}`).join(', ')
    },
  },
  {
    path: 'metadata.ownerReferences',
    description: 'Controller that owns and manages this pod (e.g. ReplicaSet, DaemonSet).',
    resolve: (resource) => {
      const meta = resource.metadata as Record<string, unknown> | undefined
      const owners = Array.isArray(meta?.ownerReferences) ? (meta!.ownerReferences as Array<Record<string, unknown>>) : []
      return owners.map((o) => `${String(o.kind ?? '')}/${String(o.name ?? '')}`).join(', ')
    },
  },
]

export const deploymentOverviewFields: OverviewFieldSpec[] = [
  { path: 'metadata.uid', description: 'Unique identifier assigned by the API server to this deployment.' },
  { path: 'metadata.namespace', description: 'Namespace this deployment belongs to.' },
  { path: 'metadata.creationTimestamp', description: 'When the deployment was first created.' },
  { path: 'spec.replicas', description: 'Desired number of pod replicas.' },
  { path: 'status.readyReplicas', description: 'Number of pods ready to serve traffic.' },
  { path: 'status.updatedReplicas', description: 'Number of pods updated to the latest template.' },
  { path: 'status.availableReplicas', description: 'Number of pods available to serve traffic.' },
  { path: 'spec.strategy.type', description: 'Update strategy: RollingUpdate or Recreate.' },
  {
    path: 'spec.strategy.rollingUpdate',
    description: 'Max unavailable and max surge settings for rolling updates.',
    resolve: (resource) => {
      const spec = resource.spec as Record<string, unknown> | undefined
      const strategy = spec?.strategy as Record<string, unknown> | undefined
      const ru = strategy?.rollingUpdate as Record<string, unknown> | undefined
      if (!ru) return '—'
      return `maxUnavailable=${String(ru.maxUnavailable ?? '?')} maxSurge=${String(ru.maxSurge ?? '?')}`
    },
  },
  { path: 'spec.selector', description: 'Label selector used to identify pods managed by this deployment.',
    resolve: (resource) => {
      const spec = resource.spec as Record<string, unknown> | undefined
      const sel = spec?.selector as Record<string, unknown> | undefined
      const ml = sel?.matchLabels as Record<string, unknown> | undefined
      if (!ml) return '—'
      return Object.entries(ml).map(([k, v]) => `${k}=${String(v)}`).join(', ')
    },
  },
  {
    path: 'spec.template.spec.containers',
    description: 'Container names and images in the pod template.',
    resolve: (resource) => {
      const spec = resource.spec as Record<string, unknown> | undefined
      const tmpl = spec?.template as Record<string, unknown> | undefined
      const tspec = tmpl?.spec as Record<string, unknown> | undefined
      const containers = Array.isArray(tspec?.containers) ? (tspec!.containers as Array<Record<string, unknown>>) : []
      return containers.map((c) => `${String(c.name ?? '')}=${String(c.image ?? '')}`).join(', ')
    },
  },
]
