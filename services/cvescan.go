package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	trivyvdb "github.com/aquasecurity/trivy-db/pkg/db"
	"github.com/aquasecurity/trivy/pkg/cache"
	trivyoperation "github.com/aquasecurity/trivy/pkg/commands/operation"
	trivypkgdb "github.com/aquasecurity/trivy/pkg/db"
	trivyapplier "github.com/aquasecurity/trivy/pkg/fanal/applier"
	trivyartifact "github.com/aquasecurity/trivy/pkg/fanal/artifact"
	trivyartifactimage "github.com/aquasecurity/trivy/pkg/fanal/artifact/image"
	trivyimage "github.com/aquasecurity/trivy/pkg/fanal/image"
	trivyfanaltypes "github.com/aquasecurity/trivy/pkg/fanal/types"
	trivyjavadb "github.com/aquasecurity/trivy/pkg/javadb"
	trivyscanner "github.com/aquasecurity/trivy/pkg/scan"
	trivylangpkg "github.com/aquasecurity/trivy/pkg/scan/langpkg"
	trivylocal "github.com/aquasecurity/trivy/pkg/scan/local"
	trivyospkg "github.com/aquasecurity/trivy/pkg/scan/ospkg"
	trivytypes "github.com/aquasecurity/trivy/pkg/types"
	trivyvuln "github.com/aquasecurity/trivy/pkg/vulnerability"
	"github.com/google/go-containerregistry/pkg/name"

	"kubegui/internal/local"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const maxCVEFindings = 200

const (
	trivyRequestTimeout   = 20 * time.Minute
	trivyScanTimeout      = 15 * time.Minute
	trivyDBPrepareTimeout = 5 * time.Minute
)

var trivyScanMu sync.Mutex

type CVEFinding struct {
	ID        string `json:"id"`
	PkgName   string `json:"pkgName"`
	Installed string `json:"installed"`
	Fixed     string `json:"fixed"`
	Severity  string `json:"severity"`
	Title     string `json:"title"`
}

type CVEScanReport struct {
	Scanner     string         `json:"scanner"`
	Image       string         `json:"image"`
	Container   string         `json:"container"`
	Summary     map[string]int `json:"summary"`
	Findings    []CVEFinding   `json:"findings"`
	GeneratedAt string         `json:"generatedAt"`
}

type cveScanRequest struct {
	Namespace     string `json:"namespace"`
	PodName       string `json:"podName"`
	ContainerName string `json:"containerName"`
	Scanner       string `json:"scanner"`
	Image         string `json:"image"`
}

type cveDBRefreshResponse struct {
	Status    string `json:"status"`
	CacheDir  string `json:"cacheDir"`
	UpdatedAt string `json:"updatedAt"`
}

