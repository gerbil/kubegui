package services

import (
	"encoding/json"
	"net/http"
	"strings"
)

type helmInstallRequest struct {
	ReleaseName  string `json:"releaseName"`
	RepoName     string `json:"repoName"`
	ChartName    string `json:"chartName"`
	ChartVersion string `json:"chartVersion"`
	Namespace    string `json:"namespace"`
}

type helmRepoRequest struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

func HelmReposHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var payload helmRepoRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "invalid json body", http.StatusBadRequest)
			return
		}
		if err := addHelmRepo(payload.Name, payload.URL); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method == http.MethodDelete {
		repoName := strings.TrimSpace(r.URL.Query().Get("name"))
		if err := removeHelmRepo(repoName); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.URL.Path == "/api/v1/helm/repos/charts" {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		repoName := r.URL.Query().Get("repoName")
		rows, err := listRepoCharts(repoName)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(rows)
		return
	}

	if r.URL.Path == "/api/v1/helm/repos/versions" {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		repoName := r.URL.Query().Get("repoName")
		chartName := r.URL.Query().Get("chartName")
		rows, err := listChartVersions(repoName, chartName)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(rows)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	rows, err := listHelmRepos()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(rows)
}

func HelmAppsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var payload helmInstallRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "invalid json body", http.StatusBadRequest)
			return
		}
		if err := installHelmApp(payload.ReleaseName, payload.RepoName, payload.ChartName, payload.ChartVersion, payload.Namespace); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method == http.MethodDelete {
		ns := strings.TrimSpace(r.URL.Query().Get("namespace"))
		name := strings.TrimSpace(r.URL.Query().Get("name"))
		if err := uninstallHelmApp(ns, name); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ns := r.URL.Query().Get("namespace")
	rows, err := listHelmApps(ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(rows)
}

