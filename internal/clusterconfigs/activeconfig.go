package clusterconfigs

import (
	"fmt"

	"kubegui/internal/db"

	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// GetActiveConfigAndRaw returns the active DB cluster config entry and the parsed kubeconfig API object.
func GetActiveConfigAndRaw() (db.Clusterconfig, *clientcmdapi.Config, error) {
	active, err := db.GetActiveClusterconfig()
	if err != nil || active.ConfigPath == "" {
		configs, listErr := db.GetClusterconfigs()
		if listErr != nil {
			return db.Clusterconfig{}, nil, listErr
		}
		if len(configs) == 0 {
			return db.Clusterconfig{}, nil, fmt.Errorf("no cluster config available")
		}
		active = configs[0]
	}
	rules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: active.ConfigPath}
	raw, err := rules.Load()
	if err != nil {
		return db.Clusterconfig{}, nil, err
	}
	return active, raw, nil
}
