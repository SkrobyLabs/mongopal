// Package connection handles MongoDB connection operations.
package connection

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/peternagy/mongopal/internal/bsonutil"
	"github.com/peternagy/mongopal/internal/core"
	"github.com/peternagy/mongopal/internal/credential"
	"github.com/peternagy/mongopal/internal/debug"
	"github.com/peternagy/mongopal/internal/storage"
	"github.com/peternagy/mongopal/internal/types"
)

// Service handles MongoDB connection operations.
type Service struct {
	state           *core.AppState
	connStore       *storage.ConnectionService
	clientOps       clientOperations
	teardownTimeout time.Duration
}

const defaultTeardownTimeout = 5 * time.Second

// clientOperations is a narrow test seam around driver lifecycle calls. The
// rest of the package continues to use concrete mongo.Client values.
type clientOperations struct {
	connect    func(context.Context, string) (*mongo.Client, error)
	ping       func(context.Context, *mongo.Client) error
	disconnect func(context.Context, *mongo.Client) error
}

func defaultClientOperations() clientOperations {
	return clientOperations{
		connect: func(ctx context.Context, uri string) (*mongo.Client, error) {
			return mongo.Connect(ctx, options.Client().ApplyURI(uri))
		},
		ping:       func(ctx context.Context, client *mongo.Client) error { return client.Ping(ctx, nil) },
		disconnect: func(ctx context.Context, client *mongo.Client) error { return client.Disconnect(ctx) },
	}
}

// NewService creates a new connection service.
func NewService(state *core.AppState, connStore *storage.ConnectionService) *Service {
	return &Service{
		state:           state,
		connStore:       connStore,
		clientOps:       defaultClientOperations(),
		teardownTimeout: defaultTeardownTimeout,
	}
}

// Connect establishes a connection to a saved MongoDB instance.
func (s *Service) Connect(connID string) error {
	start := time.Now()
	debug.LogConnection("Connecting to MongoDB", map[string]interface{}{
		"connectionId": connID,
	})

	// Prevent concurrent connection attempts for the same ID
	attempt, err := s.state.StartConnecting(connID)
	if err != nil {
		debug.LogConnection("Connection blocked (concurrent attempt)", map[string]interface{}{
			"connectionId": connID,
			"error":        err.Error(),
		})
		return err
	}
	defer s.state.FinishConnecting(connID, attempt)

	uri, err := s.connStore.GetConnectionURI(connID)
	if err != nil {
		debug.LogConnection("Failed to get connection URI", map[string]interface{}{
			"connectionId": connID,
			"error":        err.Error(),
		})
		return err
	}

	ctx, cancel := context.WithTimeout(attempt.Context(), core.DefaultConnectTimeout)
	defer cancel()

	client, err := s.clientOps.connect(ctx, uri)
	if err != nil {
		debug.LogConnection("Failed to connect", map[string]interface{}{
			"connectionId": connID,
			"error":        err.Error(),
			"durationMs":   time.Since(start).Milliseconds(),
		})
		return fmt.Errorf("failed to connect: %w", err)
	}

	// Ping to verify connection
	if err := s.clientOps.ping(ctx, client); err != nil {
		cleanupErr := s.teardownClient(context.Background(), connID, client)
		debug.LogConnection("Failed to ping", map[string]interface{}{
			"connectionId": connID,
			"error":        err.Error(),
			"durationMs":   time.Since(start).Milliseconds(),
		})
		return joinLifecycleError(fmt.Errorf("failed to ping: %w", err), cleanupErr)
	}

	replaced, published := s.state.PublishClient(connID, attempt, client)
	if !published {
		cleanupErr := s.teardownClient(context.Background(), connID, client)
		return joinLifecycleError(fmt.Errorf("connection attempt cancelled for %s", connID), cleanupErr)
	}
	if replaced != nil {
		if err := s.teardownClient(context.Background(), connID, replaced); err != nil {
			debug.LogConnection("Failed to clean up replaced connection", map[string]interface{}{
				"connectionId": connID,
				"error":        err.Error(),
			})
		}
	}

	// Update last accessed time (ignore error - non-critical)
	_ = s.connStore.UpdateLastAccessed(connID)

	debug.LogConnection("Connected successfully", map[string]interface{}{
		"connectionId": connID,
		"durationMs":   time.Since(start).Milliseconds(),
	})

	return nil
}

