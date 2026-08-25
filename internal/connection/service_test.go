package connection

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/mongo"

	"github.com/peternagy/mongopal/internal/core"
)

func seededService(t *testing.T, ids ...string) (*Service, *core.AppState) {
	t.Helper()
	state := core.NewAppState()
	for _, id := range ids {
		attempt, err := state.StartConnecting(id)
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := state.PublishClient(id, attempt, &mongo.Client{}); !ok {
			t.Fatalf("could not seed %s", id)
		}
	}
	return &Service{state: state, teardownTimeout: 40 * time.Millisecond}, state
}

func TestDisconnectProgressIsIndependentAcrossConnections(t *testing.T) {
	service, state := seededService(t, "a", "b")
	startedA := make(chan struct{})
	a, _ := state.GetClient("a")
	service.clientOps.disconnect = func(ctx context.Context, client *mongo.Client) error {
		if client == a {
			close(startedA)
			<-ctx.Done()
			return ctx.Err()
		}
		return nil
	}

	go func() { _ = service.Disconnect("a") }()
	select {
	case <-startedA:
	case <-time.After(time.Second):
		t.Fatal("first disconnect did not reach cleanup")
	}
	done := make(chan error, 1)
	go func() { done <- service.Disconnect("b") }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("independent disconnect failed: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("disconnect for b waited on a cleanup")
	}
}

func TestDisconnectAllRunsCleanupConcurrentlyAndReportsFailures(t *testing.T) {
	service, state := seededService(t, "a", "b", "c")
	started := make(chan struct{}, 3)
	release := make(chan struct{})
	// Keep the target identity before DisconnectAll atomically clears the map.
	b, _ := state.GetClient("b")
	service.clientOps.disconnect = func(_ context.Context, client *mongo.Client) error {
		started <- struct{}{}
		<-release
		if client == b {
			return errors.New("b cleanup failed")
		}
		return nil
	}
	done := make(chan error, 1)
	go func() { done <- service.DisconnectAll() }()
	for range 3 {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("bulk cleanup was serial or did not start every target")
		}
	}
	close(release)
	err := <-done
	if err == nil || !strings.Contains(err.Error(), "b") {
		t.Fatalf("expected ID-scoped b cleanup failure, got %v", err)
	}
	for _, id := range []string{"a", "b", "c"} {
		if state.HasClient(id) {
			t.Fatalf("%s remained logically active after bulk detach", id)
		}
	}
}

func TestDisconnectTimeoutDetachesClient(t *testing.T) {
	service, state := seededService(t, "a")
	service.teardownTimeout = 10 * time.Millisecond
	service.clientOps.disconnect = func(ctx context.Context, _ *mongo.Client) error {
		<-ctx.Done()
		return ctx.Err()
	}
	err := service.Disconnect("a")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected teardown deadline, got %v", err)
	}
	if state.HasClient("a") {
		t.Fatal("timed-out cleanup left client active")
	}
}
