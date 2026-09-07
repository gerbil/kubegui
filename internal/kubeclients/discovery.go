package kubeclients

import (
	"kubegui/internal/db"
	"kubegui/internal/logger"

	"k8s.io/client-go/discovery"
	"k8s.io/client-go/tools/clientcmd"
)

func GetDiscoveryClient() (client *discovery.DiscoveryClient, err error) {
	clusterConfig, _ := db.GetActiveClusterconfig()
	if err != nil {
		logger.Logger.Error("error getting active config from DB: ", err)
		return
	}

	rules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: clusterConfig.ConfigPath}
	overrides := &clientcmd.ConfigOverrides{CurrentContext: clusterConfig.Context}

	cc := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(rules, overrides)

	// Build *rest.Config
	clientConfig, err := cc.ClientConfig()
	if err != nil {
		return
	}

	// Tweaks
	//clientConfig.QPS = 100
	//clientConfig.Burst = 200
	//clientConfig.RateLimiter = flowcontrol.NewFakeAlwaysRateLimiter()

	client, err = discovery.NewDiscoveryClientForConfig(clientConfig)
	if err != nil {
		logger.Logger.Error("error in discovery client %v", err)
	}

	return
}
