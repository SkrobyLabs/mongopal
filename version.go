package main

import "strings"

var (
	AppVersion = ""
	GitCommit  = ""
	GitDirty   = "true"
)

type VersionInfo struct {
	Version     string `json:"version"`
	Commit      string `json:"commit"`
	ShortCommit string `json:"shortCommit"`
	IsDirty     bool   `json:"isDirty"`
	IsDev       bool   `json:"isDev"`
	IsRelease   bool   `json:"isRelease"`
}

func (a *App) GetVersionInfo() VersionInfo {
	version := strings.TrimPrefix(strings.TrimSpace(AppVersion), "v")
	commit := strings.TrimSpace(GitCommit)
	shortCommit := commit
	if len(shortCommit) > 12 {
		shortCommit = shortCommit[:12]
	}

	isDirty := strings.EqualFold(strings.TrimSpace(GitDirty), "true")
	isRelease := version != "" && !isDirty
	if version == "" {
		if shortCommit != "" {
			version = shortCommit
		} else {
			version = "dev"
		}
	}

	return VersionInfo{
		Version:     version,
		Commit:      commit,
		ShortCommit: shortCommit,
		IsDirty:     isDirty,
		IsDev:       !isRelease,
		IsRelease:   isRelease,
	}
}
