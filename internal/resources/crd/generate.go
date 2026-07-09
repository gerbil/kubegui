package crd

import (
	"bytes"
	"context"
	"fmt"
	"io"

	crd2yaml "github.com/Skarlso/crd-to-sample-yaml/pkg"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"kubegui/internal/kubeclients"
)

type writeNoOpCloser struct {
	w io.Writer
}

func (w *writeNoOpCloser) Write(p []byte) (n int, err error) { return w.w.Write(p) }
func (w *writeNoOpCloser) Close() error                      { return nil }

// GenerateTemplateYAML fetches the CRD by group+plural and generates a sample
// YAML manifest using crd-to-sample-yaml.
func GenerateTemplateYAML(group, plural string) (string, error) {
	dynClient, err := kubeclients.GetDynamicClient()
	if err != nil {
		return "", fmt.Errorf("dynamic client: %w", err)
	}

	gvr := schema.GroupVersionResource{
		Group:    "apiextensions.k8s.io",
		Version:  "v1",
		Resource: "customresourcedefinitions",
	}

	crdName := plural + "." + group
	out, err := dynClient.Resource(gvr).Get(context.Background(), crdName, metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("get CRD %q: %w", crdName, err)
	}

	schemaType, err := crd2yaml.ExtractSchemaType(out)
	if err != nil {
		return "", fmt.Errorf("extract schema: %w", err)
	}

	var buf bytes.Buffer
	nop := &writeNoOpCloser{w: &buf}
	crd2yaml.Generate(schemaType, nop, true, false, true)

	return buf.String(), nil
}

