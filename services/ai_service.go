package services

import (
	"context"
	"fmt"
	idb "kubegui/internal/db"
	"kubegui/services/ai"
	"strconv"
	"strings"
	"time"
)

type AISettings struct {
	Enabled  bool   `json:"enabled"`
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Endpoint string `json:"endpoint"`
	Token    string `json:"token"`
}

type AIAssistRequest struct {
	Task      string `json:"task"`
	Resource  string `json:"resource"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Message   string `json:"message"`
	Details   string `json:"details"`
}

type AIAssistResponse struct {
	Suggestion string `json:"suggestion"`
	Provider   string `json:"provider"`
	Model      string `json:"model"`
}

var aiRouter = ai.NewBifrostRouter()

func readAISettings() (AISettings, error) {
	rawAllow, err := idb.GetSetting("aiallow")
	if err != nil {
		return AISettings{}, err
	}
	provider, err := idb.GetSetting("aitype")
	if err != nil {
		provider = ai.ProviderOpenRouter
	}
	model, err := idb.GetSetting("aimodel")
	if err != nil {
		model = ""
	}
	endpoint, err := idb.GetSetting("aiendpoint")
	if err != nil {
		endpoint = ""
	}
	token, err := idb.GetSetting("aitoken")
	if err != nil {
		token = ""
	}

	allow, _ := strconv.ParseBool(strings.TrimSpace(rawAllow))
	cfg := ai.NormalizeSettings(ai.Settings{
		Enabled:  allow,
		Provider: provider,
		Model:    model,
		Endpoint: endpoint,
		Token:    token,
	})
	return AISettings{
		Enabled:  cfg.Enabled,
		Provider: cfg.Provider,
		Model:    cfg.Model,
		Endpoint: cfg.Endpoint,
		Token:    cfg.Token,
	}, nil
}

func writeAISettings(in AISettings) (AISettings, error) {
	cfg := ai.NormalizeSettings(ai.Settings{
		Enabled:  in.Enabled,
		Provider: in.Provider,
		Model:    in.Model,
		Endpoint: in.Endpoint,
		Token:    in.Token,
	})
	if err := idb.UpsertSetting("aiallow", strconv.FormatBool(cfg.Enabled)); err != nil {
		return AISettings{}, err
	}
	if err := idb.UpsertSetting("aitype", cfg.Provider); err != nil {
		return AISettings{}, err
	}
	if err := idb.UpsertSetting("aimodel", cfg.Model); err != nil {
		return AISettings{}, err
	}
	if err := idb.UpsertSetting("aiendpoint", cfg.Endpoint); err != nil {
		return AISettings{}, err
	}
	if err := idb.UpsertSetting("aitoken", strings.TrimSpace(in.Token)); err != nil {
		return AISettings{}, err
	}
	return readAISettings()
}

func runAIAssist(ctx context.Context, req AIAssistRequest) (AIAssistResponse, error) {
	settings, err := readAISettings()
	if err != nil {
		return AIAssistResponse{}, err
	}
	if strings.TrimSpace(req.Message) == "" {
		return AIAssistResponse{}, fmt.Errorf("message is required")
	}

	ctx, cancel := context.WithTimeout(ctx, 50*time.Second)
	defer cancel()

	answer, err := aiRouter.Ask(ctx, ai.Settings{
		Enabled:  settings.Enabled,
		Provider: settings.Provider,
		Model:    settings.Model,
		Endpoint: settings.Endpoint,
		Token:    settings.Token,
	}, ai.Request{
		Task:      req.Task,
		Resource:  req.Resource,
		Namespace: req.Namespace,
		Name:      req.Name,
		Message:   req.Message,
		Details:   req.Details,
	})
	if err != nil {
		return AIAssistResponse{}, err
	}

	return AIAssistResponse{
		Suggestion: answer,
		Provider:   settings.Provider,
		Model:      settings.Model,
	}, nil
}

func (s *Backend) AISettingsGet() (AISettings, error) {
	return readAISettings()
}

func (s *Backend) AISettingsUpdate(input AISettings) (AISettings, error) {
	return writeAISettings(input)
}

func (s *Backend) AIAssist(input AIAssistRequest) (AIAssistResponse, error) {
	return runAIAssist(context.Background(), input)
}

