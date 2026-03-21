// EdgeBase Go SDK — core package
// Server-side admin SDK for Go
// (server-only), #133 §2 (namespace+id DB routing)
//
// Usage:
//
//	admin := edgebase.NewAdminClient("https://my-app.edgebase.fun", os.Getenv("EDGEBASE_SERVICE_KEY"))
//	posts, err := admin.DB("shared", "").Table("posts").Where("status", "==", "published").GetList(ctx)
package edgebase

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// jsonMarshalNoEscape encodes v to JSON without HTML-escaping (<, >, &).
// The default json.Marshal escapes these characters which breaks filter operators like >= to \u003e=.
func jsonMarshalNoEscape(v interface{}) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	// json.Encoder appends a newline; trim it
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

func asStringValue(value interface{}) string {
	text, _ := value.(string)
	return text
}

func asBoolValue(value interface{}) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case float64:
		return typed != 0
	case int:
		return typed != 0
	case string:
		lowered := strings.ToLower(typed)
		return lowered == "true" || lowered == "1"
	default:
		return false
	}
}

func asInt64Value(value interface{}) int64 {
	switch typed := value.(type) {
	case int:
		return int64(typed)
	case int32:
		return int64(typed)
	case int64:
		return typed
	case float64:
		return int64(typed)
	case json.Number:
		parsed, _ := typed.Int64()
		return parsed
	default:
		return 0
	}
}

func asRecordValue(value interface{}) map[string]interface{} {
	record, _ := value.(map[string]interface{})
	if record == nil {
		return map[string]interface{}{}
	}
	return record
}

func collectInsertedRows(data map[string]interface{}) []map[string]interface{} {
	result := []map[string]interface{}{}
	if inserted, ok := data["inserted"].([]interface{}); ok {
		for _, item := range inserted {
			if m, ok := item.(map[string]interface{}); ok {
				result = append(result, m)
			}
		}
	}
	return result
}

func encodeStorageKeyPath(key string) string {
	if key == "" {
		return ""
	}
	parts := strings.Split(key, "/")
	for index, part := range parts {
		parts[index] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}

// ─── HTTP Client ──────────────────────────────────────────────────────────────

// HTTPClient handles authenticated HTTP requests to EdgeBase server.
type HTTPClient struct {
	baseURL    string
	serviceKey string
	client     *http.Client
}

func resolveHTTPTimeout() time.Duration {
	raw := strings.TrimSpace(os.Getenv("EDGEBASE_HTTP_TIMEOUT_MS"))
	if raw == "" {
		return 0
	}
	timeoutMs, err := strconv.Atoi(raw)
	if err != nil || timeoutMs <= 0 {
		return 0
	}
	return time.Duration(timeoutMs) * time.Millisecond
}

// NewHTTPClient creates a new HTTP client.
func NewHTTPClient(baseURL, serviceKey string) *HTTPClient {
	client := &http.Client{}
	if timeout := resolveHTTPTimeout(); timeout > 0 {
		client.Timeout = timeout
	}
	return &HTTPClient{
		baseURL:    strings.TrimRight(baseURL, "/"),
		serviceKey: serviceKey,
		client:     client,
	}
}

// getAccessToken returns the current access token (service key).
// If retrieval fails, returns empty string for graceful degradation.
func (c *HTTPClient) getAccessToken() string {
	defer func() {
		recover() // Token refresh failed — proceed as unauthenticated
	}()
	return c.serviceKey
}

func parseRetryAfterDelay(header string, attempt int) time.Duration {
	baseDelay := time.Duration(1000*(1<<attempt)) * time.Millisecond
	if header != "" {
		if seconds, err := strconv.Atoi(header); err == nil && seconds > 0 {
			baseDelay = time.Duration(seconds) * time.Second
		}
	}
	jitter := time.Duration(float64(baseDelay) * 0.25 * float64(time.Now().UnixNano()%100) / 100)
	delay := baseDelay + jitter
	if delay > 10*time.Second {
		delay = 10 * time.Second
	}
	return delay
}

func isRetryableTransportError(err error) bool {
	msg := strings.ToLower(err.Error())
	for _, keyword := range []string{"timeout", "connection", "reset", "refused", "network", "eof", "broken pipe"} {
		if strings.Contains(msg, keyword) {
			return true
		}
	}
	return false
}

func (c *HTTPClient) do(ctx context.Context, method, path string, body interface{}) (map[string]interface{}, error) {
	maxRetries := 3
	var lastErr error

	for attempt := 0; attempt <= maxRetries; attempt++ {
		var bodyReader io.Reader
		if body != nil {
			b, err := json.Marshal(body)
			if err != nil {
				return nil, fmt.Errorf("marshal body: %w", err)
			}
			bodyReader = bytes.NewReader(b)
		}

		req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bodyReader)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		if token := c.getAccessToken(); token != "" {
			req.Header.Set("X-EdgeBase-Service-Key", token)
		}

		resp, err := c.client.Do(req)
		if err != nil {
			lastErr = err
			if attempt < 2 && isRetryableTransportError(err) {
				time.Sleep(time.Duration(50*(attempt+1)) * time.Millisecond)
				continue
			}
			return nil, fmt.Errorf("network error: %w", err)
		}

		respBody, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, err
		}

		// 429 retry with Retry-After
		if resp.StatusCode == 429 && attempt < maxRetries {
			delay := parseRetryAfterDelay(resp.Header.Get("Retry-After"), attempt)
			time.Sleep(delay)
			continue
		}

		if resp.StatusCode >= 400 {
			return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
		}

		if len(respBody) == 0 || resp.StatusCode == 204 {
			return nil, nil
		}

		var arrResult []interface{}
		if json.Unmarshal(respBody, &arrResult) == nil {
			return map[string]interface{}{"items": arrResult}, nil
		}

		var result map[string]interface{}
		if err := json.Unmarshal(respBody, &result); err != nil {
			return nil, fmt.Errorf("unmarshal response: %w", err)
		}
		return result, nil
	}

	if lastErr != nil {
		return nil, fmt.Errorf("network error after retries: %w", lastErr)
	}
	return nil, fmt.Errorf("request failed after retries")
}

func (c *HTTPClient) Get(ctx context.Context, path string) (map[string]interface{}, error) {
	return c.do(ctx, http.MethodGet, path, nil)
}

func (c *HTTPClient) Post(ctx context.Context, path string, body interface{}) (map[string]interface{}, error) {
	return c.do(ctx, http.MethodPost, path, body)
}

func (c *HTTPClient) Patch(ctx context.Context, path string, body interface{}) (map[string]interface{}, error) {
	return c.do(ctx, http.MethodPatch, path, body)
}

func (c *HTTPClient) Delete(ctx context.Context, path string) (map[string]interface{}, error) {
	return c.do(ctx, http.MethodDelete, path, nil)
}

func (c *HTTPClient) Put(ctx context.Context, path string, body interface{}) (map[string]interface{}, error) {
	return c.do(ctx, http.MethodPut, path, body)
}

// PostMultipart uploads multipart form data.
func (c *HTTPClient) PostMultipart(
	ctx context.Context,
	path string,
	fileField string,
	fileName string,
	data []byte,
	contentType string,
	fields map[string]string,
) (map[string]interface{}, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	part, err := writer.CreateFormFile(fileField, fileName)
	if err != nil {
		return nil, err
	}
	if _, err := part.Write(data); err != nil {
		return nil, err
	}
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, &body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	// Token refresh failed — proceed as unauthenticated
	if token := c.getAccessToken(); token != "" {
		req.Header.Set("X-EdgeBase-Service-Key", token)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("network error: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	if len(respBody) == 0 || resp.StatusCode == 204 {
		return nil, nil
	}

	var result map[string]interface{}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}
	return result, nil
}

