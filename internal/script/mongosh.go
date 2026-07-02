// Package script handles MongoDB shell script execution.
package script

import (
	"bytes"
	"context"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/peternagy/mongopal/internal/storage"
	"github.com/peternagy/mongopal/internal/types"
)

// scriptURIEnvVar is the environment variable used to hand the connection URI
// (including password) to the mongosh child process. Passing it via the
// environment keeps the credentials out of the process argument list (visible
// via `ps`), while still allowing non-interactive `--eval` execution.
const scriptURIEnvVar = "MONGOPAL_SCRIPT_URI"

// Service handles script execution.
type Service struct {
	connStore *storage.ConnectionService
}

// NewService creates a new script service.
func NewService(connStore *storage.ConnectionService) *Service {
	return &Service{
		connStore: connStore,
	}
}

// CheckMongoshAvailable checks if mongosh is installed and available.
func CheckMongoshAvailable() (bool, string) {
	// Try mongosh first (modern MongoDB shell)
	if path, err := exec.LookPath("mongosh"); err == nil {
		return true, path
	}
	// Fall back to legacy mongo shell
	if path, err := exec.LookPath("mongo"); err == nil {
		return true, path
	}
	return false, ""
}

// ExecuteScript executes a MongoDB shell script using mongosh.
func (s *Service) ExecuteScript(connID, script string) (*types.ScriptResult, error) {
	if script == "" {
		return nil, fmt.Errorf("script cannot be empty")
	}

	// Get connection URI with password
	uri, err := s.connStore.GetConnectionURI(connID)
	if err != nil {
		return nil, err
	}

	return runShellScript(uri, script)
}

// ExecuteScriptWithDatabase executes a script against a specific database.
func (s *Service) ExecuteScriptWithDatabase(connID, dbName, script string) (*types.ScriptResult, error) {
	if script == "" {
		return nil, fmt.Errorf("script cannot be empty")
	}
	if dbName == "" {
		return nil, fmt.Errorf("database name cannot be empty")
	}

	// Get connection URI with password
	uri, err := s.connStore.GetConnectionURI(connID)
	if err != nil {
		return nil, err
	}

	// Point the URI at the requested database, preserving the auth database.
	uriWithDB, err := setURIDatabase(uri, dbName)
	if err != nil {
		return nil, err
	}

	return runShellScript(uriWithDB, script)
}

// runShellScript executes userScript against the given URI using mongosh in
// non-interactive mode. The URI is passed via the environment (not argv) so the
// password is never exposed in process listings. Running with `--eval` (rather
// than piping to stdin) avoids the interactive REPL, which would otherwise leak
// shell prompts and auto-print the connect() result into stdout.
func runShellScript(uri, script string) (*types.ScriptResult, error) {
	// Check if mongosh is available
	available, shellPath := CheckMongoshAvailable()
	if !available {
		return nil, fmt.Errorf("mongosh or mongo shell not found. Please install MongoDB Shell: https://www.mongodb.com/try/download/shell")
	}

	// Create a context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	wrappedScript := buildWrappedScript(script)

	// --nodb: don't auto-connect (we connect() inside the script)
	// --quiet: suppress the startup banner and connection chatter
	// --norc: don't load .mongoshrc.js
	// --eval: run non-interactively (no REPL prompts) while still printing the
	//         completion value of the final expression
	args := []string{
		"--nodb",
		"--quiet",
		"--norc",
		"--eval", wrappedScript,
	}

	cmd := exec.CommandContext(ctx, shellPath, args...)

	// Hand the URI (with password) to the child via the environment so it stays
	// out of argv. The script reads it from process.env.
	cmd.Env = append(os.Environ(), scriptURIEnvVar+"="+uri)

	// Capture stdout and stderr
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	// Run the command
	err := cmd.Run()

	result := &types.ScriptResult{
		Output:   stdout.String(),
		Error:    stderr.String(),
		ExitCode: 0,
	}

	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			result.ExitCode = exitErr.ExitCode()
		} else if ctx.Err() == context.DeadlineExceeded {
			result.Error = "script execution timed out (60s limit)"
			result.ExitCode = -1
		} else {
			result.Error = err.Error()
			result.ExitCode = -1
		}
	}

	// Combine stderr with output if there's an error
	if result.Error != "" && result.Output == "" {
		result.Output = result.Error
	}

	return result, nil
}

// buildWrappedScript prepends a connect() call that reads the URI from the
// environment, keeping credentials out of the script text and argv. The
// connect() assignment is not the final statement, so its result is not
// auto-printed by --eval; only the user's final expression is.
func buildWrappedScript(userScript string) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("db = connect(process.env.%s);\n", scriptURIEnvVar))
	sb.WriteString(userScript)
	return sb.String()
}

// setURIDatabase rewrites a MongoDB URI so mongosh connects to dbName, while
// preserving the original authentication database. If the URI has no explicit
// authSource but carries an auth database in its path (e.g. ".../admin"),
// overwriting the path would silently change the effective authSource and cause
// "Authentication failed". To avoid that, the original path database is promoted
// to an authSource query param before the path is replaced with dbName.
func setURIDatabase(uri, dbName string) (string, error) {
	parsedURI, err := url.Parse(uri)
	if err != nil {
		return "", fmt.Errorf("invalid connection URI: %w", err)
	}

	q := parsedURI.Query()
	if q.Get("authSource") == "" {
		if existingDB := strings.TrimPrefix(parsedURI.Path, "/"); existingDB != "" {
			q.Set("authSource", existingDB)
			parsedURI.RawQuery = q.Encode()
		}
	}

	parsedURI.Path = "/" + dbName
	return parsedURI.String(), nil
}
