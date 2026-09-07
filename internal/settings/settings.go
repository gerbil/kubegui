package settings

import (
	"kubegui/internal/kubeclients"
)

func GetCurrentClusterVersion() (version string, err error) {
	cs, err := kubeclients.GetClientset()
	if err != nil {
		return
	}

	vinfo, err := cs.Discovery().ServerVersion()
	if err != nil {
		return
	}
	version = vinfo.GitVersion
	return
}
