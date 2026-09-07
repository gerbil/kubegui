package kubeclients

import (
  "kubegui/internal/db"
  "kubegui/internal/logger"

  "k8s.io/client-go/tools/clientcmd"
  metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

func GetMetricsClient() (clientset *metricsclient.Clientset, err error) {
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

  // Generate the metrics client
  clientset, err = metricsclient.NewForConfig(clientConfig)
  if err != nil {
    logger.Logger.Error("unable to generate a clientset: %s", err.Error())
  }

  return
}