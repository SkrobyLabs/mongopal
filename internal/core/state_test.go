package core

import (
	"context"
	"sync"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/mongo"
)

func TestConnectionAttemptDetachAndStaleFinishAreSafe(t *testing.T) {
	state := NewAppState()
	first, err := state.StartConnecting("one")
	if err != nil {
		t.Fatal(err)
	}
	detached := state.DetachConnection("one")
	if detached.Cancel == nil {
		t.Fatal("detach did not return the in-flight cancellation")
	}
	detached.Cancel()
	select {
	case <-first.Context().Done():
	case <-time.After(time.Second):
		t.Fatal("disconnect did not cancel the attempt")
	}

	second, err := state.StartConnecting("one")
	if err != nil {
		t.Fatal(err)
	}
	state.FinishConnecting("one", first)
	if _, err := state.StartConnecting("one"); err == nil {
		t.Fatal("stale finish removed the newer attempt")
	}
	state.FinishConnecting("one", second)
}

func TestPublishClientRejectsDetachedAttempt(t *testing.T) {
	state := NewAppState()
	attempt, err := state.StartConnecting("one")
	if err != nil {
		t.Fatal(err)
	}
	detached := state.DetachConnection("one")
	detached.Cancel()
	if _, ok := state.PublishClient("one", attempt, &mongo.Client{}); ok {
		t.Fatal("detached attempt published a client")
	}
	if state.HasClient("one") {
		t.Fatal("stale client became active")
	}
}

func TestExportPauseResume(t *testing.T) {
	state := NewAppState()

	// Initially not paused
	if state.IsExportPaused() {
		t.Error("Export should not be paused initially")
	}

	// Pause
	state.PauseExport()
	if !state.IsExportPaused() {
		t.Error("Export should be paused after PauseExport")
	}

	// Resume
	state.ResumeExport()
	if state.IsExportPaused() {
		t.Error("Export should not be paused after ResumeExport")
	}
}

func TestImportPauseResume(t *testing.T) {
	state := NewAppState()

	// Initially not paused
	if state.IsImportPaused() {
		t.Error("Import should not be paused initially")
	}

	// Pause
	state.PauseImport()
	if !state.IsImportPaused() {
		t.Error("Import should be paused after PauseImport")
	}

	// Resume
	state.ResumeImport()
	if state.IsImportPaused() {
		t.Error("Import should not be paused after ResumeImport")
	}
}

func TestWaitIfExportPaused_NotPaused(t *testing.T) {
	state := NewAppState()
	ctx := context.Background()

	// Should return immediately when not paused
	result := state.WaitIfExportPaused(ctx)
	if !result {
		t.Error("WaitIfExportPaused should return true when not paused")
	}
}

func TestWaitIfExportPaused_Cancelled(t *testing.T) {
	state := NewAppState()
	ctx, cancel := context.WithCancel(context.Background())

	// Cancel immediately
	cancel()

	result := state.WaitIfExportPaused(ctx)
	if result {
		t.Error("WaitIfExportPaused should return false when context is cancelled")
	}
}

func TestWaitIfExportPaused_ResumeUnblocks(t *testing.T) {
	state := NewAppState()
	ctx := context.Background()

	// Pause export
	state.PauseExport()

	var wg sync.WaitGroup
	var result bool
	wg.Add(1)

	go func() {
		defer wg.Done()
		result = state.WaitIfExportPaused(ctx)
	}()

	// Give goroutine time to start waiting
	time.Sleep(10 * time.Millisecond)

	// Resume should unblock
	state.ResumeExport()

	// Wait for goroutine to complete with timeout
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		if !result {
			t.Error("WaitIfExportPaused should return true after resume")
		}
	case <-time.After(1 * time.Second):
		t.Error("WaitIfExportPaused did not unblock after resume")
	}
}

func TestWaitIfImportPaused_NotPaused(t *testing.T) {
	state := NewAppState()
	ctx := context.Background()

	// Should return immediately when not paused
	result := state.WaitIfImportPaused(ctx)
	if !result {
		t.Error("WaitIfImportPaused should return true when not paused")
	}
}

func TestWaitIfImportPaused_Cancelled(t *testing.T) {
	state := NewAppState()
	ctx, cancel := context.WithCancel(context.Background())

	// Cancel immediately
	cancel()

	result := state.WaitIfImportPaused(ctx)
	if result {
		t.Error("WaitIfImportPaused should return false when context is cancelled")
	}
}

func TestWaitIfImportPaused_ResumeUnblocks(t *testing.T) {
	state := NewAppState()
	ctx := context.Background()

	// Pause import
	state.PauseImport()

	var wg sync.WaitGroup
	var result bool
	wg.Add(1)

	go func() {
		defer wg.Done()
		result = state.WaitIfImportPaused(ctx)
	}()

	// Give goroutine time to start waiting
	time.Sleep(10 * time.Millisecond)

	// Resume should unblock
	state.ResumeImport()

	// Wait for goroutine to complete with timeout
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		if !result {
			t.Error("WaitIfImportPaused should return true after resume")
		}
	case <-time.After(1 * time.Second):
		t.Error("WaitIfImportPaused did not unblock after resume")
	}
}

func TestResetExportPause(t *testing.T) {
	state := NewAppState()

	// Pause then reset
	state.PauseExport()
	if !state.IsExportPaused() {
		t.Error("Export should be paused")
	}

	state.ResetExportPause()
	if state.IsExportPaused() {
		t.Error("Export should not be paused after reset")
	}
}

func TestResetImportPause(t *testing.T) {
	state := NewAppState()

	// Pause then reset
	state.PauseImport()
	if !state.IsImportPaused() {
		t.Error("Import should be paused")
	}

	state.ResetImportPause()
	if state.IsImportPaused() {
		t.Error("Import should not be paused after reset")
	}
}
