package services

import (
	"encoding/json"
	"net/http"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

type argoYAMLRequest struct {
	YAML string `json:"yaml"`
}

type argoRefreshRequest struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Hard      bool   `json:"hard"`
}

type argoTargetRequest struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

func writeArgoError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	switch {
	case apierrors.IsNotFound(err):
		status = http.StatusNotFound
	case apierrors.IsAlreadyExists(err), apierrors.IsConflict(err):
		status = http.StatusConflict
	case apierrors.IsInvalid(err), apierrors.IsBadRequest(err):
		status = http.StatusBadRequest
	case apierrors.IsForbidden(err):
		status = http.StatusForbidden
	}
	http.Error(w, err.Error(), status)
}

func writeArgoJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func decodeArgoBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return false
	}
	return true
}

// ArgoAppsHandler serves /api/v1/argocd/apps and its sub-paths.
func ArgoAppsHandler(w http.ResponseWriter, r *http.Request) {
	sub := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/argocd/apps"), "/")
	q := r.URL.Query()

	switch sub {
	case "":
		switch r.Method {
		case http.MethodGet:
			rows, err := listArgoApps(q.Get("namespace"))
			if err != nil {
				writeArgoError(w, err)
				return
			}
			writeArgoJSON(w, rows)
		case http.MethodPost:
			var body argoYAMLRequest
			if !decodeArgoBody(w, r, &body) {
				return
			}
			created, err := createArgoApp(body.YAML)
			if err != nil {
				writeArgoError(w, err)
				return
			}
			writeArgoJSON(w, map[string]string{"name": created.GetName(), "namespace": created.GetNamespace()})
		case http.MethodPut:
			var body argoYAMLRequest
			if !decodeArgoBody(w, r, &body) {
				return
			}
			if err := updateArgoApp(body.YAML); err != nil {
				writeArgoError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case http.MethodDelete:
			if err := deleteArgoApp(q.Get("namespace"), q.Get("name"), q.Get("mode")); err != nil {
				writeArgoError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}

	case "detail":
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		obj, err := getArgoApp(q.Get("namespace"), q.Get("name"))
		if err != nil {
			writeArgoError(w, err)
			return
		}
		writeArgoJSON(w, obj)

	case "yaml":
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		out, err := argoAppYAML(q.Get("namespace"), q.Get("name"))
		if err != nil {
			writeArgoError(w, err)
			return
		}
		writeArgoJSON(w, argoYAMLRequest{YAML: out})

	case "diff":
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		res, err := diffArgoApp(q.Get("namespace"), q.Get("name"))
		if err != nil {
			writeArgoError(w, err)
			return
		}
		writeArgoJSON(w, res)

	case "sync", "rollback", "refresh", "terminate":
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var err error
		switch sub {
		case "sync":
			var body ArgoSyncRequest
			if !decodeArgoBody(w, r, &body) {
				return
			}
			err = syncArgoApp(body)
		case "rollback":
			var body ArgoRollbackRequest
			if !decodeArgoBody(w, r, &body) {
				return
			}
			err = rollbackArgoApp(body)
		case "refresh":
			var body argoRefreshRequest
			if !decodeArgoBody(w, r, &body) {
				return
			}
			err = refreshArgoApp(body.Namespace, body.Name, body.Hard)
		case "terminate":
			var body argoTargetRequest
			if !decodeArgoBody(w, r, &body) {
				return
			}
			err = terminateArgoOperation(body.Namespace, body.Name)
		}
		if err != nil {
			writeArgoError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.NotFound(w, r)
	}
}
