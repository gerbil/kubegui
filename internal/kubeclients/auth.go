package kubeclients

import (
	"kubegui/internal/db"
	"kubegui/internal/logger"

	authclient "k8s.io/client-go/kubernetes/typed/authorization/v1"
	"k8s.io/client-go/tools/clientcmd"
)

func GetAuthClient() (client *authclient.AuthorizationV1Client, err error) {
	clusterConfig, err := db.GetActiveClusterconfig()
	if err != nil {
		logger.Logger.Error("Error getting active config from DB: ", err)
		return
	}

	rules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: clusterConfig.ConfigPath}
	overrides := &clientcmd.ConfigOverrides{CurrentContext: clusterConfig.Context}

	clientConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(rules, overrides)

	// Build *rest.Config (includes auth from the chosen context: certs, tokens, exec plugins, etc.)
	config, err := clientConfig.ClientConfig()
	if err != nil {
		logger.Logger.Error("Error building client config: ", err)
		return
	}

	// config.QPS = 100
	// config.Burst = 200
	// config.RateLimiter = flowcontrol.NewFakeAlwaysRateLimiter()

	client, err = authclient.NewForConfig(config)
	if err != nil {
		logger.Logger.Error("Error creating auth client: ", err)
		return
	}

	return
}
