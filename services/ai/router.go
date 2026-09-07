package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	ProviderOpenRouter = "openrouter"
	ProviderGroq       = "groq"
	ProviderOpenAI     = "openai"
	ProviderOllama     = "ollama"
)

const (
	TaskExplainEvent = "explain_event"
	TaskSuggestFix   = "suggest_fix"
	TaskGenerateYAML = "generate_yaml"
	TaskExplainLogs  = "explain_logs"
	TaskAutoDetect   = "auto_detect"
)

const defaultSystemPrompt = "You are KubeGUI AI assistant. Explain Kubernetes issues clearly, list likely root causes, and propose safe actions. When task asks for YAML, return valid YAML first, then short notes. Never suggest control-plane changes for managed Kubernetes."

type Settings struct {
	Enabled  bool
	Provider string
	Model    string
	Endpoint string
	Token    string
}

type Request struct {
	Task      string `json:"task"`
	Resource  string `json:"resource"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Message   string `json:"message"`
	Details   string `json:"details"`
}

type BifrostRouter struct {
	httpClient *http.Client
}

func NewBifrostRouter() *BifrostRouter {
	return &BifrostRouter{
		httpClient: &http.Client{Timeout: 45 * time.Second},
	}
}

func DefaultModelForProvider(provider string) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case ProviderGroq:
		return "llama-3.1-8b-instant"
	case ProviderOpenAI:
		return "gpt-4o-mini"
	case ProviderOllama:
		return "llama3.1:8b"
	default:
		return "meta-llama/llama-3.1-8b-instruct:free"
	}
}

func DefaultEndpointForProvider(provider string) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case ProviderGroq:
		return "https://api.groq.com/openai/v1/chat/completions"
	case ProviderOpenAI:
		return "https://api.openai.com/v1/chat/completions"
	case ProviderOllama:
		return "http://127.0.0.1:11434/v1/chat/completions"
	default:
		return "https://openrouter.ai/api/v1/chat/completions"
	}
}

func NormalizeSettings(in Settings) Settings {
	out := in
	out.Provider = strings.ToLower(strings.TrimSpace(out.Provider))
	if out.Provider == "" {
		out.Provider = ProviderOpenRouter
	}
	if strings.TrimSpace(out.Model) == "" {
		out.Model = DefaultModelForProvider(out.Provider)
	}
	if strings.TrimSpace(out.Endpoint) == "" {
		out.Endpoint = DefaultEndpointForProvider(out.Provider)
	}
	return out
}

func (r *BifrostRouter) Ask(ctx context.Context, settings Settings, req Request) (string, error) {
	cfg := NormalizeSettings(settings)
	if !cfg.Enabled {
		return "", fmt.Errorf("ai is disabled in settings")
	}
	if !isTokenOptional(cfg.Provider, cfg.Model) && strings.TrimSpace(cfg.Token) == "" {
		return "", fmt.Errorf("missing API token for provider %q", cfg.Provider)
	}

	prompt := buildPrompt(req)
	payload := chatRequest{
		Model: cfg.Model,
		Messages: []chatMessage{
			{Role: "system", Content: defaultSystemPrompt},
			{Role: "user", Content: prompt},
		},
		Temperature: 0.2,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.Endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if cfg.Token != "" {
		httpReq.Header.Set("Authorization", "Bearer "+cfg.Token)
	}
	if cfg.Provider == ProviderOpenRouter {
		httpReq.Header.Set("HTTP-Referer", "https://kubegui.local")
		httpReq.Header.Set("X-Title", "KubeGUI")
	}

	resp, err := r.httpClient.Do(httpReq)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("ai provider error (%d): %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	var out chatResponse
	if err := json.Unmarshal(respBody, &out); err != nil {
		return "", err
	}
	if len(out.Choices) == 0 {
		return "", fmt.Errorf("ai provider returned no choices")
	}
	answer := strings.TrimSpace(out.Choices[0].Message.Content)
	if answer == "" {
		return "", fmt.Errorf("ai provider returned empty response")
	}
	return answer, nil
}

func buildPrompt(req Request) string {
	resource := strings.TrimSpace(req.Resource)
	ns := strings.TrimSpace(req.Namespace)
	name := strings.TrimSpace(req.Name)
	message := strings.TrimSpace(req.Message)
	details := strings.TrimSpace(req.Details)

	base := fmt.Sprintf("Task: %s\nResource: %s\nNamespace: %s\nName: %s\nMessage:\n%s\n", req.Task, resource, ns, name, message)
	if details != "" {
		base += "\nExtra details:\n" + details + "\n"
	}

	switch strings.TrimSpace(req.Task) {
	case TaskAutoDetect:
		return base + "\nAuto-detect the likely Kubernetes issue type from the input and return the most useful output format for remediation. If YAML is the safest fix, return minimal valid YAML first, then concise explanation bullets. Otherwise, return concise fix steps and verification commands."
	case TaskExplainEvent:
		return base + "\nExplain this Kubernetes event in plain English. Include likely cause and severity."
	case TaskGenerateYAML:
		return base + "\nGenerate minimal Kubernetes YAML to fix this issue. Return YAML first, then short explanation bullets."
	case TaskExplainLogs:
		return base + "\nExplain this log snippet. Call out root cause and immediate checks to run."
	default:
		return base + "\nSuggest safe remediation steps. Include command examples and rollback warning if risky."
	}
}

func isTokenOptional(provider, model string) bool {
	p := strings.ToLower(strings.TrimSpace(provider))
	if p == ProviderOllama {
		return true
	}
	if p == ProviderOpenRouter {
		m := strings.ToLower(strings.TrimSpace(model))
		return strings.HasSuffix(m, ":free") || strings.Contains(m, "/free")
	}
	return false
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model       string        `json:"model"`
	Messages    []chatMessage `json:"messages"`
	Temperature float64       `json:"temperature,omitempty"`
}

type chatResponse struct {
	Choices []struct {
		Message chatMessage `json:"message"`
	} `json:"choices"`
}

