package kubeclients

import (
	"kubegui/internal/db"
	"kubegui/internal/logger"

	ciliumclient "github.com/cilium/cilium/pkg/k8s/client/clientset/versioned"
	"k8s.io/client-go/tools/clientcmd"
)

func GetCiliumClientset() (client *ciliumclient.Clientset, err error) {
	clusterConfig, err := db.GetActiveClusterconfig()
	if err != nil {
		logger.Logger.Error("Error getting active config from DB: ", err)
		return
	}

	// This honors the chosen context and all kubeconfig auth methods (certs, tokens, exec plugins, etc.).
	rules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: clusterConfig.ConfigPath}
	overrides := &clientcmd.ConfigOverrides{CurrentContext: clusterConfig.Context}

	cc := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(rules, overrides)

	clientConfig, err := cc.ClientConfig()
	if err != nil {
		return
	}

	client, err = ciliumclient.NewForConfig(clientConfig)
	if err != nil {
		logger.Logger.Error("Error creating cilium client: ", err)
		return
	}

	return
}