// Disconnect closes a MongoDB connection.
func (s *Service) Disconnect(connID string) error {
	debug.LogConnection("Disconnecting", map[string]interface{}{
		"connectionId": connID,
	})
	detached := s.state.DetachConnection(connID)
	if detached.Cancel != nil {
		detached.Cancel()
	}
	if detached.Client != nil {
		if err := s.teardownClient(context.Background(), connID, detached.Client); err != nil {
			return err
		}
	}
	debug.LogConnection("Disconnected", map[string]interface{}{
		"connectionId": connID,
	})
	return nil
}

// DisconnectAll closes all MongoDB connections.
func (s *Service) DisconnectAll() error {
	detached := s.state.DetachAll()
	for _, connection := range detached {
		if connection.Cancel != nil {
			connection.Cancel()
		}
	}
	return s.teardownAll(context.Background(), detached)
}

func joinLifecycleError(primary, cleanup error) error {
	if cleanup == nil {
		return primary
	}
	return errors.Join(primary, cleanup)
}

// teardownClient gives every driver close operation its own finite deadline.
// Logical state has already been detached when this runs.
func (s *Service) teardownClient(parent context.Context, connID string, client *mongo.Client) error {
	ctx, cancel := context.WithTimeout(parent, s.teardownTimeout)
	defer cancel()
	start := time.Now()
	err := s.clientOps.disconnect(ctx, client)
	duration := time.Since(start)
	if err != nil {
		debug.LogConnection("Connection cleanup failed", map[string]interface{}{
			"connectionId": connID,
			"durationMs":   duration.Milliseconds(),
			"error":        err.Error(),
		})
		return fmt.Errorf("disconnect %s after %s: %w", connID, duration.Round(time.Millisecond), err)
	}
	return nil
}

// teardownAll starts every cleanup before waiting, so one stalled cluster
// cannot impose head-of-line blocking on the rest.
func (s *Service) teardownAll(parent context.Context, detached []core.DetachedConnection) error {
	var wg sync.WaitGroup
	errs := make(chan error, len(detached))
	for _, connection := range detached {
		if connection.Client == nil {
			continue
		}
		wg.Add(1)
		go func(connection core.DetachedConnection) {
			defer wg.Done()
			if err := s.teardownClient(parent, connection.ID, connection.Client); err != nil {
				errs <- err
			}
		}(connection)
	}
	wg.Wait()
	close(errs)
	collected := make([]error, 0, len(detached))
	for err := range errs {
		collected = append(collected, err)
	}
	sort.Slice(collected, func(i, j int) bool { return collected[i].Error() < collected[j].Error() })
	return errors.Join(collected...)
}

