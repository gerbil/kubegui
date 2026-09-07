package kubegui

import "embed"

// Any files in the frontend/dist folder will be embedded into the binary,
// See https://pkg.go.dev/embed for more information.

//go:embed ui/dist
var Assets embed.FS

// Main app icon
//
//go:embed ui/dist/appicon.png
var Icon []byte
