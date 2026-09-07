# Wails services are exposed to the frontend via wails bridge

* `backend` - main backend service for kubegui
* `cluster` - cluster management service for switching and managing clusters
* `config` - configuration service for managing kubegui settings
* `crd` - service for managing Custom Resource Definitions (CRDs)
* `dashboard` - service for dashboard view and metrics
* `events` - service for managing and displaying Kubernetes events
* `exec` - service for executing commands in pods
* `graph` - service for generating resource graphs (RBAC, network policies, etc.)
* `health` - service for checking the health of the backend and cluster
* `informers` - service for watching Kubernetes resources and emitting events to the frontend
* `logs` - service for fetching and displaying logs from pods
* `metrics` - service for fetching and displaying metrics from the cluster
* `cleanup` - cleanup service for deleting resources
* `cvescan` - CVE scanning service for images
* `portforwarding`- service for port forwarding to pods
* `utils`- utility service for common functions