// TestConnection tests a MongoDB URI and returns detailed server information.
func (s *Service) TestConnection(uri string) (*types.TestConnectionResult, error) {
	start := time.Now()
	result := &types.TestConnectionResult{}

	// Mask password in URI for logging
	maskedURI := uri
	if idx := strings.Index(uri, "@"); idx > 0 {
		maskedURI = uri[:strings.Index(uri, "://")+3] + "***@" + uri[idx+1:]
	}
	debug.LogConnection("Testing connection", map[string]interface{}{
		"uri": maskedURI,
	})

	if uri == "" {
		result.Error = "URI cannot be empty"
		result.Hint = "Enter a valid MongoDB connection URI"
		return result, nil
	}

	// Validate URI scheme
	if !strings.HasPrefix(uri, "mongodb://") && !strings.HasPrefix(uri, "mongodb+srv://") {
		debug.LogConnection("Invalid URI scheme", map[string]interface{}{
			"uri": maskedURI,
		})
		result.Error = "Invalid URI scheme: must start with mongodb:// or mongodb+srv://"
		result.Hint = "Use mongodb:// for standard connections or mongodb+srv:// for SRV connections"
		return result, nil
	}

	// Strip vendor-specific params (mongopal.*, 3t.*) before passing to driver
	uri = credential.StripVendorParams(uri)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	clientOpts := options.Client().ApplyURI(uri)
	client, err := mongo.Connect(ctx, clientOpts)
	if err != nil {
		debug.LogConnection("Test connection failed", map[string]interface{}{
			"uri":        maskedURI,
			"error":      err.Error(),
			"durationMs": time.Since(start).Milliseconds(),
		})
		result.Error = fmt.Sprintf("Failed to connect: %s", err.Error())
		result.Hint = connectionErrorHint(err)
		result.Latency = time.Since(start).Milliseconds()
		return result, nil
	}
	defer client.Disconnect(ctx)

	if err := client.Ping(ctx, nil); err != nil {
		debug.LogConnection("Test connection ping failed", map[string]interface{}{
			"uri":        maskedURI,
			"error":      err.Error(),
			"durationMs": time.Since(start).Milliseconds(),
		})
		result.Error = fmt.Sprintf("Failed to ping: %s", err.Error())
		result.Hint = connectionErrorHint(err)
		result.Latency = time.Since(start).Milliseconds()
		return result, nil
	}

	result.Latency = time.Since(start).Milliseconds()
	result.Success = true

	// Detect TLS from URI
	result.TLSEnabled = strings.Contains(uri, "tls=true") || strings.Contains(uri, "ssl=true") || strings.HasPrefix(uri, "mongodb+srv://")

	// Get server info via buildInfo command
	var buildInfo bson.M
	if err := client.Database("admin").RunCommand(ctx, bson.D{{Key: "buildInfo", Value: 1}}).Decode(&buildInfo); err == nil {
		if version, ok := buildInfo["version"].(string); ok {
			result.ServerVersion = version
		}
	}

	// Get topology info via hello/isMaster command
	var hello bson.M
	if err := client.Database("admin").RunCommand(ctx, bson.D{{Key: "hello", Value: 1}}).Decode(&hello); err == nil {
		if setName, ok := hello["setName"].(string); ok && setName != "" {
			result.Topology = "replicaset"
			result.ReplicaSet = setName
		} else if msg, ok := hello["msg"].(string); ok && msg == "isdbgrid" {
			result.Topology = "sharded"
		} else {
			result.Topology = "standalone"
		}
	}

	debug.LogConnection("Test connection successful", map[string]interface{}{
		"uri":           maskedURI,
		"durationMs":    result.Latency,
		"serverVersion": result.ServerVersion,
		"topology":      result.Topology,
	})

	return result, nil
}

// connectionErrorHint returns an actionable hint for common connection errors.
func connectionErrorHint(err error) string {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "connection refused"):
		return "Check that MongoDB is running and the host/port are correct"
	case strings.Contains(msg, "authentication failed"):
		return "Verify your username, password, and authentication database"
	case strings.Contains(msg, "tls") || strings.Contains(msg, "certificate"):
		return "Check your TLS/SSL certificate configuration"
	case strings.Contains(msg, "timeout") || strings.Contains(msg, "context deadline"):
		return "The server may be unreachable. Check network connectivity and firewall rules"
	case strings.Contains(msg, "no reachable servers"):
		return "No MongoDB servers found. Verify the hostname and that the server is running"
	case strings.Contains(msg, "DNS"):
		return "DNS resolution failed. Check the hostname or try using an IP address"
	default:
		return ""
	}
}

// GetConnectionStatus returns the status of a connection.
func (s *Service) GetConnectionStatus(connID string) types.ConnectionStatus {
	if !s.state.HasClient(connID) {
		return types.ConnectionStatus{Connected: false}
	}

	// Verify with ping
	client, _ := s.state.GetClient(connID)
	if client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := client.Ping(ctx, nil); err != nil {
			return types.ConnectionStatus{Connected: false, Error: err.Error()}
		}
	}

	return types.ConnectionStatus{Connected: true}
}

// GetConnectionInfo returns detailed info about a connection.
func (s *Service) GetConnectionInfo(connID string) types.ConnectionInfo {
	client, err := s.state.GetClient(connID)
	if err != nil {
		return types.ConnectionInfo{ID: connID}
	}

	ctx, cancel := core.ContextWithTimeout()
	defer cancel()

	info := types.ConnectionInfo{ID: connID, Type: "standalone"}

	// Get server info
	var result bson.M
	if err := client.Database("admin").RunCommand(ctx, bson.D{{Key: "buildInfo", Value: 1}}).Decode(&result); err == nil {
		if version, ok := result["version"].(string); ok {
			info.ServerVersion = version
		}
	}

	// Check if replica set
	var replStatus bson.M
	if err := client.Database("admin").RunCommand(ctx, bson.D{{Key: "replSetGetStatus", Value: 1}}).Decode(&replStatus); err == nil {
		info.Type = "replicaset"
		if setName, ok := replStatus["set"].(string); ok {
			info.ReplicaSet = setName
		}
	}

	return info
}

