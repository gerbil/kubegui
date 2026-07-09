package kubeclients

import (
	"kubegui/internal/db"
	"kubegui/internal/logger"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
)

func GetClientset() (client *kubernetes.Clientset, err error) {
	clusterConfig, err := db.GetActiveClusterconfig()
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

	// config.QPS = 100
	// config.Burst = 200
	// config.RateLimiter = flowcontrol.NewFakeAlwaysRateLimiter()

	client, err = kubernetes.NewForConfig(clientConfig)
	if err != nil {
		logger.Logger.Error("error in clientset %v", err)
		return
	}

	return
}