// GetRaw downloads raw bytes.
func (c *HTTPClient) GetRaw(ctx context.Context, path string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	// Token refresh failed — proceed as unauthenticated
	if token := c.getAccessToken(); token != "" {
		req.Header.Set("X-EdgeBase-Service-Key", token)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("network error: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body))
	}
	return body, nil
}

// Head sends a HEAD request and returns true if status is 2xx.
func (c *HTTPClient) Head(ctx context.Context, path string) (bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, c.baseURL+path, nil)
	if err != nil {
		return false, err
	}
	// Token refresh failed — proceed as unauthenticated
	if token := c.getAccessToken(); token != "" {
		req.Header.Set("X-EdgeBase-Service-Key", token)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return false, fmt.Errorf("network error: %w", err)
	}
	defer resp.Body.Close()

	return resp.StatusCode >= 200 && resp.StatusCode < 300, nil
}

// GetWithQuery performs a GET request with query parameters appended to the path.
func (c *HTTPClient) GetWithQuery(ctx context.Context, path string, query map[string]string) (map[string]interface{}, error) {
	if len(query) > 0 {
		params := url.Values{}
		for k, v := range query {
			params.Set(k, v)
		}
		path += "?" + params.Encode()
	}
	return c.Get(ctx, path)
}

// DoWithQuery performs an HTTP request with query parameters appended to the path.
func (c *HTTPClient) DoWithQuery(ctx context.Context, method, path string, body interface{}, query map[string]string) (map[string]interface{}, error) {
	if len(query) > 0 {
		params := url.Values{}
		for k, v := range query {
			params.Set(k, v)
		}
		path += "?" + params.Encode()
	}
	return c.do(ctx, method, path, body)
}

// ─── Filter ───────────────────────────────────────────────────────────────────

// Filter represents a query filter condition.
type Filter struct {
	Field string
	Op    string
	Value interface{}
}

func (f Filter) toJSON() []interface{} {
	return []interface{}{f.Field, f.Op, f.Value}
}

type OrBuilder struct {
	filters []Filter
}

func (b *OrBuilder) Where(field, op string, value interface{}) *OrBuilder {
	b.filters = append(b.filters, Filter{Field: field, Op: op, Value: value})
	return b
}

func (b *OrBuilder) Filters() []Filter {
	return append([]Filter{}, b.filters...)
}

// ─── TableRef ─────────────────────────────────────────────────────────────────

// ListResult is the paginated result of a table query.
type ListResult struct {
	Items   []map[string]interface{} `json:"items"`
	Total   *int                     `json:"total"`
	Page    *int                     `json:"page"`
	PerPage *int                     `json:"perPage"`
	HasMore *bool                    `json:"hasMore"`
	Cursor  *string                  `json:"cursor"`
}

type BatchResult struct {
	TotalProcessed int                      `json:"totalProcessed"`
	TotalSucceeded int                      `json:"totalSucceeded"`
	Errors         []map[string]interface{} `json:"errors"`
}

// TableRef is an immutable query builder for a table.
type TableRef struct {
	core       *GeneratedDbApi
	name       string
	namespace  string
	instanceID string
	filters    []Filter
	orFilters  []Filter
	sorts      [][2]string
	limit      *int
	offset     *int
	page       *int
	after      string
	before     string
	search     string
}

func newTableRef(core *GeneratedDbApi, name, namespace, instanceID string) *TableRef {
	return &TableRef{
		core:       core,
		name:       name,
		namespace:  namespace,
		instanceID: instanceID,
	}
}

func (t *TableRef) clone() *TableRef {
	c := *t
	c.filters = append([]Filter{}, t.filters...)
	c.orFilters = append([]Filter{}, t.orFilters...)
	c.sorts = append([][2]string{}, t.sorts...)
	return &c
}

// buildQueryParams returns query parameters as a map for use with generated core methods.
func (t *TableRef) buildQueryParams() map[string]string {
	params := map[string]string{}

	if len(t.filters) > 0 {
		filterJSON := make([][]interface{}, len(t.filters))
		for i, f := range t.filters {
			filterJSON[i] = f.toJSON()
		}
		b, _ := jsonMarshalNoEscape(filterJSON)
		params["filter"] = string(b)
	}

	if len(t.orFilters) > 0 {
		orFilterJSON := make([][]interface{}, len(t.orFilters))
		for i, f := range t.orFilters {
			orFilterJSON[i] = f.toJSON()
		}
		b, _ := jsonMarshalNoEscape(orFilterJSON)
		params["orFilter"] = string(b)
	}

	if len(t.sorts) > 0 {
		sortParts := make([]string, len(t.sorts))
		for i, s := range t.sorts {
			sortParts[i] = s[0] + ":" + s[1]
		}
		params["sort"] = strings.Join(sortParts, ",")
	}

	if t.limit != nil {
		params["limit"] = fmt.Sprintf("%d", *t.limit)
	}
	if t.offset != nil {
		params["offset"] = fmt.Sprintf("%d", *t.offset)
	}
	if t.page != nil {
		params["page"] = fmt.Sprintf("%d", *t.page)
	}
	if t.after != "" {
		params["after"] = t.after
	}
	if t.before != "" {
		params["before"] = t.before
	}
	if t.search != "" {
		params["search"] = t.search
	}

	return params
}

func (t *TableRef) validateQueryState() error {
	if (t.after != "" || t.before != "") && (t.offset != nil || t.page != nil) {
		return fmt.Errorf("Cannot use page()/offset() with after()/before() — choose offset or cursor pagination")
	}
	return nil
}

func (t *TableRef) buildQueryString() string {
	params := t.buildQueryParams()
	if len(params) == 0 {
		return ""
	}
	vals := url.Values{}
	for k, v := range params {
		vals.Set(k, v)
	}
	return "?" + vals.Encode()
}

// Where adds a filter condition (immutable).
func (t *TableRef) Where(field, op string, value interface{}) *TableRef {
	c := t.clone()
	c.filters = append(c.filters, Filter{field, op, value})
	return c
}

// OrderBy adds a sort order (immutable).
func (t *TableRef) OrderBy(field, direction string) *TableRef {
	c := t.clone()
	c.sorts = append(c.sorts, [2]string{field, direction})
	return c
}

// Or adds OR conditions (immutable).
func (t *TableRef) Or(builderFn func(*OrBuilder)) *TableRef {
	builder := &OrBuilder{}
	builderFn(builder)
	c := t.clone()
	c.orFilters = append(c.orFilters, builder.Filters()...)
	return c
}

// Limit sets the result limit (immutable).
func (t *TableRef) Limit(n int) *TableRef {
	c := t.clone()
	c.limit = &n
	return c
}

// Offset sets the result offset (immutable).
func (t *TableRef) Offset(n int) *TableRef {
	c := t.clone()
	c.offset = &n
	return c
}

// Page sets the 1-based page index (immutable).
func (t *TableRef) Page(n int) *TableRef {
	c := t.clone()
	c.page = &n
	return c
}

// After sets the cursor for forward pagination (immutable).
func (t *TableRef) After(cursor string) *TableRef {
	c := t.clone()
	c.after = cursor
	c.before = ""
	return c
}

// Before sets the cursor for backward pagination (immutable).
func (t *TableRef) Before(cursor string) *TableRef {
	c := t.clone()
	c.before = cursor
	c.after = ""
	return c
}

