package services

import (
	"encoding/json"
	"fmt"
	"net/http"
)

func AISettingsHandler(rw http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodGet:
		settings, err := readAISettings()
		if err != nil {
			writeAIJSONError(rw, http.StatusInternalServerError, err.Error())
			return
		}
		rw.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(rw).Encode(settings)
		return
	case http.MethodPatch:
		var body AISettings
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			writeAIJSONError(rw, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
			return
		}
		settings, err := writeAISettings(body)
		if err != nil {
			writeAIJSONError(rw, http.StatusBadRequest, err.Error())
			return
		}
		rw.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(rw).Encode(settings)
		return
	default:
		rw.Header().Set("Allow", "GET, PATCH")
		http.Error(rw, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func AIAssistHandler(rw http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		rw.Header().Set("Allow", http.MethodPost)
		http.Error(rw, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var body AIAssistRequest
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		writeAIJSONError(rw, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return
	}

	result, err := runAIAssist(req.Context(), body)
	if err != nil {
		writeAIJSONError(rw, http.StatusBadRequest, err.Error())
		return
	}

	rw.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(rw).Encode(result)
}

func writeAIJSONError(rw http.ResponseWriter, code int, message string) {
	rw.Header().Set("Content-Type", "application/json")
	rw.WriteHeader(code)
	_ = json.NewEncoder(rw).Encode(map[string]string{"error": message})
}

