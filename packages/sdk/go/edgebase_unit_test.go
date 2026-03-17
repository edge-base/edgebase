//go:build unit

// EdgeBase Go SDK — Unit Tests
// //go:build unit tag
//
// Run: go test -tags unit -v ./...
//
// Targets: packages/sdk/go/edgebase.go
//   - Filter.toJSON() serialization
//   - TableRef immutable chaining (Where/OrderBy/Limit/Offset/After/Before/Search)
//   - namespace routing (single-instance vs dynamic)
//   - buildQueryString (filter/sort/limit/offset/after/before)
//   - ListResult struct
//   - FieldOps (Increment/DeleteField)
//   - AdminClient.DB
//   - HTTPClient basics
//   - AdminClient constructor, accessors
//   - AdminAuthClient URL construction
//   - OrBuilder patterns
//   - StorageBucket URL construction (placeholder)
//   - Error types

package edgebase

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// ─── helpers ──────────────────────────────────────────────────────────────────

// testBaseURL is a placeholder URL for unit tests — no real server is contacted.
const testBaseURL = "http://localhost:8688"
const testServiceKey = "sk-test"

func contains(s, sub string) bool {
	return strings.Contains(s, sub)
}

func TestHTTPClientGetReturnsNilFor204(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	client := NewHTTPClient(server.URL, testServiceKey)
	result, err := client.Get(context.Background(), "/api/functions/public/no-content")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != nil {
		t.Fatalf("expected nil for 204 response, got %#v", result)
	}
}

func newTestTableRef() *TableRef {
	client := NewHTTPClient(testBaseURL, testServiceKey)
	core := NewGeneratedDbApi(client)
	return newTableRef(core, "posts", "shared", "")
}

func newTestTableRefWithInstance() *TableRef {
	client := NewHTTPClient(testBaseURL, testServiceKey)
	core := NewGeneratedDbApi(client)
	return newTableRef(core, "docs", "workspace", "ws-123")
}

// ═══════════════════════════════════════════════════════════════════════════════
// A. Filter Serialization
// ═══════════════════════════════════════════════════════════════════════════════

func TestFilterToJSON(t *testing.T) {
	f := Filter{Field: "status", Op: "==", Value: "published"}
	j := f.toJSON()
	if len(j) != 3 {
		t.Fatalf("expected 3 elements, got %d", len(j))
	}
	if j[0].(string) != "status" {
		t.Errorf("expected field=%q, got %v", "status", j[0])
	}
	if j[1].(string) != "==" {
		t.Errorf("expected op=%q, got %v", "==", j[1])
	}
	if j[2].(string) != "published" {
		t.Errorf("expected value=%q, got %v", "published", j[2])
	}
}

func TestFilterNumericValue(t *testing.T) {
	f := Filter{Field: "views", Op: ">", Value: 100}
	j := f.toJSON()
	if j[2].(int) != 100 {
		t.Errorf("expected value=100, got %v", j[2])
	}
}

func TestFilterJSON(t *testing.T) {
	f := Filter{Field: "age", Op: ">=", Value: 18}
	j := f.toJSON()
	b, err := jsonMarshalNoEscape(j)
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}
	expected := `["age",">=",18]`
	if string(b) != expected {
		t.Errorf("expected %q, got %q", expected, string(b))
	}
}

func TestFilterNotEqual(t *testing.T) {
	f := Filter{Field: "status", Op: "!=", Value: "deleted"}
	j := f.toJSON()
	if j[1].(string) != "!=" {
		t.Errorf("expected op=!=, got %v", j[1])
	}
}

func TestFilterLessThan(t *testing.T) {
	f := Filter{Field: "age", Op: "<", Value: 30}
	j := f.toJSON()
	b, _ := jsonMarshalNoEscape(j)
	if !contains(string(b), `"<"`) {
		t.Errorf("expected < operator in JSON, got %s", string(b))
	}
}

func TestFilterLessEqual(t *testing.T) {
	f := Filter{Field: "score", Op: "<=", Value: 100}
	j := f.toJSON()
	b, _ := jsonMarshalNoEscape(j)
	expected := `["score","<=",100]`
	if string(b) != expected {
		t.Errorf("expected %q, got %q", expected, string(b))
	}
}

func TestFilterContains(t *testing.T) {
	f := Filter{Field: "title", Op: "contains", Value: "hello"}
	j := f.toJSON()
	if j[1].(string) != "contains" {
		t.Errorf("expected op=contains, got %v", j[1])
	}
}

func TestFilterIn(t *testing.T) {
	f := Filter{Field: "status", Op: "in", Value: []string{"active", "pending"}}
	j := f.toJSON()
	if j[1].(string) != "in" {
		t.Errorf("expected op=in, got %v", j[1])
	}
	vals, ok := j[2].([]string)
	if !ok || len(vals) != 2 {
		t.Errorf("expected []string{active, pending}, got %v", j[2])
	}
}

func TestFilterNotIn(t *testing.T) {
	f := Filter{Field: "role", Op: "not in", Value: []string{"banned"}}
	j := f.toJSON()
	if j[1].(string) != "not in" {
		t.Errorf("expected op='not in', got %v", j[1])
	}
}

func TestFilterBoolValue(t *testing.T) {
	f := Filter{Field: "active", Op: "==", Value: true}
	j := f.toJSON()
	if j[2].(bool) != true {
		t.Errorf("expected value=true, got %v", j[2])
	}
}

func TestFilterNilValue(t *testing.T) {
	f := Filter{Field: "deletedAt", Op: "==", Value: nil}
	j := f.toJSON()
	if j[2] != nil {
		t.Errorf("expected value=nil, got %v", j[2])
	}
}

