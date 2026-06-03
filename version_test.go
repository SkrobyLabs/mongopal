package main

import "testing"

func TestGetVersionInfoRelease(t *testing.T) {
	withVersionVars("v1.2.3", "abcdef1234567890", "false", func() {
		info := (&App{}).GetVersionInfo()

		if info.Version != "1.2.3" {
			t.Fatalf("Version = %q, want 1.2.3", info.Version)
		}
		if info.ShortCommit != "abcdef123456" {
			t.Fatalf("ShortCommit = %q, want abcdef123456", info.ShortCommit)
		}
		if info.IsDirty {
			t.Fatal("IsDirty = true, want false")
		}
		if !info.IsRelease || info.IsDev {
			t.Fatalf("IsRelease/IsDev = %v/%v, want true/false", info.IsRelease, info.IsDev)
		}
	})
}

func TestGetVersionInfoDevFallback(t *testing.T) {
	withVersionVars("", "abcdef1234567890", "true", func() {
		info := (&App{}).GetVersionInfo()

		if info.Version != "abcdef123456" {
			t.Fatalf("Version = %q, want short commit fallback", info.Version)
		}
		if !info.IsDirty || !info.IsDev || info.IsRelease {
			t.Fatalf("IsDirty/IsDev/IsRelease = %v/%v/%v, want true/true/false", info.IsDirty, info.IsDev, info.IsRelease)
		}
	})
}

func withVersionVars(version, commit, dirty string, fn func()) {
	oldVersion := AppVersion
	oldCommit := GitCommit
	oldDirty := GitDirty
	AppVersion = version
	GitCommit = commit
	GitDirty = dirty
	defer func() {
		AppVersion = oldVersion
		GitCommit = oldCommit
		GitDirty = oldDirty
	}()

	fn()
}
