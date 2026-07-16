// Auto-loaded YAML templates for standard Kubernetes resource types.
// Each file is imported as a raw string via Vite's ?raw query so they
// live as plain YAML files and stay out of the main bundle source code.

import clusterrolebindingsYaml from '../assets/yaml-templates/clusterrolebindings.yaml?raw'
import clusterrolesYaml from '../assets/yaml-templates/clusterroles.yaml?raw'
import configmapsYaml from '../assets/yaml-templates/configmaps.yaml?raw'
import cronjobsYaml from '../assets/yaml-templates/cronjobs.yaml?raw'
import customresourcedefinitionsYaml from '../assets/yaml-templates/customresourcedefinitions.yaml?raw'
import daemonsetsYaml from '../assets/yaml-templates/daemonsets.yaml?raw'
import deploymentsYaml from '../assets/yaml-templates/deployments.yaml?raw'
import endpointsYaml from '../assets/yaml-templates/endpoints.yaml?raw'
import horizontalpodautoscalersYaml from '../assets/yaml-templates/horizontalpodautoscalers.yaml?raw'
import ingressesYaml from '../assets/yaml-templates/ingresses.yaml?raw'
import jobsYaml from '../assets/yaml-templates/jobs.yaml?raw'
import limitrangesYaml from '../assets/yaml-templates/limitranges.yaml?raw'
import namespacesYaml from '../assets/yaml-templates/namespaces.yaml?raw'
import networkpoliciesYaml from '../assets/yaml-templates/networkpolicies.yaml?raw'
import persistentvolumeclaimsYaml from '../assets/yaml-templates/persistentvolumeclaims.yaml?raw'
import persistentvolumesYaml from '../assets/yaml-templates/persistentvolumes.yaml?raw'
import poddisruptionbudgetsYaml from '../assets/yaml-templates/poddisruptionbudgets.yaml?raw'
import podsYaml from '../assets/yaml-templates/pods.yaml?raw'
import priorityclassesYaml from '../assets/yaml-templates/priorityclasses.yaml?raw'
import replicasetsYaml from '../assets/yaml-templates/replicasets.yaml?raw'
import resourcequotasYaml from '../assets/yaml-templates/resourcequotas.yaml?raw'
import rolebindingsYaml from '../assets/yaml-templates/rolebindings.yaml?raw'
import rolesYaml from '../assets/yaml-templates/roles.yaml?raw'
import runtimeclassesYaml from '../assets/yaml-templates/runtimeclasses.yaml?raw'
import secretsYaml from '../assets/yaml-templates/secrets.yaml?raw'
import serviceaccountsYaml from '../assets/yaml-templates/serviceaccounts.yaml?raw'
import servicesYaml from '../assets/yaml-templates/services.yaml?raw'
import statefulSetsYaml from '../assets/yaml-templates/statefulsets.yaml?raw'
import storageclassesYaml from '../assets/yaml-templates/storageclasses.yaml?raw'
import volumeattachmentsYaml from '../assets/yaml-templates/volumeattachments.yaml?raw'

/** Map from Kubernetes plural resource name → default YAML template string. */
export const RESOURCE_YAML_TEMPLATES: Record<string, string> = {
  clusterrolebindings: clusterrolebindingsYaml,
  clusterroles: clusterrolesYaml,
  configmaps: configmapsYaml,
  cronjobs: cronjobsYaml,
  customresourcedefinitions: customresourcedefinitionsYaml,
  daemonsets: daemonsetsYaml,
  deployments: deploymentsYaml,
  endpoints: endpointsYaml,
  horizontalpodautoscalers: horizontalpodautoscalersYaml,
  ingresses: ingressesYaml,
  jobs: jobsYaml,
  limitranges: limitrangesYaml,
  namespaces: namespacesYaml,
  networkpolicies: networkpoliciesYaml,
  persistentvolumeclaims: persistentvolumeclaimsYaml,
  persistentvolumes: persistentvolumesYaml,
  poddisruptionbudgets: poddisruptionbudgetsYaml,
  pods: podsYaml,
  priorityclasses: priorityclassesYaml,
  replicasets: replicasetsYaml,
  resourcequotas: resourcequotasYaml,
  rolebindings: rolebindingsYaml,
  roles: rolesYaml,
  runtimeclasses: runtimeclassesYaml,
  secrets: secretsYaml,
  serviceaccounts: serviceaccountsYaml,
  services: servicesYaml,
  statefulsets: statefulSetsYaml,
  storageclasses: storageclassesYaml,
  volumeattachments: volumeattachmentsYaml,
}