// Search sets the full-text search query (immutable).
func (t *TableRef) Search(query string) *TableRef {
	c := t.clone()
	c.search = query
	return c
}

// GetList executes the query and returns a ListResult.
func (t *TableRef) GetList(ctx context.Context) (*ListResult, error) {
	if err := t.validateQueryState(); err != nil {
		return nil, err
	}
	var data map[string]interface{}
	var err error

	if t.search != "" {
		query := t.buildQueryParams()
		if t.instanceID != "" {
			data, err = t.core.DbSearchRecords(ctx, t.namespace, t.instanceID, t.name, query)
		} else {
			data, err = t.core.DbSingleSearchRecords(ctx, t.namespace, t.name, query)
		}
	} else {
		query := t.buildQueryParams()
		if t.instanceID != "" {
			data, err = t.core.DbListRecords(ctx, t.namespace, t.instanceID, t.name, query)
		} else {
			data, err = t.core.DbSingleListRecords(ctx, t.namespace, t.name, query)
		}
	}
	if err != nil {
		return nil, err
	}

	result := &ListResult{}
	if items, ok := data["items"].([]interface{}); ok {
		for _, item := range items {
			if m, ok := item.(map[string]interface{}); ok {
				result.Items = append(result.Items, m)
			}
		}
	}
	if total, ok := data["total"].(float64); ok {
		n := int(total)
		result.Total = &n
	}
	if page, ok := data["page"].(float64); ok {
		n := int(page)
		result.Page = &n
	}
	if perPage, ok := data["perPage"].(float64); ok {
		n := int(perPage)
		result.PerPage = &n
	}
	if hasMore, ok := data["hasMore"].(bool); ok {
		result.HasMore = &hasMore
	}
	if cursor, ok := data["cursor"].(string); ok {
		result.Cursor = &cursor
	}

	return result, nil
}

// GetOne retrieves a single record by ID.
func (t *TableRef) GetOne(ctx context.Context, id string) (map[string]interface{}, error) {
	if t.instanceID != "" {
		return t.core.DbGetRecord(ctx, t.namespace, t.instanceID, t.name, id, nil)
	}
	return t.core.DbSingleGetRecord(ctx, t.namespace, t.name, id, nil)
}

// GetFirst returns the first record matching the current query, or nil if none match.
func (t *TableRef) GetFirst(ctx context.Context) (map[string]interface{}, error) {
	result, err := t.Limit(1).GetList(ctx)
	if err != nil {
		return nil, err
	}
	if len(result.Items) == 0 {
		return nil, nil
	}
	return result.Items[0], nil
}

// Insert inserts a new record.
func (t *TableRef) Insert(ctx context.Context, record map[string]interface{}) (map[string]interface{}, error) {
	if t.instanceID != "" {
		return t.core.DbInsertRecord(ctx, t.namespace, t.instanceID, t.name, record, nil)
	}
	return t.core.DbSingleInsertRecord(ctx, t.namespace, t.name, record, nil)
}

// Update updates a record by ID.
func (t *TableRef) Update(ctx context.Context, id string, data map[string]interface{}) (map[string]interface{}, error) {
	if t.instanceID != "" {
		return t.core.DbUpdateRecord(ctx, t.namespace, t.instanceID, t.name, id, data)
	}
	return t.core.DbSingleUpdateRecord(ctx, t.namespace, t.name, id, data)
}

// Delete deletes a record by ID.
func (t *TableRef) Delete(ctx context.Context, id string) error {
	if t.instanceID != "" {
		_, err := t.core.DbDeleteRecord(ctx, t.namespace, t.instanceID, t.name, id)
		return err
	}
	_, err := t.core.DbSingleDeleteRecord(ctx, t.namespace, t.name, id)
	return err
}

// SQL executes admin SQL scoped to this table's database namespace.
func (t *TableRef) SQL(ctx context.Context, query string, params []interface{}) ([]interface{}, error) {
	body := map[string]interface{}{
		"namespace": t.namespace,
		"sql":       query,
		"params":    params,
	}
	if t.instanceID != "" {
		body["id"] = t.instanceID
	}
	data, err := NewGeneratedAdminApi(t.core.client).ExecuteSql(ctx, body)
	if err != nil {
		return nil, err
	}
	if rows, ok := data["items"].([]interface{}); ok {
		return rows, nil
	}
	return []interface{}{}, nil
}

// Count returns the number of records matching the current filters.
func (t *TableRef) Count(ctx context.Context) (int, error) {
	if err := t.validateQueryState(); err != nil {
		return 0, err
	}
	query := t.buildQueryParams()
	var data map[string]interface{}
	var err error
	if t.instanceID != "" {
		data, err = t.core.DbCountRecords(ctx, t.namespace, t.instanceID, t.name, query)
	} else {
		data, err = t.core.DbSingleCountRecords(ctx, t.namespace, t.name, query)
	}
	if err != nil {
		return 0, err
	}
	if total, ok := data["total"].(float64); ok {
		return int(total), nil
	}
	return 0, nil
}

// InsertMany inserts multiple records.
func (t *TableRef) InsertMany(ctx context.Context, records []map[string]interface{}) ([]map[string]interface{}, error) {
	const chunkSize = 500
	if len(records) <= chunkSize {
		body := map[string]interface{}{
			"inserts": records,
		}
		var data map[string]interface{}
		var err error
		if t.instanceID != "" {
			data, err = t.core.DbBatchRecords(ctx, t.namespace, t.instanceID, t.name, body, nil)
		} else {
			data, err = t.core.DbSingleBatchRecords(ctx, t.namespace, t.name, body, nil)
		}
		if err != nil {
			return nil, err
		}
		return collectInsertedRows(data), nil
	}

	result := make([]map[string]interface{}, 0, len(records))
	for start := 0; start < len(records); start += chunkSize {
		end := start + chunkSize
		if end > len(records) {
			end = len(records)
		}
		items, err := t.InsertMany(ctx, records[start:end])
		if err != nil {
			return nil, err
		}
		result = append(result, items...)
	}
	return result, nil
}

// Upsert upserts a record (creates or updates based on conflict target).
func (t *TableRef) Upsert(ctx context.Context, record map[string]interface{}, conflictTarget string) (map[string]interface{}, error) {
	query := map[string]string{"upsert": "true"}
	if conflictTarget != "" {
		query["conflictTarget"] = conflictTarget
	}
	if t.instanceID != "" {
		return t.core.DbInsertRecord(ctx, t.namespace, t.instanceID, t.name, record, query)
	}
	return t.core.DbSingleInsertRecord(ctx, t.namespace, t.name, record, query)
}

// UpsertMany upserts multiple records.
func (t *TableRef) UpsertMany(ctx context.Context, records []map[string]interface{}, conflictTarget string) ([]map[string]interface{}, error) {
	const chunkSize = 500
	if len(records) <= chunkSize {
		body := map[string]interface{}{
			"inserts": records,
		}
		query := map[string]string{"upsert": "true"}
		if conflictTarget != "" {
			query["conflictTarget"] = conflictTarget
		}
		var data map[string]interface{}
		var err error
		if t.instanceID != "" {
			data, err = t.core.DbBatchRecords(ctx, t.namespace, t.instanceID, t.name, body, query)
		} else {
			data, err = t.core.DbSingleBatchRecords(ctx, t.namespace, t.name, body, query)
		}
		if err != nil {
			return nil, err
		}
		return collectInsertedRows(data), nil
	}

	result := make([]map[string]interface{}, 0, len(records))
	for start := 0; start < len(records); start += chunkSize {
		end := start + chunkSize
		if end > len(records) {
			end = len(records)
		}
		items, err := t.UpsertMany(ctx, records[start:end], conflictTarget)
		if err != nil {
			return nil, err
		}
		result = append(result, items...)
	}
	return result, nil
}

