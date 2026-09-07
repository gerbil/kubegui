package deployments

import (
	"time"

	"kubegui/internal/resources/std"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// Restart triggers a rollout restart by patching the restartedAt annotation.
func Restart(namespace, name string) (map[string]any, error) {
	obj, err := std.GetResource("deployments", namespace, name)
	if err != nil {
		return nil, err
	}
	annotations, _, _ := unstructured.NestedStringMap(obj.Object, "spec", "template", "metadata", "annotations")
	if annotations == nil {
		annotations = map[string]string{}
	}
	annotations["kubectl.kubernetes.io/restartedAt"] = time.Now().UTC().Format(time.RFC3339)
	if err := unstructured.SetNestedStringMap(obj.Object, annotations, "spec", "template", "metadata", "annotations"); err != nil {
		return nil, err
	}
	updated, err := std.UpdateResource("deployments", namespace, name, obj.Object)
	if err != nil {
		return nil, err
	}
	return updated.Object, nil
}

// Scale sets the replica count of a deployment.
func Scale(namespace, name string, replicas int) (map[string]any, error) {
	obj, err := std.GetResource("deployments", namespace, name)
	if err != nil {
		return nil, err
	}
	if err := unstructured.SetNestedField(obj.Object, int64(replicas), "spec", "replicas"); err != nil {
		return nil, err
	}
	updated, err := std.UpdateResource("deployments", namespace, name, obj.Object)
	if err != nil {
		return nil, err
	}
	return updated.Object, nil
}
