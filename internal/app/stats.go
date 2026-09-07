package app

import (
	"os"

	"github.com/shirou/gopsutil/v4/process"
)

type AppStats struct {
	VMSGB      float64 `json:"vmsGB"`
	CPUPercent float64 `json:"cpuPercent"`
}

func GetAppStats() (AppStats, error) {
	p, err := process.NewProcess(int32(os.Getpid()))
	if err != nil {
		return AppStats{}, err
	}

	mem, err := p.MemoryInfo()
	if err != nil {
		return AppStats{}, err
	}

	cpuPercent, err := p.CPUPercent()
	if err != nil {
		return AppStats{}, err
	}

	const gib = 1024 * 1024 * 1024

	return AppStats{
		VMSGB:      float64(mem.VMS) / gib,
		CPUPercent: cpuPercent,
	}, nil
}