// UpdateMany updates records matching the current filters.
func (t *TableRef) UpdateMany(ctx context.Context, update map[string]interface{}) (*BatchResult, error) {
	if len(t.filters) == 0 {
		return nil, fmt.Errorf("updateMany requires at least one where() filter")
	}
	filterJSON := make([][]interface{}, len(t.filters))
	for i, f := range t.filters {
		filterJSON[i] = f.toJSON()
	}
	body := map[string]interface{}{
		"action": "update",
		"filter": filterJSON,
		"update": update,
		"limit":  500,
	}
	if len(t.orFilters) > 0 {
		orFilterJSON := make([][]interface{}, len(t.orFilters))
		for i, f := range t.orFilters {
			orFilterJSON[i] = f.toJSON()
		}
		body["orFilter"] = orFilterJSON
	}
	var data map[string]interface{}
	var err error
	if t.instanceID != "" {
		data, err = t.core.DbBatchByFilter(ctx, t.namespace, t.instanceID, t.name, body, nil)
	} else {
		data, err = t.core.DbSingleBatchByFilter(ctx, t.namespace, t.name, body, nil)
	}
	if err != nil {
		return nil, err
	}
	return parseBatchResult(data), nil
}

// DeleteMany deletes records matching the current filters.
func (t *TableRef) DeleteMany(ctx context.Context) (*BatchResult, error) {
	if len(t.filters) == 0 {
		return nil, fmt.Errorf("deleteMany requires at least one where() filter")
	}
	filterJSON := make([][]interface{}, len(t.filters))
	for i, f := range t.filters {
		filterJSON[i] = f.toJSON()
	}
	body := map[string]interface{}{
		"action": "delete",
		"filter": filterJSON,
		"limit":  500,
	}
	if len(t.orFilters) > 0 {
		orFilterJSON := make([][]interface{}, len(t.orFilters))
		for i, f := range t.orFilters {
			orFilterJSON[i] = f.toJSON()
		}
		body["orFilter"] = orFilterJSON
	}
	var data map[string]interface{}
	var err error
	if t.instanceID != "" {
		data, err = t.core.DbBatchByFilter(ctx, t.namespace, t.instanceID, t.name, body, nil)
	} else {
		data, err = t.core.DbSingleBatchByFilter(ctx, t.namespace, t.name, body, nil)
	}
	if err != nil {
		return nil, err
	}
	return parseBatchResult(data), nil
}

// Doc returns a document-scoped helper for record operations by ID.
func (t *TableRef) Doc(id string) *DocRef {
	return &DocRef{table: t, id: id}
}

func parseBatchResult(data map[string]interface{}) *BatchResult {
	result := &BatchResult{}
	if total, ok := data["processed"].(float64); ok {
		result.TotalProcessed = int(total)
	} else if total, ok := data["totalProcessed"].(float64); ok {
		result.TotalProcessed = int(total)
	}
	if total, ok := data["succeeded"].(float64); ok {
		result.TotalSucceeded = int(total)
	} else if total, ok := data["totalSucceeded"].(float64); ok {
		result.TotalSucceeded = int(total)
	}
	if errs, ok := data["errors"].([]interface{}); ok {
		for _, item := range errs {
			if m, ok := item.(map[string]interface{}); ok {
				result.Errors = append(result.Errors, m)
			}
		}
	}
	return result
}

type DocRef struct {
	table *TableRef
	id    string
}

func (d *DocRef) Get(ctx context.Context) (map[string]interface{}, error) {
	return d.table.GetOne(ctx, d.id)
}

func (d *DocRef) Update(ctx context.Context, data map[string]interface{}) (map[string]interface{}, error) {
	return d.table.Update(ctx, d.id, data)
}

func (d *DocRef) Delete(ctx context.Context) error {
	return d.table.Delete(ctx, d.id)
}

// ─── DbRef ────────────────────────────────────────────────────────────────────

// DbRef represents a DB namespace block.
type DbRef struct {
	core       *GeneratedDbApi
	namespace  string
	instanceID string
}

// Table returns a TableRef for the named table.
func (d *DbRef) Table(name string) *TableRef {
	return newTableRef(d.core, name, d.namespace, d.instanceID)
}

// ─── AdminAuthClient ──────────────────────────────────────────────────────────

// AdminAuthClient provides admin-level user management.
// Delegates all HTTP calls to GeneratedAdminApi methods.
type AdminAuthClient struct {
	adminCore *GeneratedAdminApi
}

// CreateUser creates a new user with email and password.
func (a *AdminAuthClient) CreateUser(ctx context.Context, email, password string) (map[string]interface{}, error) {
	result, err := a.adminCore.AdminAuthCreateUser(ctx, map[string]interface{}{
		"email":    email,
		"password": password,
	})
	if err != nil {
		return nil, err
	}
	// Server wraps user in {user: {...}} - extract it
	if user, ok := result["user"]; ok {
		if userMap, ok := user.(map[string]interface{}); ok {
			return userMap, nil
		}
	}
	return result, nil
}

// GetUser retrieves a user by ID.
func (a *AdminAuthClient) GetUser(ctx context.Context, userID string) (map[string]interface{}, error) {
	result, err := a.adminCore.AdminAuthGetUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user, ok := result["user"].(map[string]interface{}); ok {
		return user, nil
	}
	return result, nil
}

// ListUsers retrieves a list of users.
func (a *AdminAuthClient) ListUsers(ctx context.Context, limit int) (map[string]interface{}, error) {
	query := map[string]string{"limit": fmt.Sprintf("%d", limit)}
	return a.adminCore.AdminAuthListUsers(ctx, query)
}

// ListUsersPage retrieves a list of users with optional cursor pagination.
func (a *AdminAuthClient) ListUsersPage(ctx context.Context, limit int, cursor string) (map[string]interface{}, error) {
	query := map[string]string{"limit": fmt.Sprintf("%d", limit)}
	if cursor != "" {
		query["cursor"] = cursor
	}
	return a.adminCore.AdminAuthListUsers(ctx, query)
}

// UpdateUser updates user profile fields.
func (a *AdminAuthClient) UpdateUser(ctx context.Context, userID string, data map[string]interface{}) (map[string]interface{}, error) {
	result, err := a.adminCore.AdminAuthUpdateUser(ctx, userID, data)
	if err != nil {
		return nil, err
	}
	if user, ok := result["user"].(map[string]interface{}); ok {
		return user, nil
	}
	return result, nil
}

// SetCustomClaims sets custom claims for a user.
func (a *AdminAuthClient) SetCustomClaims(ctx context.Context, userID string, claims map[string]interface{}) error {
	_, err := a.adminCore.AdminAuthSetClaims(ctx, userID, claims)
	return err
}

// RevokeAllSessions revokes all sessions for a user.
func (a *AdminAuthClient) RevokeAllSessions(ctx context.Context, userID string) error {
	_, err := a.adminCore.AdminAuthRevokeUserSessions(ctx, userID)
	return err
}

// DeleteUser deletes a user by ID.
func (a *AdminAuthClient) DeleteUser(ctx context.Context, userID string) error {
	_, err := a.adminCore.AdminAuthDeleteUser(ctx, userID)
	return err
}

