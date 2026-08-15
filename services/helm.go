package services

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/getter"
	"helm.sh/helm/v3/pkg/repo"
)

// HelmRepoInfo represents one configured Helm repository on local machine.
type HelmRepoInfo struct {
	Name       string `json:"name"`
	URL        string `json:"url"`
	ChartCount int    `json:"chartCount"`
	Error      string `json:"error,omitempty"`
}

// HelmAppInfo represents one installed Helm release in cluster.
type HelmAppInfo struct {
	Name       string `json:"name"`
	Namespace  string `json:"namespace"`
	Revision   int    `json:"revision"`
	Chart      string `json:"chart"`
	AppVersion string `json:"appVersion"`
	Status     string `json:"status"`
	UpdatedAt  string `json:"updatedAt"`
}

type HelmChartInfo struct {
	Name       string `json:"name"`
	Version    string `json:"version"`
	AppVersion string `json:"appVersion"`
}

type HelmChartVersionInfo struct {
	Version    string `json:"version"`
	AppVersion string `json:"appVersion"`
}

func (s *Backend) HelmListRepos() ([]HelmRepoInfo, error) {
	return listHelmRepos()
}

func (s *Backend) HelmListApps(namespace string) ([]HelmAppInfo, error) {
	return listHelmApps(namespace)
}

func (s *Backend) HelmGetRepoCharts(repoName string) ([]HelmChartInfo, error) {
	return listRepoCharts(repoName)
}

func (s *Backend) HelmGetChartVersions(repoName, chartName string) ([]HelmChartVersionInfo, error) {
	return listChartVersions(repoName, chartName)
}

func (s *Backend) HelmInstallApp(releaseName, repoName, chartName, chartVersion, namespace string) error {
	return installHelmApp(releaseName, repoName, chartName, chartVersion, namespace)
}

func (s *Backend) HelmUninstallApp(namespace, releaseName string) error {
	return uninstallHelmApp(namespace, releaseName)
}

func (s *Backend) HelmAddRepo(repoName, repoURL string) error {
	return addHelmRepo(repoName, repoURL)
}

func (s *Backend) HelmRemoveRepo(repoName string) error {
	return removeHelmRepo(repoName)
}

func listHelmRepos() ([]HelmRepoInfo, error) {
	settings := cli.New()
	repoFile, err := repo.LoadFile(settings.RepositoryConfig)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "no such file") {
			return []HelmRepoInfo{}, nil
		}
		return nil, err
	}

	result := make([]HelmRepoInfo, 0, len(repoFile.Repositories))
	for _, r := range repoFile.Repositories {
		row := HelmRepoInfo{Name: r.Name, URL: r.URL}
		index, loadErr := loadOrFetchRepoIndex(settings, r.Name)
		if loadErr != nil {
			row.Error = loadErr.Error()
		} else {
			row.ChartCount = len(index.Entries)
		}
		result = append(result, row)
	}
	return result, nil
}

func listHelmApps(namespace string) ([]HelmAppInfo, error) {
	settings := cli.New()
	actionConfig := new(action.Configuration)

	helmNS := strings.TrimSpace(namespace)
	if helmNS == "" || helmNS == "all" || helmNS == "_" {
		helmNS = ""
	} else {
		settings.SetNamespace(helmNS)
	}

	if err := actionConfig.Init(settings.RESTClientGetter(), helmNS, "secret", func(string, ...interface{}) {}); err != nil {
		return nil, err
	}

	listAction := action.NewList(actionConfig)
	listAction.All = true
	listAction.AllNamespaces = helmNS == ""
	listAction.StateMask = action.ListAll

	releases, err := listAction.Run()
	if err != nil {
		return nil, err
	}

	result := make([]HelmAppInfo, 0, len(releases))
	for _, rel := range releases {
		row := HelmAppInfo{
			Name:      rel.Name,
			Namespace: rel.Namespace,
			Revision:  rel.Version,
			Status:    rel.Info.Status.String(),
		}
		if rel.Chart != nil && rel.Chart.Metadata != nil {
			row.Chart = rel.Chart.Metadata.Name
			row.AppVersion = rel.Chart.Metadata.AppVersion
			if row.Chart != "" && rel.Chart.Metadata.Version != "" {
				row.Chart = fmt.Sprintf("%s-%s", row.Chart, rel.Chart.Metadata.Version)
			}
		}
		if rel.Info != nil {
			if !rel.Info.LastDeployed.IsZero() {
				row.UpdatedAt = rel.Info.LastDeployed.Time.Format(time.RFC3339)
			}
		}
		result = append(result, row)
	}

	return result, nil
}