// GetServerInfo gathers comprehensive server diagnostics from multiple MongoDB commands.
// Each command failure is captured in the Errors map — the method never fails entirely.
func (s *Service) GetServerInfo(connID string) (*types.ServerInfo, error) {
	client, err := s.state.GetClient(connID)
	if err != nil {
		return nil, fmt.Errorf("not connected: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	info := &types.ServerInfo{
		Errors: make(map[string]string),
	}
	admin := client.Database("admin")

	// 1. buildInfo
	var buildInfo bson.M
	if err := admin.RunCommand(ctx, bson.D{{Key: "buildInfo", Value: 1}}).Decode(&buildInfo); err != nil {
		info.Errors["buildInfo"] = err.Error()
	} else {
		info.ServerVersion = bsonutil.ToString(buildInfo["version"])
		info.GitVersion = bsonutil.ToString(buildInfo["gitVersion"])
		if modules, ok := buildInfo["modules"].(bson.A); ok {
			for _, m := range modules {
				if s, ok := m.(string); ok {
					info.Modules = append(info.Modules, s)
				}
			}
		}
		if ssl, ok := buildInfo["openssl"].(bson.M); ok {
			info.OpenSSLVersion = bsonutil.ToString(ssl["running"])
		}
	}
	if info.Modules == nil {
		info.Modules = []string{}
	}

	// 2. hello — topology detection
	var hello bson.M
	if err := admin.RunCommand(ctx, bson.D{{Key: "hello", Value: 1}}).Decode(&hello); err != nil {
		info.Errors["hello"] = err.Error()
		info.Topology = "unknown"
	} else {
		if setName := bsonutil.ToString(hello["setName"]); setName != "" {
			info.Topology = "replicaset"
		} else if msg := bsonutil.ToString(hello["msg"]); msg == "isdbgrid" {
			info.Topology = "sharded"
		} else {
			info.Topology = "standalone"
		}
		info.MaxBsonSize = bsonutil.ToInt64(hello["maxBsonObjectSize"])
		info.MaxMsgSize = bsonutil.ToInt64(hello["maxMessageSizeBytes"])
		info.MaxWriteBatch = bsonutil.ToInt64(hello["maxWriteBatchSize"])
		info.ReadOnly = bsonutil.ToBool(hello["readOnly"])
	}

	// 3. featureCompatibilityVersion
	var fcvResult bson.M
	if err := admin.RunCommand(ctx, bson.D{
		{Key: "getParameter", Value: 1},
		{Key: "featureCompatibilityVersion", Value: 1},
	}).Decode(&fcvResult); err != nil {
		info.FCVError = err.Error()
		info.Errors["getParameter"] = err.Error()
	} else {
		if fcv, ok := fcvResult["featureCompatibilityVersion"].(bson.M); ok {
			info.FCV = bsonutil.ToString(fcv["version"])
		}
	}

	// 4. hostInfo
	var hostInfo bson.M
	if err := admin.RunCommand(ctx, bson.D{{Key: "hostInfo", Value: 1}}).Decode(&hostInfo); err != nil {
		info.Errors["hostInfo"] = err.Error()
	} else {
		host := &types.ServerHostInfo{}
		if sys, ok := hostInfo["system"].(bson.M); ok {
			host.Hostname = bsonutil.ToString(sys["hostname"])
			host.CPUs = int(bsonutil.ToInt64(sys["numCores"]))
			host.MemoryMB = bsonutil.ToFloat64(sys["memSizeMB"])
		}
		if os, ok := hostInfo["os"].(bson.M); ok {
			host.OS = bsonutil.ToString(os["name"])
			if host.OS == "" {
				host.OS = bsonutil.ToString(os["type"])
			}
		}
		if extra, ok := hostInfo["extra"].(bson.M); ok {
			host.Arch = bsonutil.ToString(extra["cpuArch"])
		}
		info.Host = host
	}

	// 5. serverStatus
	var serverStatus bson.M
	if err := admin.RunCommand(ctx, bson.D{{Key: "serverStatus", Value: 1}}).Decode(&serverStatus); err != nil {
		info.Errors["serverStatus"] = err.Error()
	} else {
		status := &types.ServerStatusInfo{}
		status.Uptime = bsonutil.ToInt64(serverStatus["uptime"])

		if conns, ok := serverStatus["connections"].(bson.M); ok {
			status.ConnsActive = bsonutil.ToInt64(conns["active"])
			status.ConnsCurrent = bsonutil.ToInt64(conns["current"])
			status.ConnsAvailable = bsonutil.ToInt64(conns["available"])
			status.ConnsTotalCreated = bsonutil.ToInt64(conns["totalCreated"])
		}
		if ops, ok := serverStatus["opcounters"].(bson.M); ok {
			status.OpsInsert = bsonutil.ToInt64(ops["insert"])
			status.OpsQuery = bsonutil.ToInt64(ops["query"])
			status.OpsUpdate = bsonutil.ToInt64(ops["update"])
			status.OpsDelete = bsonutil.ToInt64(ops["delete"])
			status.OpsGetmore = bsonutil.ToInt64(ops["getmore"])
			status.OpsCommand = bsonutil.ToInt64(ops["command"])
		}
		if mem, ok := serverStatus["mem"].(bson.M); ok {
			status.MemResident = bsonutil.ToInt64(mem["resident"])
			status.MemVirtual = bsonutil.ToInt64(mem["virtual"])
		}
		if net, ok := serverStatus["network"].(bson.M); ok {
			status.NetworkBytesIn = bsonutil.ToInt64(net["bytesIn"])
			status.NetworkBytesOut = bsonutil.ToInt64(net["bytesOut"])
			status.NetworkRequests = bsonutil.ToInt64(net["numRequests"])
		}
		if se, ok := serverStatus["storageEngine"].(bson.M); ok {
			status.StorageEngine = bsonutil.ToString(se["name"])
		}
		info.Status = status

		// Marshal full serverStatus as raw JSON
		if rawJSON, err := marshalBsonToJSON(serverStatus); err == nil {
			info.RawServerStatus = rawJSON
		}
	}

	// 6. replSetGetStatus (only for replicasets)
	if info.Topology == "replicaset" {
		var replStatus bson.M
		if err := admin.RunCommand(ctx, bson.D{{Key: "replSetGetStatus", Value: 1}}).Decode(&replStatus); err != nil {
			info.Errors["replSetGetStatus"] = err.Error()
		} else {
			rs := &types.ReplicaSetInfo{
				Name: bsonutil.ToString(replStatus["set"]),
			}
			if members, ok := replStatus["members"].(bson.A); ok {
				for _, m := range members {
					if member, ok := m.(bson.M); ok {
						rm := types.ReplicaSetMember{
							ID:       int(bsonutil.ToInt64(member["_id"])),
							Name:     bsonutil.ToString(member["name"]),
							StateStr: bsonutil.ToString(member["stateStr"]),
							Health:   int(bsonutil.ToInt64(member["health"])),
							Uptime:   bsonutil.ToInt64(member["uptime"]),
							Self:     bsonutil.ToBool(member["self"]),
						}
						if syncSrc := bsonutil.ToString(member["syncSourceHost"]); syncSrc != "" {
							rm.SyncSource = syncSrc
						} else {
							rm.SyncSource = bsonutil.ToString(member["syncingTo"])
						}
						if optime, ok := member["optimeDate"].(time.Time); ok {
							rm.OptimeDate = optime.UTC().Format(time.RFC3339)
						}
						rs.Members = append(rs.Members, rm)
					}
				}
			}
			if rs.Members == nil {
				rs.Members = []types.ReplicaSetMember{}
			}
			info.ReplicaSet = rs

			// Marshal full replSetGetStatus as raw JSON
			if rawJSON, err := marshalBsonToJSON(replStatus); err == nil {
				info.RawReplStatus = rawJSON
			}
		}
	}

	return info, nil
}

func marshalBsonToJSON(m bson.M) (string, error) {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// Shutdown closes all connections and cleans up resources.
func (s *Service) Shutdown(ctx context.Context) {
	detached := s.state.DetachAll()
	for _, connection := range detached {
		if connection.Cancel != nil {
			connection.Cancel()
		}
	}
	if err := s.teardownAll(ctx, detached); err != nil {
		debug.LogConnection("Connection shutdown cleanup failed", map[string]interface{}{
			"error": err.Error(),
		})
	}
}