// DisableMfa disables MFA for a user (admin operation via Service Key).
func (a *AdminAuthClient) DisableMfa(ctx context.Context, userID string) error {
	_, err := a.adminCore.AdminAuthDeleteUserMfa(ctx, userID)
	return err
}

// ─── AdminClient ─────────────────────────────────────────────────────────────

// AdminClient is the server-side EdgeBase SDK entry point.
type AdminClient struct {
	http      *HTTPClient
	core      *GeneratedDbApi
	adminCore *GeneratedAdminApi
	AdminAuth *AdminAuthClient
	Push      *PushClient
}

// NewAdminClient creates a new EdgeBase admin client.
func NewAdminClient(baseURL, serviceKey string) *AdminClient {
	h := NewHTTPClient(baseURL, serviceKey)
	ac := NewGeneratedAdminApi(h)
	return &AdminClient{
		http:      h,
		core:      NewGeneratedDbApi(h),
		adminCore: ac,
		AdminAuth: &AdminAuthClient{adminCore: ac},
		Push:      &PushClient{adminCore: ac},
	}
}

func (c *AdminClient) DB(namespace, instanceID string) *DbRef {
	return &DbRef{
		core:       c.core,
		namespace:  namespace,
		instanceID: instanceID,
	}
}

// SQL executes raw SQL on a DB namespace.
func (c *AdminClient) SQL(ctx context.Context, namespace, instanceID, query string, params []interface{}) ([]interface{}, error) {
	if strings.TrimSpace(query) == "" {
		return nil, fmt.Errorf("Invalid sql() signature: query must be a non-empty string")
	}
	if params == nil {
		params = []interface{}{}
	}
	body := map[string]interface{}{
		"namespace": namespace,
		"sql":       query,
		"params":    params,
	}
	if instanceID != "" {
		body["id"] = instanceID
	}
	data, err := c.adminCore.ExecuteSql(ctx, body)
	if err != nil {
		return nil, err
	}
	if rows, ok := data["items"].([]interface{}); ok {
		return rows, nil
	}
	return nil, nil
}

// Broadcast sends a database-live broadcast message.
func (c *AdminClient) Broadcast(ctx context.Context, channel, event string, payload map[string]interface{}) error {
	_, err := c.adminCore.DatabaseLiveBroadcast(ctx, map[string]interface{}{
		"channel": channel,
		"event":   event,
		"payload": payload,
	})
	return err
}

// Storage returns a storage client for bucket-scoped file operations.
func (c *AdminClient) Storage() *StorageClient {
	return &StorageClient{http: c.http, core: c.core}
}

// KV returns a KV client for the given namespace.
func (c *AdminClient) KV(namespace string) *KvClient {
	return &KvClient{adminCore: c.adminCore, namespace: namespace}
}

// D1 returns a D1 client for the given database.
func (c *AdminClient) D1(database string) *D1Client {
	return &D1Client{adminCore: c.adminCore, database: database}
}

// Functions returns a functions client for app function invocations.
func (c *AdminClient) Functions() *FunctionsClient {
	return &FunctionsClient{http: c.http}
}

// Analytics returns an analytics client for metrics and event tracking.
func (c *AdminClient) Analytics() *AnalyticsClient {
	return &AnalyticsClient{core: c.core, adminCore: c.adminCore}
}

// StorageClient is the top-level storage entry point.
type StorageClient struct {
	http *HTTPClient
	core *GeneratedDbApi
}

// Bucket returns a bucket-scoped storage client.
func (s *StorageClient) Bucket(name string) *StorageBucket {
	return &StorageBucket{http: s.http, core: s.core, name: name}
}

// StorageBucket provides bucket-level file operations.
type StorageBucket struct {
	http *HTTPClient
	core *GeneratedDbApi
	name string
}

// FileInfo describes a stored object.
type FileInfo struct {
	Key            string                 `json:"key"`
	Size           int64                  `json:"size"`
	ContentType    string                 `json:"contentType,omitempty"`
	ETag           string                 `json:"etag,omitempty"`
	UploadedAt     string                 `json:"uploadedAt,omitempty"`
	UploadedBy     string                 `json:"uploadedBy,omitempty"`
	CustomMetadata map[string]interface{} `json:"customMetadata,omitempty"`
}

// FileListResult represents a cursor-paginated storage listing.
type FileListResult struct {
	Files     []FileInfo `json:"files"`
	Cursor    string     `json:"cursor,omitempty"`
	Truncated bool       `json:"truncated"`
}

// HasMore reports whether more files are available.
func (r *FileListResult) HasMore() bool {
	if r == nil {
		return false
	}
	return r.Truncated
}

func parseFileInfo(data map[string]interface{}) FileInfo {
	return FileInfo{
		Key:            asStringValue(data["key"]),
		Size:           asInt64Value(data["size"]),
		ContentType:    asStringValue(data["contentType"]),
		ETag:           asStringValue(data["etag"]),
		UploadedAt:     asStringValue(data["uploadedAt"]),
		UploadedBy:     asStringValue(data["uploadedBy"]),
		CustomMetadata: asRecordValue(data["customMetadata"]),
	}
}

// GetURL returns the public URL for a file.
func (b *StorageBucket) GetURL(path string) string {
	return fmt.Sprintf("%s/api/storage/%s/%s", b.http.baseURL, b.name, encodeStorageKeyPath(path))
}

// Upload uploads raw bytes to storage.
func (b *StorageBucket) Upload(
	ctx context.Context,
	path string,
	data []byte,
	contentType string,
) (map[string]interface{}, error) {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	return b.http.PostMultipart(
		ctx,
		fmt.Sprintf("/api/storage/%s/upload", b.name),
		"file",
		path,
		data,
		contentType,
		map[string]string{"key": path},
	)
}

// UploadString uploads string data with optional encoding.
func (b *StorageBucket) UploadString(
	ctx context.Context,
	path string,
	data string,
	encoding string,
	contentType string,
) (map[string]interface{}, error) {
	if contentType == "" {
		contentType = "text/plain"
	}

	var raw []byte
	switch encoding {
	case "base64":
		decoded, err := base64.StdEncoding.DecodeString(data)
		if err != nil {
			return nil, err
		}
		raw = decoded
	case "base64url":
		decoded, err := base64.RawURLEncoding.DecodeString(data)
		if err != nil {
			decoded, err = base64.URLEncoding.DecodeString(data)
			if err != nil {
				return nil, err
			}
		}
		raw = decoded
	case "data_url":
		parts := strings.SplitN(data, ",", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("invalid data_url payload")
		}
		decoded, err := base64.StdEncoding.DecodeString(parts[1])
		if err != nil {
			return nil, err
		}
		raw = decoded
	default:
		raw = []byte(data)
	}
	return b.Upload(ctx, path, raw, contentType)
}

// Download downloads a file as raw bytes.
func (b *StorageBucket) Download(ctx context.Context, path string) ([]byte, error) {
	return b.http.GetRaw(ctx, fmt.Sprintf("/api/storage/%s/%s", b.name, encodeStorageKeyPath(path)))
}

// GetMetadata gets file metadata.
func (b *StorageBucket) GetMetadata(ctx context.Context, path string) (map[string]interface{}, error) {
	return b.http.Get(ctx, fmt.Sprintf("/api/storage/%s/%s/metadata", b.name, encodeStorageKeyPath(path)))
}

// UpdateMetadata updates file metadata.
func (b *StorageBucket) UpdateMetadata(ctx context.Context, path string, metadata map[string]interface{}) (map[string]interface{}, error) {
	return b.http.Patch(ctx, fmt.Sprintf("/api/storage/%s/%s/metadata", b.name, encodeStorageKeyPath(path)), metadata)
}

