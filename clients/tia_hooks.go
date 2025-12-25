/*
TiaCC Go Client - 测试框架集成钩子

Usage:

	hooks := tia.NewHooks(nil)
	if err := hooks.Connect(); err != nil {
	    log.Fatal(err)
	}
	defer hooks.Disconnect()

	for _, test := range tests {
	    hooks.BeforeTest(test.Name)
	    runTest(test)
	    hooks.AfterTest(test.Name)
	}
*/
package tia

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"sync"
	"time"
)

type Config struct {
	Host       string
	Port       int
	Timeout    time.Duration
	Mode       string // "precise" or "bucket"
	BucketSize int
	Language   string // "cpp" or "csharp"
}

func DefaultConfig() *Config {
	return &Config{
		Host:       "127.0.0.1",
		Port:       19840,
		Timeout:    5 * time.Second,
		Mode:       "precise",
		BucketSize: 50,
		Language:   "cpp",
	}
}

type Hooks struct {
	config      *Config
	conn        net.Conn
	reader      *bufio.Reader
	requestID   int
	bucketCount int
	bucketTests []string
	mu          sync.Mutex
}

func NewHooks(config *Config) *Hooks {
	if config == nil {
		config = DefaultConfig()
	}
	return &Hooks{config: config}
}

func (h *Hooks) Connect() error {
	addr := fmt.Sprintf("%s:%d", h.config.Host, h.config.Port)
	conn, err := net.DialTimeout("tcp", addr, h.config.Timeout)
	if err != nil {
		return fmt.Errorf("连接失败: %w", err)
	}

	h.conn = conn
	h.reader = bufio.NewReader(conn)
	return nil
}

func (h *Hooks) Disconnect() {
	if h.conn != nil {
		h.conn.Close()
		h.conn = nil
	}
}

type rpcRequest struct {
	JSONRPC string      `json:"jsonrpc"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params"`
	ID      int         `json:"id"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	Result  json.RawMessage `json:"result"`
	Error   *rpcError       `json:"error"`
	ID      int             `json:"id"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (h *Hooks) sendRPC(method string, params interface{}) (json.RawMessage, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.conn == nil {
		return nil, fmt.Errorf("未连接")
	}

	h.requestID++
	req := rpcRequest{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
		ID:      h.requestID,
	}

	data, _ := json.Marshal(req)
	data = append(data, '\n')

	h.conn.SetDeadline(time.Now().Add(h.config.Timeout))
	if _, err := h.conn.Write(data); err != nil {
		return nil, err
	}

	line, err := h.reader.ReadBytes('\n')
	if err != nil {
		return nil, err
	}

	var resp rpcResponse
	if err := json.Unmarshal(line, &resp); err != nil {
		return nil, err
	}

	if resp.Error != nil {
		return nil, fmt.Errorf("RPC 错误: %s", resp.Error.Message)
	}

	return resp.Result, nil
}

func (h *Hooks) StartRecording(testID string) (bool, error) {
	result, err := h.sendRPC("startRecording", map[string]string{
		"testId":   testID,
		"language": h.config.Language,
	})
	if err != nil {
		return false, err
	}

	var res struct{ Success bool }
	json.Unmarshal(result, &res)
	return res.Success, nil
}

func (h *Hooks) StopRecording(testID string) (bool, error) {
	result, err := h.sendRPC("stopRecording", map[string]string{"testId": testID})
	if err != nil {
		return false, err
	}

	var res struct{ Success bool }
	json.Unmarshal(result, &res)
	return res.Success, nil
}

func (h *Hooks) DumpCoverage(testID, outputPath string) (bool, error) {
	params := map[string]string{"testId": testID}
	if outputPath != "" {
		params["outputPath"] = outputPath
	}

	result, err := h.sendRPC("dumpCoverage", params)
	if err != nil {
		return false, err
	}

	var res struct{ Success bool }
	json.Unmarshal(result, &res)
	return res.Success, nil
}

func (h *Hooks) ResetAll() (bool, error) {
	result, err := h.sendRPC("resetAll", nil)
	if err != nil {
		return false, err
	}

	var res struct{ Success bool }
	json.Unmarshal(result, &res)
	return res.Success, nil
}

// 高级 API

func (h *Hooks) BeforeTest(testID string) error {
	if h.config.Mode == "precise" {
		_, err := h.StartRecording(testID)
		return err
	}

	h.bucketTests = append(h.bucketTests, testID)
	h.bucketCount++

	if h.bucketCount == 1 {
		bucketID := fmt.Sprintf("bucket_%d", h.requestID/h.config.BucketSize)
		_, err := h.StartRecording(bucketID)
		return err
	}
	return nil
}

func (h *Hooks) AfterTest(testID string) error {
	if h.config.Mode == "precise" {
		h.StopRecording(testID)
		_, err := h.DumpCoverage(testID, "")
		return err
	}

	if h.bucketCount >= h.config.BucketSize {
		return h.FlushBucket()
	}
	return nil
}

func (h *Hooks) FlushBucket() error {
	if h.bucketCount > 0 {
		bucketID := fmt.Sprintf("bucket_%d", h.requestID/h.config.BucketSize)
		h.StopRecording(bucketID)
		h.DumpCoverage(bucketID, "")
		h.bucketTests = nil
		h.bucketCount = 0
	}
	return nil
}