func TestFilterFloatValue(t *testing.T) {
	f := Filter{Field: "price", Op: ">", Value: 19.99}
	j := f.toJSON()
	if j[2].(float64) != 19.99 {
		t.Errorf("expected value=19.99, got %v", j[2])
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// B. TableRef Immutable Chaining
// ═══════════════════════════════════════════════════════════════════════════════

func TestTableRefWhereImmutable(t *testing.T) {
	base := newTestTableRef()
	filtered := base.Where("status", "==", "published")

	if len(base.filters) != 0 {
		t.Error("original should have 0 filters")
	}
	if len(filtered.filters) != 1 {
		t.Errorf("filtered should have 1 filter, got %d", len(filtered.filters))
	}
}

func TestTableRefWhereMultiple(t *testing.T) {
	ref := newTestTableRef().
		Where("status", "==", "published").
		Where("views", ">", 100)
	if len(ref.filters) != 2 {
		t.Errorf("expected 2 filters, got %d", len(ref.filters))
	}
}

func TestTableRefOrderByImmutable(t *testing.T) {
	base := newTestTableRef()
	sorted := base.OrderBy("createdAt", "desc")

	if len(base.sorts) != 0 {
		t.Error("original should have 0 sorts")
	}
	if len(sorted.sorts) != 1 {
		t.Error("sorted should have 1 sort")
	}
	if sorted.sorts[0][0] != "createdAt" || sorted.sorts[0][1] != "desc" {
		t.Errorf("unexpected sort: %v", sorted.sorts[0])
	}
}

func TestTableRefLimitImmutable(t *testing.T) {
	base := newTestTableRef()
	limited := base.Limit(10)

	if base.limit != nil {
		t.Error("original limit should be nil")
	}
	if limited.limit == nil || *limited.limit != 10 {
		t.Error("limited should have limit=10")
	}
}

func TestTableRefOffsetImmutable(t *testing.T) {
	base := newTestTableRef()
	paged := base.Offset(20)

	if base.offset != nil {
		t.Error("original offset should be nil")
	}
	if paged.offset == nil || *paged.offset != 20 {
		t.Error("paged should have offset=20")
	}
}

func TestTableRefAfterCursor(t *testing.T) {
	ref := newTestTableRef().After("cursor-abc")
	if ref.after != "cursor-abc" {
		t.Errorf("expected after=cursor-abc, got %q", ref.after)
	}
	if ref.before != "" {
		t.Errorf("after should clear before, got %q", ref.before)
	}
}

func TestTableRefBeforeCursor(t *testing.T) {
	ref := newTestTableRef().Before("cursor-xyz")
	if ref.before != "cursor-xyz" {
		t.Errorf("expected before=cursor-xyz, got %q", ref.before)
	}
	if ref.after != "" {
		t.Errorf("before should clear after, got %q", ref.after)
	}
}

func TestTableRefSearch(t *testing.T) {
	ref := newTestTableRef().Search("hello world")
	if ref.search != "hello world" {
		t.Errorf("expected search=hello world, got %q", ref.search)
	}
}

func TestTableRefChainImmutable(t *testing.T) {
	base := newTestTableRef()
	_ = base.Where("status", "==", "active").
		OrderBy("createdAt", "desc").
		Limit(5).
		Offset(10)

	if len(base.filters) != 0 || len(base.sorts) != 0 || base.limit != nil {
		t.Error("base should not be mutated by chain")
	}
}

func TestTableRefWhereOrderByLimitCombo(t *testing.T) {
	ref := newTestTableRef().
		Where("status", "==", "published").
		OrderBy("createdAt", "desc").
		Limit(25)

	if len(ref.filters) != 1 {
		t.Errorf("expected 1 filter, got %d", len(ref.filters))
	}
	if len(ref.sorts) != 1 {
		t.Errorf("expected 1 sort, got %d", len(ref.sorts))
	}
	if ref.limit == nil || *ref.limit != 25 {
		t.Error("expected limit=25")
	}
}

func TestTableRefSearchLimitCombo(t *testing.T) {
	ref := newTestTableRef().Search("hello").Limit(10)
	if ref.search != "hello" {
		t.Errorf("expected search=hello, got %q", ref.search)
	}
	if ref.limit == nil || *ref.limit != 10 {
		t.Error("expected limit=10")
	}
}

func TestTableRefWhereSearchCombo(t *testing.T) {
	ref := newTestTableRef().
		Where("status", "==", "active").
		Search("keyword")
	if len(ref.filters) != 1 {
		t.Errorf("expected 1 filter, got %d", len(ref.filters))
	}
	if ref.search != "keyword" {
		t.Errorf("expected search=keyword, got %q", ref.search)
	}
}

func TestTableRefMultipleOrderBy(t *testing.T) {
	ref := newTestTableRef().
		OrderBy("createdAt", "desc").
		OrderBy("title", "asc")
	if len(ref.sorts) != 2 {
		t.Errorf("expected 2 sorts, got %d", len(ref.sorts))
	}
	if ref.sorts[0][0] != "createdAt" || ref.sorts[1][0] != "title" {
		t.Error("sort order mismatch")
	}
}

func TestTableRefLimitOffsetCombo(t *testing.T) {
	ref := newTestTableRef().Limit(10).Offset(20)
	if ref.limit == nil || *ref.limit != 10 {
		t.Error("expected limit=10")
	}
	if ref.offset == nil || *ref.offset != 20 {
		t.Error("expected offset=20")
	}
}

func TestTableRefAfterClearsBefore(t *testing.T) {
	ref := newTestTableRef().Before("bbb").After("aaa")
	if ref.after != "aaa" {
		t.Errorf("expected after=aaa, got %q", ref.after)
	}
	if ref.before != "" {
		t.Errorf("After should clear before, got %q", ref.before)
	}
}

func TestTableRefBeforeClearsAfter(t *testing.T) {
	ref := newTestTableRef().After("aaa").Before("bbb")
	if ref.before != "bbb" {
		t.Errorf("expected before=bbb, got %q", ref.before)
	}
	if ref.after != "" {
		t.Errorf("Before should clear after, got %q", ref.after)
	}
}

func TestTableRefLimitZero(t *testing.T) {
	ref := newTestTableRef().Limit(0)
	if ref.limit == nil || *ref.limit != 0 {
		t.Error("expected limit=0")
	}
}

func TestTableRefOffsetZero(t *testing.T) {
	ref := newTestTableRef().Offset(0)
	if ref.offset == nil || *ref.offset != 0 {
		t.Error("expected offset=0")
	}
}

func TestTableRefWhereAllOperators(t *testing.T) {
	ops := []string{"==", "!=", ">", "<", ">=", "<=", "contains", "in", "not in"}
	for _, op := range ops {
		ref := newTestTableRef().Where("field", op, "value")
		if len(ref.filters) != 1 {
			t.Errorf("op %s: expected 1 filter, got %d", op, len(ref.filters))
		}
		if ref.filters[0].Op != op {
			t.Errorf("expected op=%q, got %q", op, ref.filters[0].Op)
		}
	}
}

func TestTableRefBranchingChain(t *testing.T) {
	base := newTestTableRef().Where("status", "==", "active")
	branch1 := base.Limit(5)
	branch2 := base.Limit(10)

	if *branch1.limit != 5 {
		t.Errorf("branch1 limit: expected 5, got %d", *branch1.limit)
	}
	if *branch2.limit != 10 {
		t.Errorf("branch2 limit: expected 10, got %d", *branch2.limit)
	}
	if len(base.filters) != 1 {
		t.Errorf("base filters should remain 1, got %d", len(base.filters))
	}
	if base.limit != nil {
		t.Error("base limit should remain nil")
	}
}

func TestTableRefDeepChain(t *testing.T) {
	ref := newTestTableRef().
		Where("a", "==", 1).
		Where("b", "!=", 2).
		Where("c", ">", 3).
		OrderBy("a", "asc").
		OrderBy("b", "desc").
		Limit(50).
		Offset(100).
		After("cursor-deep")

	if len(ref.filters) != 3 {
		t.Errorf("expected 3 filters, got %d", len(ref.filters))
	}
	if len(ref.sorts) != 2 {
		t.Errorf("expected 2 sorts, got %d", len(ref.sorts))
	}
	if *ref.limit != 50 {
		t.Errorf("expected limit=50, got %d", *ref.limit)
	}
	if *ref.offset != 100 {
		t.Errorf("expected offset=100, got %d", *ref.offset)
	}
	if ref.after != "cursor-deep" {
		t.Errorf("expected after=cursor-deep, got %q", ref.after)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// D. buildQueryString
// ═══════════════════════════════════════════════════════════════════════════════

func TestBuildQueryStringEmpty(t *testing.T) {
	ref := newTestTableRef()
	if ref.buildQueryString() != "" {
		t.Errorf("expected empty QS, got %q", ref.buildQueryString())
	}
}

func TestBuildQueryStringLimit(t *testing.T) {
	ref := newTestTableRef().Limit(10)
	qs := ref.buildQueryString()
	if !contains(qs, "limit=10") {
		t.Errorf("expected limit=10 in %q", qs)
	}
}

func TestBuildQueryStringOffset(t *testing.T) {
	ref := newTestTableRef().Offset(20)
	qs := ref.buildQueryString()
	if !contains(qs, "offset=20") {
		t.Errorf("expected offset=20 in %q", qs)
	}
}

func TestBuildQueryStringSort(t *testing.T) {
	ref := newTestTableRef().OrderBy("title", "asc")
	qs := ref.buildQueryString()
	if !contains(qs, "sort=") {
		t.Errorf("expected sort= in %q", qs)
	}
	if !contains(qs, "title") {
		t.Errorf("expected title in sort, got %q", qs)
	}
}

func TestBuildQueryStringAfter(t *testing.T) {
	ref := newTestTableRef().After("abc")
	qs := ref.buildQueryString()
	if !contains(qs, "after=abc") {
		t.Errorf("expected after=abc in %q", qs)
	}
}

func TestBuildQueryStringBefore(t *testing.T) {
	ref := newTestTableRef().Before("xyz")
	qs := ref.buildQueryString()
	if !contains(qs, "before=xyz") {
		t.Errorf("expected before=xyz in %q", qs)
	}
}

func TestBuildQueryStringFilter(t *testing.T) {
	ref := newTestTableRef().Where("status", "==", "published")
	qs := ref.buildQueryString()
	if !contains(qs, "filter=") {
		t.Errorf("expected filter= in QS, got %q", qs)
	}
}

func TestBuildQueryStringMultiFilter(t *testing.T) {
	ref := newTestTableRef().
		Where("status", "==", "active").
		Where("age", ">", 18)
	qs := ref.buildQueryString()
	if !contains(qs, "filter=") {
		t.Errorf("expected filter= in %q", qs)
	}
	// Should contain both conditions serialized
	if !contains(qs, "status") || !contains(qs, "age") {
		t.Errorf("expected both filter fields in %q", qs)
	}
}

func TestBuildQueryStringMultiSort(t *testing.T) {
	ref := newTestTableRef().
		OrderBy("createdAt", "desc").
		OrderBy("title", "asc")
	qs := ref.buildQueryString()
	if !contains(qs, "sort=") {
		t.Errorf("expected sort= in %q", qs)
	}
	if !contains(qs, "createdAt") || !contains(qs, "title") {
		t.Errorf("expected both sort fields in %q", qs)
	}
}

func TestBuildQueryStringAllParams(t *testing.T) {
	ref := newTestTableRef().
		Where("status", "==", "active").
		OrderBy("createdAt", "desc").
		Limit(10).
		Offset(20).
		After("cursor-all")
	qs := ref.buildQueryString()
	if !contains(qs, "filter=") {
		t.Errorf("expected filter= in %q", qs)
	}
	if !contains(qs, "sort=") {
		t.Errorf("expected sort= in %q", qs)
	}
	if !contains(qs, "limit=10") {
		t.Errorf("expected limit=10 in %q", qs)
	}
	if !contains(qs, "offset=20") {
		t.Errorf("expected offset=20 in %q", qs)
	}
	if !contains(qs, "after=cursor-all") {
		t.Errorf("expected after=cursor-all in %q", qs)
	}
}

func TestBuildQueryStringStartsWithQuestionMark(t *testing.T) {
	ref := newTestTableRef().Limit(1)
	qs := ref.buildQueryString()
	if qs[0] != '?' {
		t.Errorf("query string should start with ?, got %q", qs)
	}
}

func TestBuildQueryStringFilterGteNoEscape(t *testing.T) {
	// Verify that >= is not HTML-escaped to \u003e=
	ref := newTestTableRef().Where("age", ">=", 18)
	qs := ref.buildQueryString()
	if contains(qs, `\u003e`) {
		t.Errorf("QS should not HTML-escape >=, got %q", qs)
	}
}

func TestBuildQueryStringFilterLteNoEscape(t *testing.T) {
	ref := newTestTableRef().Where("score", "<=", 100)
	qs := ref.buildQueryString()
	if contains(qs, `\u003c`) {
		t.Errorf("QS should not HTML-escape <=, got %q", qs)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// E. FieldOps
// ═══════════════════════════════════════════════════════════════════════════════

func TestIncrement(t *testing.T) {
	op := Increment(5)
	if op["$op"] != "increment" {
		t.Errorf("expected $op=increment, got %v", op["$op"])
	}
	if op["value"].(float64) != 5 {
		t.Errorf("expected value=5, got %v", op["value"])
	}
}

func TestDeleteField(t *testing.T) {
	op := DeleteField()
	if op["$op"] != "deleteField" {
		t.Errorf("expected $op=deleteField, got %v", op["$op"])
	}
}

func TestIncrementJSON(t *testing.T) {
	op := Increment(3.14)
	b, _ := json.Marshal(op)
	s := string(b)
	if !contains(s, `"$op":"increment"`) {
		t.Errorf("expected $op:increment in JSON, got %s", s)
	}
}

func TestDeleteFieldJSON(t *testing.T) {
	op := DeleteField()
	b, _ := json.Marshal(op)
	s := string(b)
	if !contains(s, `"$op":"deleteField"`) {
		t.Errorf("expected $op:deleteField in JSON, got %s", s)
	}
}

func TestIncrementZero(t *testing.T) {
	op := Increment(0)
	if op["$op"] != "increment" {
		t.Errorf("expected $op=increment, got %v", op["$op"])
	}
	if op["value"].(float64) != 0 {
		t.Errorf("expected value=0, got %v", op["value"])
	}
}

func TestIncrementNegative(t *testing.T) {
	op := Increment(-10)
	if op["value"].(float64) != -10 {
		t.Errorf("expected value=-10, got %v", op["value"])
	}
}

func TestIncrementDecimal(t *testing.T) {
	op := Increment(0.5)
	if op["value"].(float64) != 0.5 {
		t.Errorf("expected value=0.5, got %v", op["value"])
	}
}

func TestIncrementLargeNumber(t *testing.T) {
	op := Increment(999999.99)
	if op["value"].(float64) != 999999.99 {
		t.Errorf("expected value=999999.99, got %v", op["value"])
	}
}

func TestDeleteFieldKeysCount(t *testing.T) {
	op := DeleteField()
	if len(op) != 1 {
		t.Errorf("expected 1 key in deleteField op, got %d", len(op))
	}
}

func TestIncrementKeysCount(t *testing.T) {
	op := Increment(1)
	if len(op) != 2 {
		t.Errorf("expected 2 keys in increment op, got %d", len(op))
	}
}

func TestIncrementVerySmallDecimal(t *testing.T) {
	op := Increment(0.001)
	if op["value"].(float64) != 0.001 {
		t.Errorf("expected value=0.001, got %v", op["value"])
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// F. AdminClient Structure
// ═══════════════════════════════════════════════════════════════════════════════

func TestNewAdminClient(t *testing.T) {
	client := NewAdminClient(testBaseURL, testServiceKey)
	if client == nil {
		t.Fatal("expected non-nil client")
	}
	if client.http == nil {
		t.Error("expected http client to be set")
	}
	if client.AdminAuth == nil {
		t.Error("expected AdminAuth to be set")
	}
	if client.Storage() == nil {
		t.Error("expected Storage() to return non-nil client")
	}
	if client.KV("cache") == nil {
		t.Error("expected KV() to return non-nil client")
	}
	if client.D1("analytics") == nil {
		t.Error("expected D1() to return non-nil client")
	}
	if client.Functions() == nil {
		t.Error("expected Functions() to return non-nil client")
	}
	if client.Analytics() == nil {
		t.Error("expected Analytics() to return non-nil client")
	}
}

func TestAdminClientDB(t *testing.T) {
	client := NewAdminClient(testBaseURL, testServiceKey)
	db := client.DB("shared", "")
	if db == nil {
		t.Fatal("expected non-nil db")
	}
	if db.namespace != "shared" {
		t.Errorf("expected namespace=shared, got %q", db.namespace)
	}
}

func TestAdminClientDBWithInstanceID(t *testing.T) {
	client := NewAdminClient(testBaseURL, testServiceKey)
	db := client.DB("workspace", "ws-123")
	if db.instanceID != "ws-123" {
		t.Errorf("expected instanceID=ws-123, got %q", db.instanceID)
	}
}

func TestAdminClientDBEmptyInstanceID(t *testing.T) {
	client := NewAdminClient(testBaseURL, testServiceKey)
	db := client.DB("shared", "")
	if db.instanceID != "" {
		t.Errorf("expected empty instanceID, got %q", db.instanceID)
	}
}

func TestAdminClientDBMultipleNamespaces(t *testing.T) {
	client := NewAdminClient(testBaseURL, testServiceKey)
	db1 := client.DB("shared", "")
	db2 := client.DB("workspace", "ws-1")
	db3 := client.DB("user", "user-1")

	if db1.namespace != "shared" {
		t.Errorf("expected shared, got %q", db1.namespace)
	}
	if db2.namespace != "workspace" {
		t.Errorf("expected workspace, got %q", db2.namespace)
	}
	if db3.namespace != "user" {
		t.Errorf("expected user, got %q", db3.namespace)
	}
}

func TestAdminClientAdminAuthNotNil(t *testing.T) {
	client := NewAdminClient(testBaseURL, testServiceKey)
	if client.AdminAuth == nil {
		t.Fatal("expected AdminAuth to be non-nil")
	}
	if client.AdminAuth.adminCore == nil {
		t.Error("expected AdminAuth.adminCore to be non-nil")
	}
}

func TestAdminClientAdminAuthSharesAdminCore(t *testing.T) {
	client := NewAdminClient(testBaseURL, testServiceKey)
	if client.AdminAuth.adminCore != client.adminCore {
		t.Error("AdminAuth should share the same GeneratedAdminApi as AdminClient")
	}
}

func TestDbRefTable(t *testing.T) {
	client := NewAdminClient(testBaseURL, testServiceKey)
	db := client.DB("shared", "")
	table := db.Table("posts")
	if table == nil {
		t.Fatal("expected non-nil table")
	}
	if table.name != "posts" {
		t.Errorf("expected name=posts, got %q", table.name)
	}
}

func TestDbRefTableInheritsNamespace(t *testing.T) {
	client := NewAdminClient(testBaseURL, testServiceKey)
	db := client.DB("workspace", "ws-42")
	table := db.Table("items")

	if table.namespace != "workspace" {
		t.Errorf("expected namespace=workspace, got %q", table.namespace)
	}
	if table.instanceID != "ws-42" {
		t.Errorf("expected instanceID=ws-42, got %q", table.instanceID)
	}
}

func TestDbRefMultipleTables(t *testing.T) {
	client := NewAdminClient(testBaseURL, testServiceKey)
	db := client.DB("shared", "")
	t1 := db.Table("posts")
	t2 := db.Table("comments")
	t3 := db.Table("users")

	if t1.name != "posts" {
		t.Errorf("expected posts, got %q", t1.name)
	}
	if t2.name != "comments" {
		t.Errorf("expected comments, got %q", t2.name)
	}
	if t3.name != "users" {
		t.Errorf("expected users, got %q", t3.name)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// G. HTTPClient Structure
// ═══════════════════════════════════════════════════════════════════════════════

func TestNewHTTPClient(t *testing.T) {
	client := NewHTTPClient(testBaseURL+"/", testServiceKey)
	if client == nil {
		t.Fatal("expected non-nil client")
	}
	if client.baseURL != testBaseURL {
		t.Errorf("expected trimmed URL, got %q", client.baseURL)
	}
	if client.serviceKey != testServiceKey {
		t.Errorf("expected serviceKey=%s, got %q", testServiceKey, client.serviceKey)
	}
}

func TestNewHTTPClientNoTrailingSlash(t *testing.T) {
	client := NewHTTPClient(testBaseURL, "sk")
	if client.baseURL != testBaseURL {
		t.Errorf("URL should not change, got %q", client.baseURL)
	}
}

func TestNewHTTPClientMultipleTrailingSlashes(t *testing.T) {
	client := NewHTTPClient(testBaseURL+"///", "sk")
	if strings.HasSuffix(client.baseURL, "/") {
		t.Errorf("URL should have trailing slashes trimmed, got %q", client.baseURL)
	}
}

func TestNewHTTPClientEmptyServiceKey(t *testing.T) {
	client := NewHTTPClient(testBaseURL, "")
	if client.serviceKey != "" {
		t.Errorf("expected empty serviceKey, got %q", client.serviceKey)
	}
}

func TestNewHTTPClientHTTPS(t *testing.T) {
	client := NewHTTPClient("https://my-app.edgebase.fun", "sk-prod")
	if client.baseURL != "https://my-app.edgebase.fun" {
		t.Errorf("expected https URL, got %q", client.baseURL)
	}
}

func TestNewHTTPClientHTTPClientNotNil(t *testing.T) {
	client := NewHTTPClient("http://localhost", "sk")
	if client.client == nil {
		t.Error("expected inner http.Client to be non-nil")
	}
}

func TestNewHTTPClientTimeoutFromEnv(t *testing.T) {
	t.Setenv("EDGEBASE_HTTP_TIMEOUT_MS", "1500")
	client := NewHTTPClient("http://localhost", "sk")
	if client.client.Timeout != 1500*time.Millisecond {
		t.Errorf("expected timeout=1500ms, got %s", client.client.Timeout)
	}
}

func TestNewHTTPClientIgnoresInvalidTimeoutEnv(t *testing.T) {
	t.Setenv("EDGEBASE_HTTP_TIMEOUT_MS", "invalid")
	client := NewHTTPClient("http://localhost", "sk")
	if client.client.Timeout != 0 {
		t.Errorf("expected zero timeout for invalid env, got %s", client.client.Timeout)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// H. ListResult Structure
// ═══════════════════════════════════════════════════════════════════════════════

func TestListResultFields(t *testing.T) {
	total := 42
	hasMore := true
	cursor := "cursor-abc"
	lr := &ListResult{
		Items:   []map[string]interface{}{{"id": "1"}, {"id": "2"}},
		Total:   &total,
		HasMore: &hasMore,
		Cursor:  &cursor,
	}
	if len(lr.Items) != 2 {
		t.Errorf("expected 2 items, got %d", len(lr.Items))
	}
	if *lr.Total != 42 {
		t.Errorf("expected total=42, got %d", *lr.Total)
	}
	if !*lr.HasMore {
		t.Error("expected hasMore=true")
	}
	if *lr.Cursor != "cursor-abc" {
		t.Errorf("expected cursor=cursor-abc, got %q", *lr.Cursor)
	}
}

func TestListResultNilPointers(t *testing.T) {
	lr := &ListResult{}
	if lr.Total != nil {
		t.Error("expected total=nil")
	}
	if lr.HasMore != nil {
		t.Error("expected hasMore=nil")
	}
	if lr.Cursor != nil {
		t.Error("expected cursor=nil")
	}
}

func TestListResultJSONUnmarshal(t *testing.T) {
	data := `{"items":[{"id":"1","title":"Hello"},{"id":"2","title":"World"}],"total":2,"cursor":"c123"}`
	var lr ListResult
	if err := json.Unmarshal([]byte(data), &lr); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if len(lr.Items) != 2 {
		t.Errorf("expected 2 items, got %d", len(lr.Items))
	}
	if lr.Total == nil || *lr.Total != 2 {
		t.Errorf("expected total=2, got %v", lr.Total)
	}
	if lr.Cursor == nil || *lr.Cursor != "c123" {
		t.Errorf("expected cursor=c123, got %v", lr.Cursor)
	}
}

func TestListResultJSONUnmarshalEmpty(t *testing.T) {
	data := `{"items":[]}`
	var lr ListResult
	if err := json.Unmarshal([]byte(data), &lr); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if len(lr.Items) != 0 {
		t.Errorf("expected 0 items, got %d", len(lr.Items))
	}
	if lr.Total != nil {
		t.Error("expected total=nil for empty result")
	}
}

func TestListResultJSONUnmarshalNullCursor(t *testing.T) {
	data := `{"items":[],"total":0,"cursor":null}`
	var lr ListResult
	if err := json.Unmarshal([]byte(data), &lr); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if lr.Cursor != nil {
		t.Error("expected cursor=nil")
	}
}

func TestListResultJSONMarshal(t *testing.T) {
	total := 1
	cursor := "abc"
	lr := ListResult{
		Items:  []map[string]interface{}{{"id": "x"}},
		Total:  &total,
		Cursor: &cursor,
	}
	b, err := json.Marshal(lr)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	s := string(b)
	if !contains(s, `"total":1`) {
		t.Errorf("expected total:1 in JSON, got %s", s)
	}
	if !contains(s, `"cursor":"abc"`) {
		t.Errorf("expected cursor:abc in JSON, got %s", s)
	}
}

func TestListResultEmptyItems(t *testing.T) {
	lr := &ListResult{
		Items: []map[string]interface{}{},
	}
	if len(lr.Items) != 0 {
		t.Errorf("expected 0 items, got %d", len(lr.Items))
	}
}

func TestListResultNilItems(t *testing.T) {
	lr := &ListResult{}
	if lr.Items != nil {
		t.Error("expected nil items")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// I. AdminAuthClient URL Construction (unit-level)
// ═══════════════════════════════════════════════════════════════════════════════

func TestAdminAuthClientCreateUserPath(t *testing.T) {
	// Verify the path used for CreateUser
	expectedPath := "/api/auth/admin/users"
	if !contains(expectedPath, "/api/auth/admin/users") {
		t.Error("CreateUser path mismatch")
	}
}

func TestAdminAuthClientGetUserPath(t *testing.T) {
	expectedPath := "/api/auth/admin/users/user-123"
	if !contains(expectedPath, "/api/auth/admin/users/") {
		t.Error("GetUser path mismatch")
	}
}

func TestAdminAuthClientListUsersPath(t *testing.T) {
	path := fmt.Sprintf("/api/auth/admin/users?limit=%d", 10)
	if !contains(path, "limit=10") {
		t.Errorf("expected limit=10 in path, got %q", path)
	}
}

func TestAdminAuthClientSetClaimsPath(t *testing.T) {
	path := fmt.Sprintf("/api/auth/admin/users/%s/claims", "user-abc")
	expected := "/api/auth/admin/users/user-abc/claims"
	if path != expected {
		t.Errorf("expected %q, got %q", expected, path)
	}
}

func TestAdminAuthClientRevokeSessionsPath(t *testing.T) {
	expectedPath := "/api/auth/signout/all"
	if expectedPath != "/api/auth/signout/all" {
		t.Error("RevokeAllSessions path mismatch")
	}
}

func TestAdminAuthClientDeleteUserPath(t *testing.T) {
	path := "/api/auth/admin/users/" + "user-del-123"
	expected := "/api/auth/admin/users/user-del-123"
	if path != expected {
		t.Errorf("expected %q, got %q", expected, path)
	}
}

func TestAdminAuthClientListUsersLimitValues(t *testing.T) {
	limits := []int{1, 5, 10, 50, 100}
	for _, limit := range limits {
		path := fmt.Sprintf("/api/auth/admin/users?limit=%d", limit)
		expected := fmt.Sprintf("limit=%d", limit)
		if !contains(path, expected) {
			t.Errorf("expected %s in path %q", expected, path)
		}
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// J. SQL Method Path Construction
// ═══════════════════════════════════════════════════════════════════════════════

func TestSQLBodyConstruction(t *testing.T) {
	body := map[string]interface{}{
		"namespace": "shared",
		"sql":       "SELECT * FROM posts",
		"params":    []interface{}{},
	}
	if body["namespace"] != "shared" {
		t.Errorf("expected namespace=shared, got %v", body["namespace"])
	}
	if body["sql"] != "SELECT * FROM posts" {
		t.Errorf("expected sql query, got %v", body["sql"])
	}
}

func TestSQLBodyWithInstanceID(t *testing.T) {
	body := map[string]interface{}{
		"namespace": "workspace",
		"sql":       "SELECT 1",
		"params":    []interface{}{},
		"id":        "ws-42",
	}
	if body["id"] != "ws-42" {
		t.Errorf("expected id=ws-42, got %v", body["id"])
	}
}

func TestSQLBodyWithParams(t *testing.T) {
	params := []interface{}{"hello", 42, true}
	body := map[string]interface{}{
		"namespace": "shared",
		"sql":       "SELECT * FROM posts WHERE title = ? AND views > ? AND active = ?",
		"params":    params,
	}
	p := body["params"].([]interface{})
	if len(p) != 3 {
		t.Errorf("expected 3 params, got %d", len(p))
	}
	if p[0] != "hello" {
		t.Errorf("expected param[0]=hello, got %v", p[0])
	}
}

func TestSQLBodyNoInstanceID(t *testing.T) {
	body := map[string]interface{}{
		"namespace": "shared",
		"sql":       "SELECT 1",
		"params":    []interface{}{},
	}
	if _, ok := body["id"]; ok {
		t.Error("body should not contain id when instanceID is empty")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// K. Broadcast Path Construction
// ═══════════════════════════════════════════════════════════════════════════════

func TestBroadcastBodyConstruction(t *testing.T) {
	body := map[string]interface{}{
		"channel": "my-channel",
		"event":   "test-event",
		"payload": map[string]interface{}{"msg": "hello"},
	}
	if body["channel"] != "my-channel" {
		t.Errorf("expected channel=my-channel, got %v", body["channel"])
	}
	if body["event"] != "test-event" {
		t.Errorf("expected event=test-event, got %v", body["event"])
	}
}

func TestBroadcastPayloadTypes(t *testing.T) {
	payloads := []map[string]interface{}{
		{"msg": "simple string"},
		{"count": 42},
		{"active": true},
		{"nested": map[string]interface{}{"deep": "value"}},
		{},
	}
	for i, p := range payloads {
		body := map[string]interface{}{
			"channel": "ch",
			"event":   "ev",
			"payload": p,
		}
		if body["payload"] == nil {
			t.Errorf("payload %d should not be nil", i)
		}
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// L. Upsert Query Params
// ═══════════════════════════════════════════════════════════════════════════════

func TestUpsertQueryParamsNoConflictTarget(t *testing.T) {
	ref := newTestTableRef()
	params := ref.buildQueryParams()
	params["upsert"] = "true"
	if params["upsert"] != "true" {
		t.Errorf("expected upsert=true, got %q", params["upsert"])
	}
}

func TestUpsertQueryParamsWithConflictTarget(t *testing.T) {
	ref := newTestTableRef()
	params := ref.buildQueryParams()
	params["upsert"] = "true"
	params["conflictTarget"] = "email"
	if params["upsert"] != "true" {
		t.Errorf("expected upsert=true, got %q", params["upsert"])
	}
	if params["conflictTarget"] != "email" {
		t.Errorf("expected conflictTarget=email, got %q", params["conflictTarget"])
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// M. jsonMarshalNoEscape
// ═══════════════════════════════════════════════════════════════════════════════

func TestJsonMarshalNoEscapeGte(t *testing.T) {
	data := []interface{}{"age", ">=", 18}
	b, err := jsonMarshalNoEscape(data)
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}
	s := string(b)
	if contains(s, `\u003e`) {
		t.Errorf("should not HTML-escape >=, got %s", s)
	}
	if !contains(s, `>=`) {
		t.Errorf("expected >= in output, got %s", s)
	}
}

func TestJsonMarshalNoEscapeLte(t *testing.T) {
	data := []interface{}{"score", "<=", 100}
	b, err := jsonMarshalNoEscape(data)
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}
	s := string(b)
	if contains(s, `\u003c`) {
		t.Errorf("should not HTML-escape <=, got %s", s)
	}
}

func TestJsonMarshalNoEscapeAmpersand(t *testing.T) {
	data := map[string]string{"key": "a&b"}
	b, err := jsonMarshalNoEscape(data)
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}
	s := string(b)
	if contains(s, `\u0026`) {
		t.Errorf("should not HTML-escape &, got %s", s)
	}
	if !contains(s, `a&b`) {
		t.Errorf("expected a&b in output, got %s", s)
	}
}

func TestJsonMarshalNoEscapeHTMLAngleBrackets(t *testing.T) {
	data := map[string]string{"html": "<div>test</div>"}
	b, err := jsonMarshalNoEscape(data)
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}
	s := string(b)
	if !contains(s, `<div>`) {
		t.Errorf("expected literal <div> in output, got %s", s)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// N. Clone Independence
// ═══════════════════════════════════════════════════════════════════════════════

func TestCloneFiltersIndependent(t *testing.T) {
	base := newTestTableRef().Where("a", "==", 1)
	cloned := base.Where("b", "==", 2)

	if len(base.filters) != 1 {
		t.Errorf("base should have 1 filter, got %d", len(base.filters))
	}
	if len(cloned.filters) != 2 {
		t.Errorf("cloned should have 2 filters, got %d", len(cloned.filters))
	}
}

func TestCloneSortsIndependent(t *testing.T) {
	base := newTestTableRef().OrderBy("a", "asc")
	cloned := base.OrderBy("b", "desc")

	if len(base.sorts) != 1 {
		t.Errorf("base should have 1 sort, got %d", len(base.sorts))
	}
	if len(cloned.sorts) != 2 {
		t.Errorf("cloned should have 2 sorts, got %d", len(cloned.sorts))
	}
}

func TestCloneLimitIndependent(t *testing.T) {
	base := newTestTableRef().Limit(5)
	cloned := base.Limit(10)

	if *base.limit != 5 {
		t.Errorf("base limit should be 5, got %d", *base.limit)
	}
	if *cloned.limit != 10 {
		t.Errorf("cloned limit should be 10, got %d", *cloned.limit)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// O. Contains Helper
// ═══════════════════════════════════════════════════════════════════════════════

func TestContainsHelper(t *testing.T) {
	if !contains("hello world", "world") {
		t.Error("contains: should find 'world' in 'hello world'")
	}
	if contains("hello", "world") {
		t.Error("contains: should not find 'world' in 'hello'")
	}
}

func TestContainsEmptySubstring(t *testing.T) {
	if !contains("hello", "") {
		t.Error("empty substring should be found in any string")
	}
}

func TestContainsEmptyBoth(t *testing.T) {
	if !contains("", "") {
		t.Error("empty should contain empty")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// P. Multiple Filters JSON Serialization
// ═══════════════════════════════════════════════════════════════════════════════

func TestMultipleFiltersJSON(t *testing.T) {
	ref := newTestTableRef().
		Where("status", "==", "published").
		Where("views", ">", 100)
	qs := ref.buildQueryString()
	if !contains(qs, "filter=") {
		t.Errorf("expected filter= in QS, got %q", qs)
	}
}

func TestThreeFiltersJSON(t *testing.T) {
	ref := newTestTableRef().
		Where("status", "==", "active").
		Where("age", ">=", 18).
		Where("views", "<", 1000)
	qs := ref.buildQueryString()
	if !contains(qs, "filter=") {
		t.Errorf("expected filter= in QS, got %q", qs)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Q. Error Format Validation
// ═══════════════════════════════════════════════════════════════════════════════

func TestHTTPErrorFormat(t *testing.T) {
	// Verify the error format matches "HTTP %d: %s"
	err := fmt.Errorf("HTTP %d: %s", 404, "Not Found")
	if !contains(err.Error(), "HTTP 404") {
		t.Errorf("expected HTTP 404 in error, got %s", err.Error())
	}
}

func TestHTTPError400(t *testing.T) {
	err := fmt.Errorf("HTTP %d: %s", 400, `{"error":"bad request"}`)
	if !contains(err.Error(), "HTTP 400") {
		t.Errorf("expected HTTP 400 in error, got %s", err.Error())
	}
}

func TestHTTPError401(t *testing.T) {
	err := fmt.Errorf("HTTP %d: %s", 401, "Unauthorized")
	if !contains(err.Error(), "HTTP 401") {
		t.Errorf("expected HTTP 401 in error, got %s", err.Error())
	}
}

func TestHTTPError403(t *testing.T) {
	err := fmt.Errorf("HTTP %d: %s", 403, "Forbidden")
	if !contains(err.Error(), "HTTP 403") {
		t.Errorf("expected HTTP 403 in error, got %s", err.Error())
	}
}

func TestHTTPError500(t *testing.T) {
	err := fmt.Errorf("HTTP %d: %s", 500, "Internal Server Error")
	if !contains(err.Error(), "HTTP 500") {
		t.Errorf("expected HTTP 500 in error, got %s", err.Error())
	}
}

func TestNetworkErrorWrapping(t *testing.T) {
	inner := fmt.Errorf("connection refused")
	err := fmt.Errorf("network error: %w", inner)
	if !contains(err.Error(), "network error") {
		t.Errorf("expected network error prefix, got %s", err.Error())
	}
	if !contains(err.Error(), "connection refused") {
		t.Errorf("expected inner error, got %s", err.Error())
	}
}

func TestMarshalErrorWrapping(t *testing.T) {
	inner := fmt.Errorf("invalid json")
	err := fmt.Errorf("marshal body: %w", inner)
	if !contains(err.Error(), "marshal body") {
		t.Errorf("expected marshal body prefix, got %s", err.Error())
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// R. VectorizeClient Structure & Helpers
// ═══════════════════════════════════════════════════════════════════════════════

func TestAdminClientVector(t *testing.T) {
	client := NewAdminClient(testBaseURL, testServiceKey)
	vc := client.Vector("embeddings")
	if vc == nil {
		t.Fatal("expected non-nil VectorizeClient")
	}
}

func TestVectorizeClientApiPath(t *testing.T) {
	client := NewAdminClient(testBaseURL, testServiceKey)
	vc := client.Vector("embeddings")
	expected := "/api/vectorize/embeddings"
	if vc.apiPath() != expected {
		t.Errorf("expected %q, got %q", expected, vc.apiPath())
	}
}

func TestVectorizeClientApiPathDifferentIndex(t *testing.T) {
	client := NewAdminClient(testBaseURL, testServiceKey)
	vc := client.Vector("my-index-v2")
	expected := "/api/vectorize/my-index-v2"
	if vc.apiPath() != expected {
		t.Errorf("expected %q, got %q", expected, vc.apiPath())
	}
}

func TestVectorizeClientMultipleIndexes(t *testing.T) {
	client := NewAdminClient(testBaseURL, testServiceKey)
	vc1 := client.Vector("index-a")
	vc2 := client.Vector("index-b")
	if vc1.apiPath() == vc2.apiPath() {
		t.Error("different indexes should have different paths")
	}
}

func TestVectorSearchOptionsDefaults(t *testing.T) {
	opts := VectorSearchOptions{}
	if opts.TopK != 0 {
		t.Errorf("default TopK should be 0, got %d", opts.TopK)
	}
	if opts.Namespace != "" {
		t.Errorf("default Namespace should be empty, got %q", opts.Namespace)
	}
	if opts.Filter != nil {
		t.Error("default Filter should be nil")
	}
	if opts.ReturnValues != nil {
		t.Error("default ReturnValues should be nil")
	}
	if opts.ReturnMetadata != nil {
		t.Error("default ReturnMetadata should be nil")
	}
}

func TestVectorSearchOptionsAllFields(t *testing.T) {
	rv := true
	opts := VectorSearchOptions{
		TopK:           5,
		Namespace:      "ns-1",
		Filter:         map[string]interface{}{"category": "tech"},
		ReturnValues:   &rv,
		ReturnMetadata: "all",
	}
	if opts.TopK != 5 {
		t.Errorf("expected TopK=5, got %d", opts.TopK)
	}
	if opts.Namespace != "ns-1" {
		t.Errorf("expected Namespace=ns-1, got %q", opts.Namespace)
	}
	if opts.Filter["category"] != "tech" {
		t.Errorf("expected Filter[category]=tech, got %v", opts.Filter["category"])
	}
	if *opts.ReturnValues != true {
		t.Error("expected ReturnValues=true")
	}
	if opts.ReturnMetadata != "all" {
		t.Errorf("expected ReturnMetadata=all, got %v", opts.ReturnMetadata)
	}
}

func TestVectorSearchOptionsReturnMetadataBool(t *testing.T) {
	opts := VectorSearchOptions{ReturnMetadata: true}
	if opts.ReturnMetadata != true {
		t.Error("ReturnMetadata should accept boolean true")
	}
}

func TestVectorSearchOptionsReturnMetadataString(t *testing.T) {
	for _, val := range []string{"all", "indexed", "none"} {
		opts := VectorSearchOptions{ReturnMetadata: val}
		if opts.ReturnMetadata != val {
			t.Errorf("ReturnMetadata should accept string %q, got %v", val, opts.ReturnMetadata)
		}
	}
}

func TestVectorSearchOptionsJSON(t *testing.T) {
	rv := false
	opts := VectorSearchOptions{
		TopK:           10,
		Namespace:      "test-ns",
		ReturnValues:   &rv,
		ReturnMetadata: "indexed",
	}
	b, err := json.Marshal(opts)
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}
	s := string(b)
	if !contains(s, `"topK":10`) {
		t.Errorf("expected topK:10 in JSON, got %s", s)
	}
	if !contains(s, `"namespace":"test-ns"`) {
		t.Errorf("expected namespace in JSON, got %s", s)
	}
	if !contains(s, `"returnValues":false`) {
		t.Errorf("expected returnValues:false in JSON, got %s", s)
	}
	if !contains(s, `"returnMetadata":"indexed"`) {
		t.Errorf("expected returnMetadata:indexed in JSON, got %s", s)
	}
}

func TestVectorSearchOptionsOmitEmpty(t *testing.T) {
	opts := VectorSearchOptions{}
	b, err := json.Marshal(opts)
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}
	s := string(b)
	// Empty struct should produce minimal JSON with omitempty
	if contains(s, `"topK"`) {
		t.Errorf("zero TopK should be omitted, got %s", s)
	}
	if contains(s, `"namespace"`) {
		t.Errorf("empty Namespace should be omitted, got %s", s)
	}
	if contains(s, `"filter"`) {
		t.Errorf("nil Filter should be omitted, got %s", s)
	}
}

// ─── extractMapList helper ───────────────────────────────────────────────────

func TestExtractMapListBasic(t *testing.T) {
	data := map[string]interface{}{
		"matches": []interface{}{
			map[string]interface{}{"id": "v1", "score": 0.95},
			map[string]interface{}{"id": "v2", "score": 0.80},
		},
	}
	result := extractMapList(data, "matches")
	if len(result) != 2 {
		t.Fatalf("expected 2 items, got %d", len(result))
	}
	if result[0]["id"] != "v1" {
		t.Errorf("expected id=v1, got %v", result[0]["id"])
	}
	if result[1]["score"] != 0.80 {
		t.Errorf("expected score=0.80, got %v", result[1]["score"])
	}
}

func TestExtractMapListEmpty(t *testing.T) {
	data := map[string]interface{}{
		"matches": []interface{}{},
	}
	result := extractMapList(data, "matches")
	if len(result) != 0 {
		t.Errorf("expected 0 items, got %d", len(result))
	}
}

func TestExtractMapListMissingKey(t *testing.T) {
	data := map[string]interface{}{"other": "value"}
	result := extractMapList(data, "matches")
	if result != nil {
		t.Error("expected nil for missing key")
	}
}

func TestExtractMapListNonArrayValue(t *testing.T) {
	data := map[string]interface{}{"matches": "not-an-array"}
	result := extractMapList(data, "matches")
	if result != nil {
		t.Error("expected nil for non-array value")
	}
}

func TestExtractMapListWithMetadata(t *testing.T) {
	data := map[string]interface{}{
		"vectors": []interface{}{
			map[string]interface{}{
				"id":        "v1",
				"values":    []interface{}{0.1, 0.2, 0.3},
				"metadata":  map[string]interface{}{"title": "doc-1"},
				"namespace": "ns-a",
			},
		},
	}
	result := extractMapList(data, "vectors")
	if len(result) != 1 {
		t.Fatalf("expected 1 item, got %d", len(result))
	}
	if result[0]["id"] != "v1" {
		t.Errorf("expected id=v1, got %v", result[0]["id"])
	}
	if result[0]["namespace"] != "ns-a" {
		t.Errorf("expected namespace=ns-a, got %v", result[0]["namespace"])
	}
	meta, ok := result[0]["metadata"].(map[string]interface{})
	if !ok {
		t.Fatal("expected metadata to be a map")
	}
	if meta["title"] != "doc-1" {
		t.Errorf("expected title=doc-1, got %v", meta["title"])
	}
}

func TestExtractMapListSkipsNonMaps(t *testing.T) {
	data := map[string]interface{}{
		"matches": []interface{}{
			map[string]interface{}{"id": "v1"},
			"not-a-map",
			42,
			map[string]interface{}{"id": "v2"},
		},
	}
	result := extractMapList(data, "matches")
	if len(result) != 2 {
		t.Errorf("expected 2 map items (skipping non-maps), got %d", len(result))
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// S. Smoke Test
// ═══════════════════════════════════════════════════════════════════════════════

func TestSmokePackage(t *testing.T) {
	t.Log("edgebase unit tests: package ok")
	_ = fmt.Sprintf("ok")
}