// Exists checks whether a file exists.
func (b *StorageBucket) Exists(ctx context.Context, path string) (bool, error) {
	return b.http.Head(ctx, fmt.Sprintf("/api/storage/%s/%s", b.name, encodeStorageKeyPath(path)))
}

// List lists files in the bucket.
func (b *StorageBucket) List(ctx context.Context, prefix string, limit, offset int) ([]map[string]interface{}, error) {
	query := map[string]string{
		"limit":  fmt.Sprintf("%d", limit),
		"offset": fmt.Sprintf("%d", offset),
	}
	if prefix != "" {
		query["prefix"] = prefix
	}
	data, err := b.http.GetWithQuery(ctx, fmt.Sprintf("/api/storage/%s", b.name), query)
	if err != nil {
		return nil, err
	}

	items, ok := data["files"].([]interface{})
	if !ok {
		items, _ = data["items"].([]interface{})
	}
	results := make([]map[string]interface{}, 0, len(items))
	for _, item := range items {
		if entry, ok := item.(map[string]interface{}); ok {
			results = append(results, entry)
		}
	}
	return results, nil
}

// ListPage lists files in the bucket with cursor pagination.
func (b *StorageBucket) ListPage(ctx context.Context, prefix string, limit int, cursor string) (*FileListResult, error) {
	query := map[string]string{
		"limit": fmt.Sprintf("%d", limit),
	}
	if prefix != "" {
		query["prefix"] = prefix
	}
	if cursor != "" {
		query["cursor"] = cursor
	}
	data, err := b.http.GetWithQuery(ctx, fmt.Sprintf("/api/storage/%s", b.name), query)
	if err != nil {
		return nil, err
	}
	filesRaw, _ := data["files"].([]interface{})
	if len(filesRaw) == 0 {
		filesRaw, _ = data["items"].([]interface{})
	}
	result := &FileListResult{
		Files:     make([]FileInfo, 0, len(filesRaw)),
		Cursor:    asStringValue(data["cursor"]),
		Truncated: asBoolValue(data["truncated"]),
	}
	for _, item := range filesRaw {
		if entry, ok := item.(map[string]interface{}); ok {
			result.Files = append(result.Files, parseFileInfo(entry))
		}
	}
	return result, nil
}

// Delete deletes a single file.
func (b *StorageBucket) Delete(ctx context.Context, path string) (map[string]interface{}, error) {
	return b.http.Delete(ctx, fmt.Sprintf("/api/storage/%s/%s", b.name, encodeStorageKeyPath(path)))
}

// DeleteMany deletes multiple files.
func (b *StorageBucket) DeleteMany(ctx context.Context, keys []string) (map[string]interface{}, error) {
	return b.core.DeleteBatch(ctx, b.name, map[string]interface{}{"keys": keys})
}

// CreateSignedURL creates a signed download URL.
func (b *StorageBucket) CreateSignedURL(ctx context.Context, path string, expiresIn string) (map[string]interface{}, error) {
	if expiresIn == "" {
		expiresIn = "1h"
	}
	return b.core.CreateSignedDownloadUrl(ctx, b.name, map[string]interface{}{
		"key":       path,
		"expiresIn": expiresIn,
	})
}

// CreateSignedURLs creates signed download URLs for multiple files.
func (b *StorageBucket) CreateSignedURLs(ctx context.Context, paths []string, expiresIn string) (map[string]interface{}, error) {
	if expiresIn == "" {
		expiresIn = "1h"
	}
	return b.core.CreateSignedDownloadUrls(ctx, b.name, map[string]interface{}{
		"keys":      paths,
		"expiresIn": expiresIn,
	})
}

// CreateSignedUploadURL creates a signed upload URL.
func (b *StorageBucket) CreateSignedUploadURL(ctx context.Context, path string, expiresIn int) (map[string]interface{}, error) {
	if expiresIn <= 0 {
		expiresIn = 3600
	}
	return b.core.CreateSignedUploadUrl(ctx, b.name, map[string]interface{}{
		"key":       path,
		"expiresIn": fmt.Sprintf("%ds", expiresIn),
	})
}

// CreateConstrainedSignedUploadURL creates a signed upload URL with an optional size cap.
func (b *StorageBucket) CreateConstrainedSignedUploadURL(ctx context.Context, path, expiresIn, maxFileSize string) (map[string]interface{}, error) {
	if expiresIn == "" {
		expiresIn = "30m"
	}
	body := map[string]interface{}{
		"key":       path,
		"expiresIn": expiresIn,
	}
	if maxFileSize != "" {
		body["maxFileSize"] = maxFileSize
	}
	return b.core.CreateSignedUploadUrl(ctx, b.name, body)
}

// InitiateResumableUpload starts a multipart upload and returns its upload id.
func (b *StorageBucket) InitiateResumableUpload(ctx context.Context, path, contentType string, totalSize int64) (map[string]interface{}, error) {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	body := map[string]interface{}{
		"key":         path,
		"contentType": contentType,
	}
	if totalSize > 0 {
		body["totalSize"] = totalSize
	}
	return b.core.CreateMultipartUpload(ctx, b.name, body)
}

// AbortResumableUpload aborts an in-flight multipart upload.
func (b *StorageBucket) AbortResumableUpload(ctx context.Context, path, uploadID string) (map[string]interface{}, error) {
	return b.core.AbortMultipartUpload(ctx, b.name, map[string]interface{}{
		"key":      path,
		"uploadId": uploadID,
	})
}

// KvClient provides KV namespace operations.
type KvClient struct {
	adminCore *GeneratedAdminApi
	namespace string
}

// Get fetches a value by key.
func (k *KvClient) Get(ctx context.Context, key string) (string, error) {
	data, err := k.adminCore.KvOperation(ctx, k.namespace, map[string]interface{}{
		"action": "get",
		"key":    key,
	})
	if err != nil {
		return "", err
	}
	if value, ok := data["value"].(string); ok {
		return value, nil
	}
	return "", nil
}

// Set stores a value with optional TTL.
func (k *KvClient) Set(ctx context.Context, key, value string, ttl int) error {
	body := map[string]interface{}{
		"action": "set",
		"key":    key,
		"value":  value,
	}
	if ttl > 0 {
		body["ttl"] = ttl
	}
	_, err := k.adminCore.KvOperation(ctx, k.namespace, body)
	return err
}

// List lists keys for the namespace.
func (k *KvClient) List(ctx context.Context, prefix string, limit int, cursor string) (map[string]interface{}, error) {
	body := map[string]interface{}{"action": "list"}
	if prefix != "" {
		body["prefix"] = prefix
	}
	if limit > 0 {
		body["limit"] = limit
	}
	if cursor != "" {
		body["cursor"] = cursor
	}
	return k.adminCore.KvOperation(ctx, k.namespace, body)
}

// Delete removes a key.
func (k *KvClient) Delete(ctx context.Context, key string) error {
	_, err := k.adminCore.KvOperation(ctx, k.namespace, map[string]interface{}{
		"action": "delete",
		"key":    key,
	})
	return err
}

// D1Client provides D1 database operations.
type D1Client struct {
	adminCore *GeneratedAdminApi
	database  string
}

// Exec executes a D1 query.
func (d *D1Client) Exec(ctx context.Context, query string, params []interface{}) ([]interface{}, error) {
	if params == nil {
		params = []interface{}{}
	}
	body := map[string]interface{}{"query": query}
	body["params"] = params
	data, err := d.adminCore.ExecuteD1Query(ctx, d.database, body)
	if err != nil {
		return nil, err
	}
	if results, ok := data["results"].([]interface{}); ok {
		return results, nil
	}
	return []interface{}{}, nil
}