func listRepoCharts(repoName string) ([]HelmChartInfo, error) {
	if strings.TrimSpace(repoName) == "" {
		return []HelmChartInfo{}, nil
	}
	index, err := loadOrFetchRepoIndex(cli.New(), repoName)
	if err != nil {
		return nil, err
	}
	result := make([]HelmChartInfo, 0, len(index.Entries))
	for name, versions := range index.Entries {
		row := HelmChartInfo{Name: name}
		if len(versions) > 0 {
			row.Version = versions[0].Version
			row.AppVersion = versions[0].AppVersion
		}
		result = append(result, row)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Name < result[j].Name
	})
	return result, nil
}

func listChartVersions(repoName, chartName string) ([]HelmChartVersionInfo, error) {
	if strings.TrimSpace(repoName) == "" || strings.TrimSpace(chartName) == "" {
		return []HelmChartVersionInfo{}, nil
	}
	index, err := loadOrFetchRepoIndex(cli.New(), repoName)
	if err != nil {
		return nil, err
	}
	versions := index.Entries[chartName]
	result := make([]HelmChartVersionInfo, 0, len(versions))
	for _, v := range versions {
		result = append(result, HelmChartVersionInfo{Version: v.Version, AppVersion: v.AppVersion})
	}
	return result, nil
}

func installHelmApp(releaseName, repoName, chartName, chartVersion, namespace string) error {
	releaseName = strings.TrimSpace(releaseName)
	repoName = strings.TrimSpace(repoName)
	chartName = strings.TrimSpace(chartName)
	chartVersion = strings.TrimSpace(chartVersion)
	namespace = strings.TrimSpace(namespace)
	if releaseName == "" || repoName == "" || chartName == "" || chartVersion == "" || namespace == "" {
		return fmt.Errorf("releaseName, repoName, chartName, chartVersion and namespace are required")
	}

	settings := cli.New()
	settings.SetNamespace(namespace)
	actionConfig := new(action.Configuration)
	if err := actionConfig.Init(settings.RESTClientGetter(), namespace, "secret", func(string, ...interface{}) {}); err != nil {
		return err
	}

	installAction := action.NewInstall(actionConfig)
	installAction.ReleaseName = releaseName
	installAction.Namespace = namespace
	installAction.CreateNamespace = false
	installAction.ChartPathOptions.Version = chartVersion

	chartRef := fmt.Sprintf("%s/%s", repoName, chartName)
	chartPath, err := installAction.ChartPathOptions.LocateChart(chartRef, settings)
	if err != nil {
		return err
	}

	chartRequested, err := loader.Load(chartPath)
	if err != nil {
		return err
	}

	if chartRequested.Metadata.Annotations == nil {
		chartRequested.Metadata.Annotations = make(map[string]string)
	}
	chartRequested.Metadata.Annotations["kubegui.io/repo-name"] = repoName

	_, err = installAction.Run(chartRequested, nil)
	return err
}

func uninstallHelmApp(namespace, releaseName string) error {
	releaseName = strings.TrimSpace(releaseName)
	namespace = strings.TrimSpace(namespace)
	if releaseName == "" {
		return fmt.Errorf("releaseName is required")
	}
	if namespace == "" {
		return fmt.Errorf("namespace is required")
	}

	settings := cli.New()
	settings.SetNamespace(namespace)
	actionConfig := new(action.Configuration)
	if err := actionConfig.Init(settings.RESTClientGetter(), namespace, "secret", func(string, ...interface{}) {}); err != nil {
		return err
	}

	uninstallAction := action.NewUninstall(actionConfig)
	_, err := uninstallAction.Run(releaseName)
	return err
}

