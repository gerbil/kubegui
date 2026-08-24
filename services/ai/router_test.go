package ai

import "testing"

func TestNormalizeSettings_Defaults(t *testing.T) {
	cfg := NormalizeSettings(Settings{})
	if cfg.Provider != ProviderOpenRouter {
		t.Fatalf("expected default provider %q, got %q", ProviderOpenRouter, cfg.Provider)
	}
	if cfg.Model == "" {
		t.Fatal("expected default model")
	}
	if cfg.Endpoint == "" {
		t.Fatal("expected default endpoint")
	}
}

func TestBuildPromptGenerateYAML(t *testing.T) {
	prompt := buildPrompt(Request{
		Task:      TaskGenerateYAML,
		Resource:  "pod",
		Namespace: "default",
		Name:      "api-0",
		Message:   "CrashLoopBackOff",
	})
	if prompt == "" {
		t.Fatal("expected non-empty prompt")
	}
}

func TestIsTokenOptional(t *testing.T) {
	if !isTokenOptional(ProviderOllama, "llama3.1:8b") {
		t.Fatal("expected ollama to allow missing token")
	}
	if !isTokenOptional(ProviderOpenRouter, "meta-llama/llama-3.1-8b-instruct:free") {
		t.Fatal("expected openrouter free models to allow missing token")
	}
	if isTokenOptional(ProviderOpenAI, "gpt-4o-mini") {
		t.Fatal("did not expect openai models to allow missing token")
	}
}

func TestBuildPromptAutoDetect(t *testing.T) {
	prompt := buildPrompt(Request{Task: TaskAutoDetect, Message: "CrashLoopBackOff"})
	if prompt == "" {
		t.Fatal("expected non-empty auto-detect prompt")
	}
}