// Query is an alias for Exec.
func (d *D1Client) Query(ctx context.Context, query string, params []interface{}) ([]interface{}, error) {
	return d.Exec(ctx, query, params)
}

// FunctionsClient provides app function invocations.
type FunctionsClient struct {
	http *HTTPClient
}

// Call invokes a function route with the chosen HTTP method.
func (f *FunctionsClient) Call(
	ctx context.Context,
	path string,
	method string,
	body interface{},
	query map[string]string,
) (map[string]interface{}, error) {
	normalizedPath := "/api/functions/" + strings.TrimLeft(path, "/")
	switch strings.ToUpper(method) {
	case "GET":
		return f.http.GetWithQuery(ctx, normalizedPath, query)
	case "PUT":
		return f.http.Put(ctx, normalizedPath, body)
	case "PATCH":
		return f.http.Patch(ctx, normalizedPath, body)
	case "DELETE":
		return f.http.Delete(ctx, normalizedPath)
	default:
		return f.http.Post(ctx, normalizedPath, body)
	}
}

// Get invokes a function with GET.
func (f *FunctionsClient) Get(ctx context.Context, path string, query map[string]string) (map[string]interface{}, error) {
	return f.Call(ctx, path, "GET", nil, query)
}

// Post invokes a function with POST.
func (f *FunctionsClient) Post(ctx context.Context, path string, body interface{}) (map[string]interface{}, error) {
	return f.Call(ctx, path, "POST", body, nil)
}

// Put invokes a function with PUT.
func (f *FunctionsClient) Put(ctx context.Context, path string, body interface{}) (map[string]interface{}, error) {
	return f.Call(ctx, path, "PUT", body, nil)
}

// Patch invokes a function with PATCH.
func (f *FunctionsClient) Patch(ctx context.Context, path string, body interface{}) (map[string]interface{}, error) {
	return f.Call(ctx, path, "PATCH", body, nil)
}

// Delete invokes a function with DELETE.
func (f *FunctionsClient) Delete(ctx context.Context, path string) (map[string]interface{}, error) {
	return f.Call(ctx, path, "DELETE", nil, nil)
}

// AnalyticsEvent describes a single custom analytics event.
type AnalyticsEvent struct {
	Name       string                 `json:"name"`
	Properties map[string]interface{} `json:"properties,omitempty"`
	Timestamp  *int64                 `json:"timestamp,omitempty"`
	UserID     string                 `json:"userId,omitempty"`
}

// AnalyticsClient provides analytics queries and event tracking.
type AnalyticsClient struct {
	core      *GeneratedDbApi
	adminCore *GeneratedAdminApi
}

// Overview queries the analytics overview.
func (a *AnalyticsClient) Overview(ctx context.Context, options map[string]string) (map[string]interface{}, error) {
	return a.adminCore.QueryAnalytics(ctx, buildAnalyticsQuery("overview", options))
}

// TimeSeries queries time-series analytics data.
func (a *AnalyticsClient) TimeSeries(ctx context.Context, options map[string]string) ([]map[string]interface{}, error) {
	data, err := a.adminCore.QueryAnalytics(ctx, buildAnalyticsQuery("timeSeries", options))
	if err != nil {
		return nil, err
	}
	return extractAnalyticsMapList(data, "timeSeries"), nil
}

// Breakdown queries analytics breakdown data.
func (a *AnalyticsClient) Breakdown(ctx context.Context, options map[string]string) ([]map[string]interface{}, error) {
	data, err := a.adminCore.QueryAnalytics(ctx, buildAnalyticsQuery("breakdown", options))
	if err != nil {
		return nil, err
	}
	return extractAnalyticsMapList(data, "breakdown"), nil
}

// TopEndpoints queries the most active endpoints.
func (a *AnalyticsClient) TopEndpoints(ctx context.Context, options map[string]string) ([]map[string]interface{}, error) {
	data, err := a.adminCore.QueryAnalytics(ctx, buildAnalyticsQuery("topEndpoints", options))
	if err != nil {
		return nil, err
	}
	return extractAnalyticsMapList(data, "topItems"), nil
}

// Track records a single custom event.
func (a *AnalyticsClient) Track(ctx context.Context, name string, properties map[string]interface{}, userID string) error {
	event := AnalyticsEvent{
		Name:       name,
		Properties: properties,
		UserID:     userID,
	}
	return a.TrackBatch(ctx, []AnalyticsEvent{event})
}

// TrackBatch records multiple custom events.
func (a *AnalyticsClient) TrackBatch(ctx context.Context, events []AnalyticsEvent) error {
	if len(events) == 0 {
		return nil
	}

	payloadEvents := make([]map[string]interface{}, 0, len(events))
	for _, event := range events {
		entry := map[string]interface{}{
			"name":      event.Name,
			"timestamp": analyticsTimestamp(event.Timestamp),
		}
		if len(event.Properties) > 0 {
			entry["properties"] = event.Properties
		}
		if event.UserID != "" {
			entry["userId"] = event.UserID
		}
		payloadEvents = append(payloadEvents, entry)
	}

	_, err := a.core.TrackEvents(ctx, map[string]interface{}{"events": payloadEvents})
	return err
}

// QueryEvents queries custom analytics events.
func (a *AnalyticsClient) QueryEvents(ctx context.Context, options map[string]string) (map[string]interface{}, error) {
	if options == nil {
		options = map[string]string{}
	}
	return a.adminCore.QueryCustomEvents(ctx, options)
}

func buildAnalyticsQuery(metric string, options map[string]string) map[string]string {
	query := map[string]string{"metric": metric}
	for key, value := range options {
		query[key] = value
	}
	return query
}

func extractAnalyticsMapList(data map[string]interface{}, key string) []map[string]interface{} {
	items, ok := data[key].([]interface{})
	if !ok {
		return []map[string]interface{}{}
	}
	result := make([]map[string]interface{}, 0, len(items))
	for _, item := range items {
		if entry, ok := item.(map[string]interface{}); ok {
			result = append(result, entry)
		}
	}
	return result
}

func analyticsTimestamp(value *int64) int64 {
	if value != nil {
		return *value
	}
	return time.Now().UnixMilli()
}

// ─── PushClient ───────────────────────────────────────────────────────────────

func toString(value interface{}) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	case nil:
		return ""
	default:
		return fmt.Sprintf("%v", typed)
	}
}

func toInt(value interface{}) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case float32:
		return int(typed)
	case json.Number:
		i, _ := typed.Int64()
		return int(i)
	case string:
		var parsed int
		_, _ = fmt.Sscanf(typed, "%d", &parsed)
		return parsed
	default:
		return 0
	}
}