func CVEScanHandler(rw http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		rw.Header().Set("Allow", http.MethodPost)
		http.Error(rw, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var body cveScanRequest
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		writeJSONError(rw, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return
	}

	report, err := scanContainerCVE(req.Context(), body)
	if err != nil {
		writeJSONError(rw, http.StatusBadRequest, err.Error())
		return
	}

	rw.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(rw).Encode(report); err != nil {
		http.Error(rw, err.Error(), http.StatusInternalServerError)
	}
}

func CVEDBRefreshHandler(rw http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		rw.Header().Set("Allow", http.MethodPost)
		http.Error(rw, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	result, err := refreshTrivyDatabases(req.Context())
	if err != nil {
		writeJSONError(rw, http.StatusBadGateway, err.Error())
		return
	}

	rw.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(rw).Encode(result); err != nil {
		http.Error(rw, err.Error(), http.StatusInternalServerError)
	}
}

func writeJSONError(rw http.ResponseWriter, code int, message string) {
	rw.Header().Set("Content-Type", "application/json")
	rw.WriteHeader(code)
	_ = json.NewEncoder(rw).Encode(map[string]string{"error": message})
}

func scanContainerCVE(ctx context.Context, req cveScanRequest) (CVEScanReport, error) {
	scanner := strings.ToLower(strings.TrimSpace(req.Scanner))
	if scanner == "" {
		scanner = "trivy"
	}
	if scanner != "trivy" {
		return CVEScanReport{}, fmt.Errorf("unsupported scanner %q", scanner)
	}

	container := strings.TrimSpace(req.ContainerName)
	image := strings.TrimSpace(req.Image)
	if image == "" {
		if strings.TrimSpace(req.Namespace) == "" || strings.TrimSpace(req.PodName) == "" {
			return CVEScanReport{}, errors.New("namespace and podName are required when image is not provided")
		}
		resolvedImage, resolvedContainer, err := resolvePodContainerImage(req.Namespace, req.PodName, container)
		if err != nil {
			return CVEScanReport{}, err
		}
		image = resolvedImage
		container = resolvedContainer
	}
	if image == "" {
		return CVEScanReport{}, errors.New("image is empty")
	}

	var findings []CVEFinding
	findings, err := runTrivyScan(ctx, image)
	if err != nil {
		return CVEScanReport{}, err
	}

	sortFindings(findings)
	if len(findings) > maxCVEFindings {
		findings = findings[:maxCVEFindings]
	}

	return CVEScanReport{
		Scanner:     scanner,
		Image:       image,
		Container:   container,
		Summary:     summarizeBySeverity(findings),
		Findings:    findings,
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func resolvePodContainerImage(namespace, podName, preferredContainer string) (string, string, error) {
	cs, _, err := activeClientAndConfig()
	if err != nil {
		return "", "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pod, err := cs.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return "", "", err
	}
	if len(pod.Spec.Containers) == 0 {
		return "", "", fmt.Errorf("pod %s/%s has no containers", namespace, podName)
	}

	if preferredContainer != "" {
		for _, c := range pod.Spec.Containers {
			if c.Name == preferredContainer {
				return c.Image, c.Name, nil
			}
		}
		return "", "", fmt.Errorf("container %q not found in pod %s/%s", preferredContainer, namespace, podName)
	}
	first := pod.Spec.Containers[0]
	return first.Image, first.Name, nil
}

func runTrivyScan(parent context.Context, image string) ([]CVEFinding, error) {
	report, err := runEmbeddedTrivyScan(parent, image)
	if err != nil {
		return nil, classifyTrivyImageError(image, err)
	}
	return findingsFromTrivyReport(report), nil
}

// classifyTrivyImageError converts the verbose multi-source Trivy "unable to
// find image" error into a short, actionable message.
func classifyTrivyImageError(image string, err error) error {
	msg := err.Error()

	// Trivy tried every source and all failed.
	if strings.Contains(msg, "unable to find the specified image") ||
		strings.Contains(msg, "unable to find image") {

		var hints []string

		// Remote registry access denied / firewall
		if strings.Contains(msg, "DENIED") ||
			strings.Contains(msg, "not allowed access") ||
			strings.Contains(msg, "firewall") ||
			strings.Contains(msg, "unauthorized") ||
			strings.Contains(msg, "401") ||
			strings.Contains(msg, "403") {
			hints = append(hints, "registry access denied (private registry / IP firewall)")
		}

		// No local container runtime
		noRuntime := strings.Contains(msg, "docker daemon is not running") ||
			strings.Contains(msg, "docker_engine") ||
			strings.Contains(msg, "containerd socket not found") ||
			strings.Contains(msg, "podman socket") ||
			strings.Contains(msg, "no podman socket")
		if noRuntime {
			hints = append(hints, "no local container runtime found (Docker/containerd/podman not running)")
		}

		if len(hints) > 0 {
			h := strings.Join(hints, "; ")
			return fmt.Errorf("cannot load image %q for scanning: %s", image, h)
		}
		return fmt.Errorf("cannot load image %q for scanning — "+
			"ensure the registry is accessible or a local container runtime is running", image)
	}

	return err
}

func runEmbeddedTrivyScan(parent context.Context, image string) (trivytypes.Report, error) {
	trivyScanMu.Lock()
	defer trivyScanMu.Unlock()

	_ = parent // The HTTP request context may have a shorter transport timeout; use dedicated scan budgets.
	rootCtx, rootCancel := context.WithTimeout(context.Background(), trivyRequestTimeout)
	defer rootCancel()

	dbCtx, dbCancel := context.WithTimeout(rootCtx, trivyDBPrepareTimeout)
	defer dbCancel()
	cacheDir, err := prepareTrivyDatabases(dbCtx)
	if err != nil {
		return trivytypes.Report{}, err
	}
	defer trivypkgdb.Close()

	scanCtx, scanCancel := context.WithTimeout(rootCtx, trivyScanTimeout)
	defer scanCancel()

	scanner, cleanup, err := newEmbeddedTrivyScanner(scanCtx, image, cacheDir)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return trivytypes.Report{}, fmt.Errorf("embedded trivy scan timed out after %s", trivyScanTimeout)
		}
		return trivytypes.Report{}, err
	}
	defer cleanup()

	report, err := scanner.ScanArtifact(scanCtx, trivytypes.ScanOptions{
		PkgTypes: []string{
			trivytypes.PkgTypeOS,
			trivytypes.PkgTypeLibrary,
		},
		Scanners: trivytypes.Scanners{trivytypes.VulnerabilityScanner},
	})
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return trivytypes.Report{}, fmt.Errorf("embedded trivy scan timed out after %s", trivyScanTimeout)
		}
		return trivytypes.Report{}, fmt.Errorf("embedded trivy scan failed: %w", err)
	}
	return report, nil
}

