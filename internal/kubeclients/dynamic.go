package kubeclients

import (
	"fmt"
	"kubegui/internal/db"
	"kubegui/internal/logger"

	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/tools/clientcmd"
)

func GetDynamicClient() (client dynamic.Interface, err error) {
	clusterConfig, err := db.GetActiveClusterconfig()
	if err != nil {
		logger.Logger.Error("Error getting active config from DB: ", err)
		return nil, err
	}

	rules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: clusterConfig.ConfigPath}
	overrides := &clientcmd.ConfigOverrides{CurrentContext: clusterConfig.Context}

	cc := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(rules, overrides)

	// Build *rest.Config (includes auth from the chosen context: certs, tokens, exec plugins, etc.)
	config, err := cc.ClientConfig()
	if err != nil {
		logger.Logger.Error("Error building client config: ", err)
		return nil, err
	}

	// config.QPS = 100
	// config.Burst = 200
	// config.RateLimiter = flowcontrol.NewFakeAlwaysRateLimiter()

	client, err = dynamic.NewForConfig(config)
	if err != nil {
		logger.Logger.Error(fmt.Sprintf("error in dynamic client: %v", err))
		return nil, err
	}

	return
}