func defaultString(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

// PushClient provides push notification operations for Admin SDK.
// Delegates all HTTP calls to GeneratedAdminApi methods.
type PushClient struct {
	adminCore *GeneratedAdminApi
}

// Send sends a push notification to a single user's devices.
func (p *PushClient) Send(ctx context.Context, userID string, payload map[string]interface{}) (map[string]interface{}, error) {
	return p.adminCore.PushSend(ctx, map[string]interface{}{
		"userId":  userID,
		"payload": payload,
	})
}

// SendMany sends a push notification to multiple users (no limit — server chunks internally).
func (p *PushClient) SendMany(ctx context.Context, userIDs []string, payload map[string]interface{}) (map[string]interface{}, error) {
	return p.adminCore.PushSendMany(ctx, map[string]interface{}{
		"userIds": userIDs,
		"payload": payload,
	})
}

// SendToToken sends a push notification to a specific device token.
func (p *PushClient) SendToToken(ctx context.Context, token string, payload map[string]interface{}, platform string) (map[string]interface{}, error) {
	if platform == "" {
		platform = "web"
	}
	return p.adminCore.PushSendToToken(ctx, map[string]interface{}{
		"token":    token,
		"payload":  payload,
		"platform": platform,
	})
}

// SendToTopic sends a push notification to an FCM topic.
func (p *PushClient) SendToTopic(ctx context.Context, topic string, payload map[string]interface{}) (map[string]interface{}, error) {
	return p.adminCore.PushSendToTopic(ctx, map[string]interface{}{
		"topic":   topic,
		"payload": payload,
	})
}

// Broadcast sends a push notification to all devices via /topics/all.
func (p *PushClient) BroadcastPush(ctx context.Context, payload map[string]interface{}) (map[string]interface{}, error) {
	return p.adminCore.PushBroadcast(ctx, map[string]interface{}{
		"payload": payload,
	})
}

// GetTokens gets registered device tokens for a user — token values NOT exposed.
func (p *PushClient) GetTokens(ctx context.Context, userID string) (map[string]interface{}, error) {
	query := map[string]string{"userId": userID}
	return p.adminCore.GetPushTokens(ctx, query)
}

// GetLogs gets push send logs for a user (last 24 hours).
func (p *PushClient) GetLogs(ctx context.Context, userID string, limit int) (map[string]interface{}, error) {
	query := map[string]string{"userId": userID}
	if limit > 0 {
		query["limit"] = fmt.Sprintf("%d", limit)
	}
	return p.adminCore.GetPushLogs(ctx, query)
}

// Vector returns a VectorizeClient for the given index.
func (c *AdminClient) Vector(index string) *VectorizeClient {
	return &VectorizeClient{adminCore: c.adminCore, index: index}
}

// ─── VectorizeClient ──────────────────────────────────────────────────────────

// VectorizeClient provides access to a Cloudflare Vectorize index.
// Delegates all HTTP calls to GeneratedAdminApi.VectorizeOperation.
// Note: Vectorize is Edge-only. In local/Docker, the server returns stub responses.
type VectorizeClient struct {
	adminCore *GeneratedAdminApi
	index     string
}

// VectorSearchOptions holds optional parameters for Search and QueryByID.
type VectorSearchOptions struct {
	TopK           int                    `json:"topK,omitempty"`
	Filter         map[string]interface{} `json:"filter,omitempty"`
	Namespace      string                 `json:"namespace,omitempty"`
	ReturnValues   *bool                  `json:"returnValues,omitempty"`
	ReturnMetadata interface{}            `json:"returnMetadata,omitempty"` // string ("all"|"indexed"|"none") or bool
}

func (vc *VectorizeClient) apiPath() string {
	return PathVectorizeOperation(vc.index)
}

// Upsert inserts or updates vectors. Returns mutation result with ok, count, mutationId.
func (vc *VectorizeClient) Upsert(ctx context.Context, vectors []map[string]interface{}) (map[string]interface{}, error) {
	return vc.adminCore.VectorizeOperation(ctx, vc.index, map[string]interface{}{
		"action":  "upsert",
		"vectors": vectors,
	})
}

// Insert inserts vectors; errors on duplicate ID (server returns 409).
func (vc *VectorizeClient) Insert(ctx context.Context, vectors []map[string]interface{}) (map[string]interface{}, error) {
	return vc.adminCore.VectorizeOperation(ctx, vc.index, map[string]interface{}{
		"action":  "insert",
		"vectors": vectors,
	})
}

// Search finds nearest neighbors for the given vector.
func (vc *VectorizeClient) Search(ctx context.Context, vector []float64, opts *VectorSearchOptions) ([]map[string]interface{}, error) {
	body := map[string]interface{}{
		"action": "search",
		"vector": vector,
	}
	if opts != nil {
		if opts.TopK > 0 {
			body["topK"] = opts.TopK
		}
		if opts.Filter != nil {
			body["filter"] = opts.Filter
		}
		if opts.Namespace != "" {
			body["namespace"] = opts.Namespace
		}
		if opts.ReturnValues != nil {
			body["returnValues"] = *opts.ReturnValues
		}
		if opts.ReturnMetadata != nil {
			body["returnMetadata"] = opts.ReturnMetadata
		}
	}
	data, err := vc.adminCore.VectorizeOperation(ctx, vc.index, body)
	if err != nil {
		return nil, err
	}
	return extractMapList(data, "matches"), nil
}

// QueryByID searches using an existing vector's ID (Vectorize v2 only).
func (vc *VectorizeClient) QueryByID(ctx context.Context, vectorID string, opts *VectorSearchOptions) ([]map[string]interface{}, error) {
	body := map[string]interface{}{
		"action":   "queryById",
		"vectorId": vectorID,
	}
	if opts != nil {
		if opts.TopK > 0 {
			body["topK"] = opts.TopK
		}
		if opts.Filter != nil {
			body["filter"] = opts.Filter
		}
		if opts.Namespace != "" {
			body["namespace"] = opts.Namespace
		}
		if opts.ReturnValues != nil {
			body["returnValues"] = *opts.ReturnValues
		}
		if opts.ReturnMetadata != nil {
			body["returnMetadata"] = opts.ReturnMetadata
		}
	}
	data, err := vc.adminCore.VectorizeOperation(ctx, vc.index, body)
	if err != nil {
		return nil, err
	}
	return extractMapList(data, "matches"), nil
}

// GetByIDs retrieves vectors by their IDs.
func (vc *VectorizeClient) GetByIDs(ctx context.Context, ids []string) ([]map[string]interface{}, error) {
	data, err := vc.adminCore.VectorizeOperation(ctx, vc.index, map[string]interface{}{
		"action": "getByIds",
		"ids":    ids,
	})
	if err != nil {
		return nil, err
	}
	return extractMapList(data, "vectors"), nil
}

// Delete removes vectors by IDs. Returns mutation result with ok, count, mutationId.
func (vc *VectorizeClient) Delete(ctx context.Context, ids []string) (map[string]interface{}, error) {
	return vc.adminCore.VectorizeOperation(ctx, vc.index, map[string]interface{}{
		"action": "delete",
		"ids":    ids,
	})
}

// Describe returns index info: vectorCount, dimensions, metric, processedUpToDatetime, processedUpToMutation.
func (vc *VectorizeClient) Describe(ctx context.Context) (map[string]interface{}, error) {
	return vc.adminCore.VectorizeOperation(ctx, vc.index, map[string]interface{}{
		"action": "describe",
	})
}

func extractMapList(data map[string]interface{}, key string) []map[string]interface{} {
	items, ok := data[key].([]interface{})
	if !ok {
		return nil
	}
	result := make([]map[string]interface{}, 0, len(items))
	for _, item := range items {
		if m, ok := item.(map[string]interface{}); ok {
			result = append(result, m)
		}
	}
	return result
}

// ─── FieldOps ─────────────────────────────────────────────────────────────────

// Increment creates an increment field operation.
func Increment(n float64) map[string]interface{} {
	return map[string]interface{}{"$op": "increment", "value": n}
}

// DeleteField creates a deleteField operation.
func DeleteField() map[string]interface{} {
	return map[string]interface{}{"$op": "deleteField"}
}