func refreshTrivyDatabases(parent context.Context) (cveDBRefreshResponse, error) {
	trivyScanMu.Lock()
	defer trivyScanMu.Unlock()

	_ = parent
	ctx, cancel := context.WithTimeout(context.Background(), trivyDBPrepareTimeout)
	defer cancel()

	cacheDir, err := prepareTrivyDatabases(ctx)
	if err != nil {
		return cveDBRefreshResponse{}, err
	}
	defer trivypkgdb.Close()

	return cveDBRefreshResponse{
		Status:    "ready",
		CacheDir:  cacheDir,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func prepareTrivyDatabases(ctx context.Context) (string, error) {
	cacheDir, err := ensureTrivyCacheDir()
	if err != nil {
		return "", err
	}
	if err := ensureTrivyDB(ctx, cacheDir); err != nil {
		return "", err
	}
	return cacheDir, nil
}

func ensureTrivyCacheDir() (string, error) {
	cacheDir := filepath.Join(local.AppDataDir, "trivy")
	if err := os.MkdirAll(cacheDir, 0o775); err != nil {
		return "", fmt.Errorf("create trivy cache dir: %w", err)
	}
	return cacheDir, nil
}

func ensureTrivyDB(ctx context.Context, cacheDir string) error {
	dbRepo, err := name.NewTag(trivypkgdb.DefaultGHCRRepository)
	if err != nil {
		return fmt.Errorf("parse trivy DB repository: %w", err)
	}
	if err := trivyoperation.DownloadDB(ctx, "kubegui", cacheDir, []name.Reference{dbRepo}, true, false, trivyfanaltypes.RegistryOptions{}); err != nil {
		return fmt.Errorf("prepare trivy vulnerability DB: %w", err)
	}
	if err := trivypkgdb.Init(trivypkgdb.Dir(cacheDir)); err != nil {
		return fmt.Errorf("init trivy vulnerability DB: %w", err)
	}

	javaDBRepo, err := name.NewTag(trivyjavadb.DefaultGHCRRepository)
	if err != nil {
		return fmt.Errorf("parse trivy java DB repository: %w", err)
	}
	trivyjavadb.Init(cacheDir, []name.Reference{javaDBRepo}, false, true, trivyfanaltypes.RegistryOptions{})
	if err := trivyjavadb.Update(); err != nil {
		return fmt.Errorf("prepare trivy java DB: %w", err)
	}
	return nil
}

func newEmbeddedTrivyScanner(ctx context.Context, imageRef, cacheDir string) (trivyscanner.Service, func(), error) {
	// Use an in-memory artifact cache so every scan gets a fresh layer
	// analysis. A persistent fs cache can return stale results (pkg_num=0)
	// when a prior scan wrote an incomplete entry for an image layer.
	// The vulnerability DB itself stays on disk via prepareTrivyDatabases.
	cacheClient, cacheCleanup, err := cache.New(cache.Options{Backend: "memory"})
	if err != nil {
		return trivyscanner.Service{}, nil, fmt.Errorf("init trivy cache: %w", err)
	}

	imageOptions := trivyfanaltypes.ImageOptions{
		RegistryOptions: trivyfanaltypes.RegistryOptions{},
		ImageSources: trivyfanaltypes.ImageSources{
			trivyfanaltypes.RemoteImageSource,
			trivyfanaltypes.DockerImageSource,
			trivyfanaltypes.ContainerdImageSource,
			trivyfanaltypes.PodmanImageSource,
		},
	}

	containerImage, imageCleanup, err := trivyimage.NewContainerImage(ctx, imageRef, imageOptions)
	if err != nil {
		cacheCleanup()
		return trivyscanner.Service{}, nil, fmt.Errorf("load image %q: %w", imageRef, err)
	}

	artifactOptions := trivyartifact.Option{
		Parallel:          1,
		Offline:           true,
		ImageOption:       imageOptions,
		SBOMSources:       []string{},
		// Unpackaged handler can trigger Rekor lookups that fail in embedded/offline mode.
		// Keep it disabled to avoid "http: no Host in request URL" analysis failures.
		DisabledHandlers:  []trivyfanaltypes.HandlerType{trivyfanaltypes.UnpackagedPostHandler},
		DetectionPriority: trivyfanaltypes.PriorityComprehensive,
	}

	imageArtifact, err := trivyartifactimage.NewArtifact(containerImage, cacheClient, artifactOptions)
	if err != nil {
		imageCleanup()
		cacheCleanup()
		return trivyscanner.Service{}, nil, fmt.Errorf("create trivy image artifact: %w", err)
	}

	vulnClient := trivyvuln.NewClient(trivyvdb.Config{})
	localScanner := trivylocal.NewService(
		trivyapplier.NewApplier(cacheClient),
		trivyospkg.NewScanner(),
		trivylangpkg.NewScanner(),
		vulnClient,
	)

	return trivyscanner.NewService(localScanner, imageArtifact), func() {
		imageCleanup()
		cacheCleanup()
	}, nil
}

func findingsFromTrivyReport(report trivytypes.Report) []CVEFinding {
	findings := make([]CVEFinding, 0)
	for _, result := range report.Results {
		for _, v := range result.Vulnerabilities {
			title := strings.TrimSpace(v.Title)
			if title == "" {
				title = strings.TrimSpace(v.Description)
			}
			findings = append(findings, CVEFinding{
				ID:        v.VulnerabilityID,
				PkgName:   v.PkgName,
				Installed: v.InstalledVersion,
				Fixed:     v.FixedVersion,
				Severity:  strings.ToUpper(v.Severity),
				Title:     title,
			})
		}
	}
	return findings
}

func summarizeBySeverity(findings []CVEFinding) map[string]int {
	summary := map[string]int{"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0, "UNKNOWN": 0}
	for _, f := range findings {
		s := strings.ToUpper(strings.TrimSpace(f.Severity))
		if _, ok := summary[s]; !ok {
			s = "UNKNOWN"
		}
		summary[s]++
	}
	return summary
}

func sortFindings(findings []CVEFinding) {
	rank := map[string]int{"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "UNKNOWN": 4}
	sort.SliceStable(findings, func(i, j int) bool {
		si := strings.ToUpper(findings[i].Severity)
		sj := strings.ToUpper(findings[j].Severity)
		ri, ok := rank[si]
		if !ok {
			ri = rank["UNKNOWN"]
		}
		rj, ok := rank[sj]
		if !ok {
			rj = rank["UNKNOWN"]
		}
		if ri != rj {
			return ri < rj
		}
		return findings[i].ID < findings[j].ID
	})
}