func addHelmRepo(repoName, repoURL string) error {
	repoName = strings.TrimSpace(repoName)
	repoURL = strings.TrimSpace(repoURL)
	if repoName == "" || repoURL == "" {
		return fmt.Errorf("repoName and repoURL are required")
	}

	settings := cli.New()
	repoFilePath := settings.RepositoryConfig
	repos, err := repo.LoadFile(repoFilePath)
	if err != nil {
		repos = repo.NewFile()
	}

	for _, r := range repos.Repositories {
		if r.Name == repoName {
			return fmt.Errorf("repository %q already exists", repoName)
		}
	}

	entry := &repo.Entry{Name: repoName, URL: repoURL}
	chartRepo, err := repo.NewChartRepository(entry, getter.Providers{{Schemes: []string{"http", "https"}, New: getter.NewHTTPGetter}})
	if err != nil {
		return fmt.Errorf("invalid repository: %w", err)
	}
	chartRepo.CachePath = settings.RepositoryCache
	indexPath, err := chartRepo.DownloadIndexFile()
	if err != nil {
		return fmt.Errorf("cannot access repository: %w", err)
	}
	index, err := repo.LoadIndexFile(indexPath)
	if err != nil {
		return fmt.Errorf("invalid repository index: %w", err)
	}
	if len(index.Entries) == 0 {
		return fmt.Errorf("repository contains no charts")
	}

	repos.Update(entry)
	if err := repos.WriteFile(repoFilePath, 0o644); err != nil {
		return fmt.Errorf("failed to save repository: %w", err)
	}
	return nil
}

func removeHelmRepo(repoName string) error {
	repoName = strings.TrimSpace(repoName)
	if repoName == "" {
		return fmt.Errorf("repoName is required")
	}

	settings := cli.New()
	repos, err := repo.LoadFile(settings.RepositoryConfig)
	if err != nil {
		return err
	}

	idx := -1
	for i, r := range repos.Repositories {
		if r.Name == repoName {
			idx = i
			break
		}
	}
	if idx < 0 {
		return fmt.Errorf("repository %q not found", repoName)
	}
	repos.Repositories = append(repos.Repositories[:idx], repos.Repositories[idx+1:]...)
	if err := repos.WriteFile(settings.RepositoryConfig, 0o644); err != nil {
		return err
	}
	return nil
}

func loadOrFetchRepoIndex(settings *cli.EnvSettings, repoName string) (*repo.IndexFile, error) {
	cachePath := filepath.Join(settings.RepositoryCache, repoName+"-index.yaml")
	if index, err := repo.LoadIndexFile(cachePath); err == nil {
		return index, nil
	}

	repoFile, err := repo.LoadFile(settings.RepositoryConfig)
	if err != nil {
		return nil, fmt.Errorf("cache miss for %q and cannot load repo config: %w", repoName, err)
	}

	var entry *repo.Entry
	for _, r := range repoFile.Repositories {
		if r.Name == repoName {
			entry = r
			break
		}
	}
	if entry == nil {
		return nil, fmt.Errorf("repo %q not found in %s", repoName, settings.RepositoryConfig)
	}

	url := strings.ToLower(entry.URL)
	if strings.HasPrefix(url, "oci://") || strings.HasPrefix(url, "acr://") || (!strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://")) {
		return nil, fmt.Errorf("unsupported repository URL %q", entry.URL)
	}

	chartRepo, err := repo.NewChartRepository(entry, getter.Providers{{Schemes: []string{"http", "https"}, New: getter.NewHTTPGetter}})
	if err != nil {
		return nil, fmt.Errorf("cannot create chart repository for %q: %w", repoName, err)
	}
	chartRepo.CachePath = settings.RepositoryCache

	downloaded, err := chartRepo.DownloadIndexFile()
	if err != nil {
		return nil, fmt.Errorf("cannot download index for %q: %w", repoName, err)
	}
	return repo.LoadIndexFile(downloaded)
}

