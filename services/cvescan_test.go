package services

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSummarizeAndSortFindings(t *testing.T) {
	findings := []CVEFinding{
		{ID: "CVE-3", Severity: "LOW"},
		{ID: "CVE-1", Severity: "CRITICAL"},
		{ID: "CVE-2", Severity: "HIGH"},
		{ID: "CVE-4", Severity: "weird"},
	}

	sortFindings(findings)
	if findings[0].Severity != "CRITICAL" || findings[1].Severity != "HIGH" {
		t.Fatalf("findings not sorted by severity: %+v", findings)
	}

	summary := summarizeBySeverity(findings)
	if summary["CRITICAL"] != 1 || summary["HIGH"] != 1 || summary["LOW"] != 1 || summary["UNKNOWN"] != 1 {
		t.Fatalf("unexpected summary: %+v", summary)
	}
}

func TestSummarizeBySeverityInitializesBuckets(t *testing.T) {
	summary := summarizeBySeverity(nil)
	for _, sev := range []string{"CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"} {
		if _, ok := summary[sev]; !ok {
			t.Fatalf("expected severity bucket %q to exist", sev)
		}
	}
}

func TestCVEDBRefreshHandlerRejectsNonPost(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/cve-db/refresh", nil)
	rr := httptest.NewRecorder()

	CVEDBRefreshHandler(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected status %d, got %d", http.StatusMethodNotAllowed, rr.Code)
	}
	if allow := rr.Header().Get("Allow"); allow != http.MethodPost {
		t.Fatalf("expected Allow header %q, got %q", http.MethodPost, allow)
	}
}

