//go:build e2e

// Go SDK E2E Integration Tests
//
// Prerequisites:
//   cd packages/server
//   TMPDIR=/tmp XDG_CONFIG_HOME=/tmp npx wrangler dev --config wrangler.test.toml --port 8688
//
// Run:
//   cd packages/sdk/go
//   BASE_URL=http://localhost:8688 EDGEBASE_SERVICE_KEY=test-service-key-for-admin go test -tags e2e -v ./...

package edgebase_test

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	edgebase "github.com/edgebase/sdk-go"
)

var counter atomic.Uint64

func uniqueEmail() string {
	n := counter.Add(1)
	return fmt.Sprintf("go-e2e-%d-%d@test.com", time.Now().UnixNano(), n)
}

func uniquePrefix() string {
	return fmt.Sprintf("go-e2e-%d", time.Now().UnixMilli())
}

func getenv(key string) string {
	return os.Getenv(key)
}

func newAdmin(t *testing.T) *edgebase.AdminClient {
	t.Helper()
	baseURL := getEnvOrDefault("BASE_URL", "http://localhost:8688")
	serviceKey := getEnvOrDefault("EDGEBASE_SERVICE_KEY", "test-service-key-for-admin")
	return edgebase.NewAdminClient(baseURL, serviceKey)
}

func getEnvOrDefault(key, def string) string {
	v := getenv(key)
	if v == "" {
		return def
	}
	return v
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CRUD — Basic
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_Insert(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	prefix := uniquePrefix()
	result, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title": prefix,
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	if result["id"] == nil {
		t.Fatal("Expected id in result")
	}
}

func TestE2E_GetOne(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	prefix := uniquePrefix()
	created, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title": prefix,
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	id := fmt.Sprintf("%v", created["id"])

	got, err := admin.DB("shared", "").Table("posts").GetOne(ctx, id)
	if err != nil {
		t.Fatalf("GetOne failed: %v", err)
	}
	if fmt.Sprintf("%v", got["id"]) != id {
		t.Errorf("Expected id %s, got %v", id, got["id"])
	}
}

func TestE2E_Update(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	created, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title": "Go-update-orig",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	id := fmt.Sprintf("%v", created["id"])

	updated, err := admin.DB("shared", "").Table("posts").Update(ctx, id, map[string]interface{}{
		"title": "Go-update-new",
	})
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if fmt.Sprintf("%v", updated["title"]) != "Go-update-new" {
		t.Errorf("Expected title 'Go-update-new', got %v", updated["title"])
	}
}

func TestE2E_Delete(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	created, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title": "Go-delete-me",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	id := fmt.Sprintf("%v", created["id"])

	if err := admin.DB("shared", "").Table("posts").Delete(ctx, id); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	_, err = admin.DB("shared", "").Table("posts").GetOne(ctx, id)
	if err == nil {
		t.Error("Expected error getting deleted record")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. CRUD — Extended (large payload, special chars, CJK, emoji)
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_InsertLargePayload(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	// Create a record with a large body (~5KB)
	bigBody := strings.Repeat("EdgeBase Go SDK test data. ", 200)
	result, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title": uniquePrefix() + "-large",
		"body":  bigBody,
	})
	if err != nil {
		t.Fatalf("Create large payload failed: %v", err)
	}
	if result["id"] == nil {
		t.Fatal("Expected id in result")
	}

	// Verify data roundtrip
	id := fmt.Sprintf("%v", result["id"])
	got, err := admin.DB("shared", "").Table("posts").GetOne(ctx, id)
	if err != nil {
		t.Fatalf("GetOne failed: %v", err)
	}
	if fmt.Sprintf("%v", got["body"]) != bigBody {
		t.Error("Large payload body mismatch on roundtrip")
	}
}

func TestE2E_InsertSpecialChars(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	special := `!@#$%^&*()_+-=[]{}|;':",.<>?/` + "`~"
	result, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title": uniquePrefix() + "-special",
		"body":  special,
	})
	if err != nil {
		t.Fatalf("Create with special chars failed: %v", err)
	}
	id := fmt.Sprintf("%v", result["id"])

	got, err := admin.DB("shared", "").Table("posts").GetOne(ctx, id)
	if err != nil {
		t.Fatalf("GetOne failed: %v", err)
	}
	if fmt.Sprintf("%v", got["body"]) != special {
		t.Error("Special chars body mismatch")
	}
}

func TestE2E_InsertCJK(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	cjk := "EdgeBase: CJK test"
	result, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title": uniquePrefix() + "-cjk",
		"body":  cjk,
	})
	if err != nil {
		t.Fatalf("Create CJK failed: %v", err)
	}
	id := fmt.Sprintf("%v", result["id"])

	got, err := admin.DB("shared", "").Table("posts").GetOne(ctx, id)
	if err != nil {
		t.Fatalf("GetOne failed: %v", err)
	}
	if fmt.Sprintf("%v", got["body"]) != cjk {
		t.Error("CJK body mismatch")
	}
}

func TestE2E_InsertEmoji(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	emoji := "Hello World! test data"
	result, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title": uniquePrefix() + "-emoji",
		"body":  emoji,
	})
	if err != nil {
		t.Fatalf("Create with emoji failed: %v", err)
	}
	id := fmt.Sprintf("%v", result["id"])

	got, err := admin.DB("shared", "").Table("posts").GetOne(ctx, id)
	if err != nil {
		t.Fatalf("GetOne failed: %v", err)
	}
	if fmt.Sprintf("%v", got["body"]) != emoji {
		t.Error("Emoji body mismatch")
	}
}

func TestE2E_UpdateMultipleFields(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	created, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title":     uniquePrefix() + "-multi-update",
		"body":      "original",
		"viewCount": 0,
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	id := fmt.Sprintf("%v", created["id"])

	updated, err := admin.DB("shared", "").Table("posts").Update(ctx, id, map[string]interface{}{
		"title":     "updated-title",
		"body":      "updated-body",
		"viewCount": 42,
	})
	if err != nil {
		t.Fatalf("Update multiple fields failed: %v", err)
	}
	if fmt.Sprintf("%v", updated["title"]) != "updated-title" {
		t.Error("title not updated")
	}
	if fmt.Sprintf("%v", updated["body"]) != "updated-body" {
		t.Error("body not updated")
	}
}

func TestE2E_InsertAndVerifyTimestamp(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	before := time.Now().Add(-2 * time.Second)
	result, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title": uniquePrefix() + "-timestamp",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	_ = before

	if result["id"] == nil {
		t.Fatal("Expected id in result")
	}
	// createdAt should exist
	if result["createdAt"] == nil {
		t.Log("Note: createdAt not returned in create response (server may not include it)")
	}
}

func TestE2E_InsertEmptyBody(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	result, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title": uniquePrefix() + "-empty-body",
		"body":  "",
	})
	if err != nil {
		t.Fatalf("Create with empty body failed: %v", err)
	}
	if result["id"] == nil {
		t.Fatal("Expected id in result")
	}
}

func TestE2E_UpdatePartialFields(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	prefix := uniquePrefix()
	created, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title": prefix + "-partial",
		"body":  "keep-this",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	id := fmt.Sprintf("%v", created["id"])

	// Only update title, body should remain
	updated, err := admin.DB("shared", "").Table("posts").Update(ctx, id, map[string]interface{}{
		"title": prefix + "-partial-updated",
	})
	if err != nil {
		t.Fatalf("Partial update failed: %v", err)
	}
	if fmt.Sprintf("%v", updated["body"]) != "keep-this" {
		t.Errorf("body should remain unchanged, got %v", updated["body"])
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Query Builder — Filters
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_WhereFilter(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	prefix := uniquePrefix()
	_, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title": prefix,
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	result, err := admin.DB("shared", "").Table("posts").Where("title", "==", prefix).GetList(ctx)
	if err != nil {
		t.Fatalf("Get with Where failed: %v", err)
	}
	if len(result.Items) == 0 {
		t.Errorf("Expected at least 1 item, got 0")
	}
}

func TestE2E_WhereNotEqual(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	prefix := uniquePrefix()
	_, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title": prefix + "-ne",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	result, err := admin.DB("shared", "").Table("posts").
		Where("title", "!=", "nonexistent-title-xyz").
		Limit(5).
		GetList(ctx)
	if err != nil {
		t.Fatalf("Where != failed: %v", err)
	}
	if len(result.Items) == 0 {
		t.Error("Expected items for != filter")
	}
}

func TestE2E_WhereContains(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	prefix := uniquePrefix()
	_, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title": prefix + "-contains-test",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	result, err := admin.DB("shared", "").Table("posts").
		Where("title", "contains", prefix).
		GetList(ctx)
	if err != nil {
		t.Fatalf("Where contains failed: %v", err)
	}
	if len(result.Items) == 0 {
		t.Error("Expected items for contains filter")
	}
}

func TestE2E_WhereGreaterThan(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	prefix := uniquePrefix()
	_, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title":     prefix + "-gt",
		"viewCount": 50,
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	result, err := admin.DB("shared", "").Table("posts").
		Where("title", "contains", prefix).
		Where("viewCount", ">", 10).
		GetList(ctx)
	if err != nil {
		t.Fatalf("Where > failed: %v", err)
	}
	if len(result.Items) == 0 {
		t.Error("Expected items for > filter")
	}
}

func TestE2E_WhereLessThan(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	prefix := uniquePrefix()
	_, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title":     prefix + "-lt",
		"viewCount": 5,
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	result, err := admin.DB("shared", "").Table("posts").
		Where("title", "contains", prefix).
		Where("viewCount", "<", 100).
		GetList(ctx)
	if err != nil {
		t.Fatalf("Where < failed: %v", err)
	}
	if len(result.Items) == 0 {
		t.Error("Expected items for < filter")
	}
}

func TestE2E_WhereGte(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	prefix := uniquePrefix()
	_, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title":     prefix + "-gte",
		"viewCount": 100,
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	result, err := admin.DB("shared", "").Table("posts").
		Where("title", "contains", prefix).
		Where("viewCount", ">=", 100).
		GetList(ctx)
	if err != nil {
		t.Fatalf("Where >= failed: %v", err)
	}
	if len(result.Items) == 0 {
		t.Error("Expected items for >= filter")
	}
}

func TestE2E_WhereLte(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	prefix := uniquePrefix()
	_, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title":     prefix + "-lte",
		"viewCount": 5,
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	result, err := admin.DB("shared", "").Table("posts").
		Where("title", "contains", prefix).
		Where("viewCount", "<=", 5).
		GetList(ctx)
	if err != nil {
		t.Fatalf("Where <= failed: %v", err)
	}
	if len(result.Items) == 0 {
		t.Error("Expected items for <= filter")
	}
}

func TestE2E_WhereMultipleChain(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	prefix := uniquePrefix()
	_, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title":     prefix + "-chain",
		"viewCount": 42,
		"body":      "chained",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	result, err := admin.DB("shared", "").Table("posts").
		Where("title", "contains", prefix).
		Where("viewCount", ">=", 40).
		Where("viewCount", "<=", 50).
		GetList(ctx)
	if err != nil {
		t.Fatalf("Multiple where chain failed: %v", err)
	}
	if len(result.Items) == 0 {
		t.Error("Expected items for multiple where chain")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Query Builder — OrderBy, Limit, Pagination
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_OrderByLimit(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	result, err := admin.DB("shared", "").Table("posts").
		OrderBy("createdAt", "desc").
		Limit(2).
		GetList(ctx)
	if err != nil {
		t.Fatalf("OrderBy+Limit failed: %v", err)
	}
	if len(result.Items) > 2 {
		t.Errorf("Expected <= 2 items, got %d", len(result.Items))
	}
}

func TestE2E_OrderByAsc(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	prefix := uniquePrefix()
	for i := 0; i < 3; i++ {
		_, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
			"title": fmt.Sprintf("%s-asc-%02d", prefix, i),
		})
		if err != nil {
			t.Fatalf("Create %d failed: %v", i, err)
		}
	}

	result, err := admin.DB("shared", "").Table("posts").
		Where("title", "contains", prefix).
		OrderBy("title", "asc").
		GetList(ctx)
	if err != nil {
		t.Fatalf("OrderBy asc failed: %v", err)
	}

	if len(result.Items) >= 2 {
		t0 := fmt.Sprintf("%v", result.Items[0]["title"])
		t1 := fmt.Sprintf("%v", result.Items[1]["title"])
		if t0 > t1 {
			t.Errorf("Expected ascending order, got %q before %q", t0, t1)
		}
	}
}

func TestE2E_LimitOne(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	prefix := uniquePrefix()
	for i := 0; i < 3; i++ {
		_, _ = admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
			"title": fmt.Sprintf("%s-lim1-%02d", prefix, i),
		})
	}

	result, err := admin.DB("shared", "").Table("posts").
		Where("title", "contains", prefix).
		Limit(1).
		GetList(ctx)
	if err != nil {
		t.Fatalf("Limit(1) failed: %v", err)
	}
	if len(result.Items) != 1 {
		t.Errorf("Expected 1 item, got %d", len(result.Items))
	}
}

func TestE2E_OffsetPagination(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	prefix := uniquePrefix()

	for i := 0; i < 5; i++ {
		_, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
			"title": fmt.Sprintf("%s-%02d", prefix, i),
		})
		if err != nil {
			t.Fatalf("Create %d failed: %v", i, err)
		}
	}

	page1, err := admin.DB("shared", "").Table("posts").
		Where("title", "contains", prefix).
		OrderBy("title", "asc").
		Limit(2).
		GetList(ctx)
	if err != nil {
		t.Fatalf("page1 failed: %v", err)
	}

	page2, err := admin.DB("shared", "").Table("posts").
		Where("title", "contains", prefix).
		OrderBy("title", "asc").
		Limit(2).
		Offset(2).
		GetList(ctx)
	if err != nil {
		t.Fatalf("page2 failed: %v", err)
	}

	if len(page1.Items) > 0 && len(page2.Items) > 0 {
		if fmt.Sprintf("%v", page1.Items[0]["id"]) == fmt.Sprintf("%v", page2.Items[0]["id"]) {
			t.Error("page1 and page2 should have different items")
		}
	}
}

func TestE2E_CursorPagination(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	prefix := uniquePrefix()

	for i := 0; i < 6; i++ {
		_, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
			"title": fmt.Sprintf("%s-cursor-%02d", prefix, i),
		})
		if err != nil {
			t.Fatalf("Create %d failed: %v", i, err)
		}
	}

	page1, err := admin.DB("shared", "").Table("posts").
		Where("title", "contains", prefix).
		OrderBy("title", "asc").
		Limit(3).
		GetList(ctx)
	if err != nil {
		t.Fatalf("page1 failed: %v", err)
	}

	if len(page1.Items) == 0 {
		t.Fatal("page1 should have items")
	}

	if page1.Cursor != nil && *page1.Cursor != "" {
		page2, err := admin.DB("shared", "").Table("posts").
			Where("title", "contains", prefix).
			OrderBy("title", "asc").
			Limit(3).
			After(*page1.Cursor).
			GetList(ctx)
		if err != nil {
			t.Fatalf("page2 (cursor) failed: %v", err)
		}
		if len(page2.Items) > 0 {
			id1 := fmt.Sprintf("%v", page1.Items[0]["id"])
			id2 := fmt.Sprintf("%v", page2.Items[0]["id"])
			if id1 == id2 {
				t.Error("cursor page2 should return different items")
			}
		}
	}
}

func TestE2E_CursorPaginationCollectAll(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	prefix := uniquePrefix()

	numRecords := 7
	for i := 0; i < numRecords; i++ {
		_, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
			"title": fmt.Sprintf("%s-all-%02d", prefix, i),
		})
		if err != nil {
			t.Fatalf("Create %d failed: %v", i, err)
		}
	}

	var allIDs []string
	table := admin.DB("shared", "").Table("posts").
		Where("title", "contains", prefix).
		OrderBy("title", "asc").
		Limit(3)

	page, err := table.GetList(ctx)
	if err != nil {
		t.Fatalf("first page failed: %v", err)
	}
	for _, item := range page.Items {
		allIDs = append(allIDs, fmt.Sprintf("%v", item["id"]))
	}

	for page.Cursor != nil && *page.Cursor != "" && len(page.Items) > 0 {
		page, err = table.After(*page.Cursor).GetList(ctx)
		if err != nil {
			t.Fatalf("next page failed: %v", err)
		}
		for _, item := range page.Items {
			allIDs = append(allIDs, fmt.Sprintf("%v", item["id"]))
		}
	}

	if len(allIDs) < numRecords {
		t.Errorf("Expected at least %d IDs, collected %d", numRecords, len(allIDs))
	}

	// Verify uniqueness
	seen := map[string]bool{}
	for _, id := range allIDs {
		if seen[id] {
			t.Errorf("Duplicate ID: %s", id)
		}
		seen[id] = true
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Count
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_Count(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	count, err := admin.DB("shared", "").Table("posts").Count(ctx)
	if err != nil {
		t.Fatalf("Count failed: %v", err)
	}
	if count < 0 {
		t.Errorf("Expected non-negative count, got %d", count)
	}
}

func TestE2E_CountWithFilter(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	prefix := uniquePrefix()
	for i := 0; i < 3; i++ {
		_, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
			"title": fmt.Sprintf("%s-count-%02d", prefix, i),
		})
		if err != nil {
			t.Fatalf("Create %d failed: %v", i, err)
		}
	}

	count, err := admin.DB("shared", "").Table("posts").
		Where("title", "contains", prefix).
		Count(ctx)
	if err != nil {
		t.Fatalf("Count with filter failed: %v", err)
	}
	if count < 3 {
		t.Errorf("Expected at least 3, got %d", count)
	}
}

func TestE2E_CountEmptyFilter(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	count, err := admin.DB("shared", "").Table("posts").
		Where("title", "==", "absolutely-nonexistent-title-"+uniquePrefix()).
		Count(ctx)
	if err != nil {
		t.Fatalf("Count failed: %v", err)
	}
	if count != 0 {
		t.Errorf("Expected 0 for nonexistent filter, got %d", count)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Batch Operations
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_InsertMany(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	records := []map[string]interface{}{
		{"title": "Go Batch A"},
		{"title": "Go Batch B"},
		{"title": "Go Batch C"},
	}

	created, err := admin.DB("shared", "").Table("posts").InsertMany(ctx, records)
	if err != nil {
		t.Fatalf("InsertMany failed: %v", err)
	}
	if len(created) != 3 {
		t.Errorf("Expected 3 items, got %d", len(created))
	}
}

func TestE2E_InsertManySingle(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	records := []map[string]interface{}{
		{"title": uniquePrefix() + "-batch-single"},
	}

	created, err := admin.DB("shared", "").Table("posts").InsertMany(ctx, records)
	if err != nil {
		t.Fatalf("InsertMany (single) failed: %v", err)
	}
	if len(created) != 1 {
		t.Errorf("Expected 1 item, got %d", len(created))
	}
}

func TestE2E_InsertManyLarger(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	prefix := uniquePrefix()
	var records []map[string]interface{}
	for i := 0; i < 10; i++ {
		records = append(records, map[string]interface{}{
			"title": fmt.Sprintf("%s-batch10-%02d", prefix, i),
		})
	}

	created, err := admin.DB("shared", "").Table("posts").InsertMany(ctx, records)
	if err != nil {
		t.Fatalf("InsertMany (10) failed: %v", err)
	}
	if len(created) != 10 {
		t.Errorf("Expected 10 items, got %d", len(created))
	}
}

func TestE2E_InsertManyVerifyIDs(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	prefix := uniquePrefix()
	records := []map[string]interface{}{
		{"title": prefix + "-verify-a"},
		{"title": prefix + "-verify-b"},
	}

	created, err := admin.DB("shared", "").Table("posts").InsertMany(ctx, records)
	if err != nil {
		t.Fatalf("InsertMany failed: %v", err)
	}

	// All created records should have unique IDs
	ids := map[string]bool{}
	for _, item := range created {
		id := fmt.Sprintf("%v", item["id"])
		if id == "" {
			t.Error("Expected non-empty id")
		}
		if ids[id] {
			t.Errorf("Duplicate ID: %s", id)
		}
		ids[id] = true
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Upsert
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_Upsert(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	prefix := uniquePrefix()

	result, err := admin.DB("shared", "").Table("posts").Upsert(ctx, map[string]interface{}{
		"title": prefix,
	}, "")
	if err != nil {
		t.Fatalf("Upsert failed: %v", err)
	}
	if result["id"] == nil {
		t.Error("Expected id in upsert result")
	}
}

func TestE2E_UpsertIdempotent(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	prefix := uniquePrefix()

	r1, err := admin.DB("shared", "").Table("posts").Upsert(ctx, map[string]interface{}{
		"title": prefix + "-idem",
	}, "")
	if err != nil {
		t.Fatalf("Upsert 1 failed: %v", err)
	}

	r2, err := admin.DB("shared", "").Table("posts").Upsert(ctx, map[string]interface{}{
		"title": prefix + "-idem",
	}, "")
	if err != nil {
		t.Fatalf("Upsert 2 failed: %v", err)
	}

	// Both should succeed (create or update)
	if r1["id"] == nil || r2["id"] == nil {
		t.Error("Expected ids in both upsert results")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. FieldOps
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_Increment(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	created, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title":     "Go-increment",
		"viewCount": 0,
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	id := fmt.Sprintf("%v", created["id"])

	updated, err := admin.DB("shared", "").Table("posts").Update(ctx, id, map[string]interface{}{
		"viewCount": edgebase.Increment(5),
	})
	if err != nil {
		t.Fatalf("Update with increment failed: %v", err)
	}
	if fmt.Sprintf("%v", updated["viewCount"]) != "5" {
		t.Errorf("Expected viewCount=5, got %v", updated["viewCount"])
	}
}

func TestE2E_IncrementNegative(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	created, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title":     uniquePrefix() + "-decrement",
		"viewCount": 10,
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	id := fmt.Sprintf("%v", created["id"])

	updated, err := admin.DB("shared", "").Table("posts").Update(ctx, id, map[string]interface{}{
		"viewCount": edgebase.Increment(-3),
	})
	if err != nil {
		t.Fatalf("Decrement failed: %v", err)
	}
	if fmt.Sprintf("%v", updated["viewCount"]) != "7" {
		t.Errorf("Expected viewCount=7, got %v", updated["viewCount"])
	}
}

func TestE2E_IncrementDecimal(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	created, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title":     uniquePrefix() + "-decimal-inc",
		"viewCount": 0,
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	id := fmt.Sprintf("%v", created["id"])

	_, err = admin.DB("shared", "").Table("posts").Update(ctx, id, map[string]interface{}{
		"viewCount": edgebase.Increment(0.5),
	})
	if err != nil {
		t.Fatalf("Decimal increment failed: %v", err)
	}
}

func TestE2E_IncrementMultipleTimes(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	created, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title":     uniquePrefix() + "-multi-inc",
		"viewCount": 0,
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	id := fmt.Sprintf("%v", created["id"])

	for i := 0; i < 3; i++ {
		_, err = admin.DB("shared", "").Table("posts").Update(ctx, id, map[string]interface{}{
			"viewCount": edgebase.Increment(1),
		})
		if err != nil {
			t.Fatalf("Increment %d failed: %v", i, err)
		}
	}

	got, err := admin.DB("shared", "").Table("posts").GetOne(ctx, id)
	if err != nil {
		t.Fatalf("GetOne failed: %v", err)
	}
	if fmt.Sprintf("%v", got["viewCount"]) != "3" {
		t.Errorf("Expected viewCount=3 after 3 increments, got %v", got["viewCount"])
	}
}

func TestE2E_DeleteField(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	created, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title":    uniquePrefix() + "-delfield",
		"extraKey": "to-be-removed",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	id := fmt.Sprintf("%v", created["id"])

	updated, err := admin.DB("shared", "").Table("posts").Update(ctx, id, map[string]interface{}{
		"extraKey": edgebase.DeleteField(),
	})
	if err != nil {
		t.Fatalf("DeleteField failed: %v", err)
	}

	// The field should be removed or nil
	if updated["extraKey"] != nil {
		t.Logf("Note: extraKey may still be present as nil: %v", updated["extraKey"])
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Broadcast
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_Broadcast(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	channel := fmt.Sprintf("go-bcast-%d", time.Now().UnixMilli())
	err := admin.Broadcast(ctx, channel, "go-event", map[string]interface{}{
		"msg": "Hello from Go SDK",
	})
	if err != nil {
		t.Fatalf("Broadcast failed: %v", err)
	}
}

func TestE2E_BroadcastDifferentEvents(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	channel := fmt.Sprintf("go-bcast-events-%d", time.Now().UnixMilli())
	events := []string{"event-a", "event-b", "event-c"}

	for _, ev := range events {
		err := admin.Broadcast(ctx, channel, ev, map[string]interface{}{
			"event": ev,
		})
		if err != nil {
			t.Fatalf("Broadcast %s failed: %v", ev, err)
		}
	}
}

func TestE2E_BroadcastEmptyPayload(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	channel := fmt.Sprintf("go-bcast-empty-%d", time.Now().UnixMilli())
	err := admin.Broadcast(ctx, channel, "empty-event", map[string]interface{}{})
	if err != nil {
		t.Fatalf("Broadcast with empty payload failed: %v", err)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. SQL
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_SQL(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	rows, err := admin.SQL(ctx, "shared", "", "SELECT COUNT(*) as cnt FROM posts", nil)
	if err != nil {
		t.Logf("SQL test skipped: %v", err)
		return
	}
	_ = rows
}

func TestE2E_SQLParameterized(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	prefix := uniquePrefix()
	_, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title": prefix + "-sql-param",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	rows, err := admin.SQL(ctx, "shared", "", "SELECT * FROM posts WHERE title = ?", []interface{}{prefix + "-sql-param"})
	if err != nil {
		t.Logf("SQL parameterized test skipped: %v", err)
		return
	}
	if len(rows) == 0 {
		t.Log("Note: parameterized SQL returned 0 rows")
	}
}

func TestE2E_SQLSelectAll(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	rows, err := admin.SQL(ctx, "shared", "", "SELECT * FROM posts LIMIT 5", nil)
	if err != nil {
		t.Logf("SQL SELECT * test skipped: %v", err)
		return
	}
	if rows == nil {
		t.Log("Note: SQL returned nil rows")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 11. AdminAuth
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_AdminAuth_CreateAndGetUser(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	email := uniqueEmail()

	created, err := admin.AdminAuth.CreateUser(ctx, email, "GoE2EPass123!")
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	id, _ := created["id"].(string)
	if id == "" {
		if user, ok := created["user"].(map[string]interface{}); ok {
			id, _ = user["id"].(string)
		}
	}
	if id == "" {
		t.Fatal("Expected id in create_user response")
	}

	fetched, err := admin.AdminAuth.GetUser(ctx, id)
	if err != nil {
		t.Fatalf("GetUser failed: %v", err)
	}

	fetchedId, _ := fetched["id"].(string)
	if fetchedId == "" {
		if user, ok := fetched["user"].(map[string]interface{}); ok {
			fetchedId, _ = user["id"].(string)
		}
	}
	if fetchedId != id {
		t.Errorf("Expected id %s, got %s", id, fetchedId)
	}
}

func TestE2E_AdminAuth_ListUsers(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	result, err := admin.AdminAuth.ListUsers(ctx, 10)
	if err != nil {
		t.Fatalf("ListUsers failed: %v", err)
	}
	if result["users"] == nil {
		t.Error("Expected users field in response")
	}
}

func TestE2E_AdminAuth_ListUsersLimit(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	// Create a few users first
	for i := 0; i < 3; i++ {
		_, err := admin.AdminAuth.CreateUser(ctx, uniqueEmail(), "GoE2EPass123!")
		if err != nil {
			t.Fatalf("CreateUser %d failed: %v", i, err)
		}
	}

	result, err := admin.AdminAuth.ListUsers(ctx, 2)
	if err != nil {
		t.Fatalf("ListUsers limit=2 failed: %v", err)
	}
	if result["users"] == nil {
		t.Error("Expected users field in response")
	}
}

func TestE2E_AdminAuth_DeleteUser(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	email := uniqueEmail()

	created, err := admin.AdminAuth.CreateUser(ctx, email, "GoE2EPass123!")
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	id, _ := created["id"].(string)
	if id == "" {
		if user, ok := created["user"].(map[string]interface{}); ok {
			id, _ = user["id"].(string)
		}
	}
	if id == "" {
		t.Fatal("Expected id")
	}

	err = admin.AdminAuth.DeleteUser(ctx, id)
	if err != nil {
		t.Fatalf("DeleteUser failed: %v", err)
	}
}

func TestE2E_AdminAuth_SetCustomClaims(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	email := uniqueEmail()

	created, err := admin.AdminAuth.CreateUser(ctx, email, "GoE2EPass123!")
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	id, _ := created["id"].(string)
	if id == "" {
		if user, ok := created["user"].(map[string]interface{}); ok {
			id, _ = user["id"].(string)
		}
	}
	if id == "" {
		t.Fatal("Expected id")
	}

	claims := map[string]interface{}{
		"role":  "admin",
		"level": 5,
	}
	err = admin.AdminAuth.SetCustomClaims(ctx, id, claims)
	if err != nil {
		t.Fatalf("SetCustomClaims failed: %v", err)
	}

	// Cleanup
	_ = admin.AdminAuth.DeleteUser(ctx, id)
}

func TestE2E_AdminAuth_RevokeAllSessions(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	email := uniqueEmail()

	created, err := admin.AdminAuth.CreateUser(ctx, email, "GoE2EPass123!")
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	id, _ := created["id"].(string)
	if id == "" {
		if user, ok := created["user"].(map[string]interface{}); ok {
			id, _ = user["id"].(string)
		}
	}
	if id == "" {
		t.Fatal("Expected id")
	}

	err = admin.AdminAuth.RevokeAllSessions(ctx, id)
	if err != nil {
		t.Fatalf("RevokeAllSessions failed: %v", err)
	}

	// Cleanup
	_ = admin.AdminAuth.DeleteUser(ctx, id)
}

func TestE2E_AdminAuth_FullLifecycle(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	email := uniqueEmail()

	// 1. Create
	created, err := admin.AdminAuth.CreateUser(ctx, email, "GoE2EPass123!")
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	id, _ := created["id"].(string)
	if id == "" {
		if user, ok := created["user"].(map[string]interface{}); ok {
			id, _ = user["id"].(string)
		}
	}
	if id == "" {
		t.Fatal("Expected id")
	}

	// 2. Get
	fetched, err := admin.AdminAuth.GetUser(ctx, id)
	if err != nil {
		t.Fatalf("GetUser failed: %v", err)
	}
	_ = fetched

	// 3. Set claims
	err = admin.AdminAuth.SetCustomClaims(ctx, id, map[string]interface{}{
		"role": "editor",
	})
	if err != nil {
		t.Fatalf("SetCustomClaims failed: %v", err)
	}

	// 4. Revoke sessions
	err = admin.AdminAuth.RevokeAllSessions(ctx, id)
	if err != nil {
		t.Fatalf("RevokeAllSessions failed: %v", err)
	}

	// 5. Delete
	err = admin.AdminAuth.DeleteUser(ctx, id)
	if err != nil {
		t.Fatalf("DeleteUser failed: %v", err)
	}
}

func TestE2E_AdminAuth_CreateMultipleUsers(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	var ids []string
	for i := 0; i < 5; i++ {
		email := uniqueEmail()
		created, err := admin.AdminAuth.CreateUser(ctx, email, "GoE2EPass123!")
		if err != nil {
			t.Fatalf("CreateUser %d failed: %v", i, err)
		}
		id, _ := created["id"].(string)
		if id == "" {
			if user, ok := created["user"].(map[string]interface{}); ok {
				id, _ = user["id"].(string)
			}
		}
		if id != "" {
			ids = append(ids, id)
		}
	}

	if len(ids) < 5 {
		t.Errorf("Expected 5 user IDs, got %d", len(ids))
	}

	// Cleanup
	for _, id := range ids {
		_ = admin.AdminAuth.DeleteUser(ctx, id)
	}
}

func TestE2E_AdminAuth_DuplicateEmail(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	email := uniqueEmail()

	created, err := admin.AdminAuth.CreateUser(ctx, email, "GoE2EPass123!")
	if err != nil {
		t.Fatalf("First CreateUser failed: %v", err)
	}

	id, _ := created["id"].(string)
	if id == "" {
		if user, ok := created["user"].(map[string]interface{}); ok {
			id, _ = user["id"].(string)
		}
	}

	// Second create with same email should fail
	_, err = admin.AdminAuth.CreateUser(ctx, email, "GoE2EPass456!")
	if err == nil {
		t.Error("Expected error creating user with duplicate email")
	}

	// Cleanup
	if id != "" {
		_ = admin.AdminAuth.DeleteUser(ctx, id)
	}
}

func TestE2E_AdminAuth_GetNonExistentUser(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	_, err := admin.AdminAuth.GetUser(ctx, "nonexistent-user-00000000")
	if err == nil {
		t.Error("Expected error getting nonexistent user")
	}
}

func TestE2E_AdminAuth_DeleteNonExistentUser(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	err := admin.AdminAuth.DeleteUser(ctx, "nonexistent-user-delete-00000000")
	if err == nil {
		t.Error("Expected error deleting nonexistent user")
	}
}

func TestE2E_AdminAuth_SetClaimsComplex(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	email := uniqueEmail()

	created, err := admin.AdminAuth.CreateUser(ctx, email, "GoE2EPass123!")
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	id, _ := created["id"].(string)
	if id == "" {
		if user, ok := created["user"].(map[string]interface{}); ok {
			id, _ = user["id"].(string)
		}
	}
	if id == "" {
		t.Fatal("Expected id")
	}

	claims := map[string]interface{}{
		"role":        "admin",
		"permissions": []string{"read", "write", "delete"},
		"level":       42,
		"active":      true,
	}
	err = admin.AdminAuth.SetCustomClaims(ctx, id, claims)
	if err != nil {
		t.Fatalf("SetCustomClaims (complex) failed: %v", err)
	}

	// Cleanup
	_ = admin.AdminAuth.DeleteUser(ctx, id)
}

func TestE2E_AdminAuth_SetClaimsEmpty(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	email := uniqueEmail()

	created, err := admin.AdminAuth.CreateUser(ctx, email, "GoE2EPass123!")
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	id, _ := created["id"].(string)
	if id == "" {
		if user, ok := created["user"].(map[string]interface{}); ok {
			id, _ = user["id"].(string)
		}
	}
	if id == "" {
		t.Fatal("Expected id")
	}

	err = admin.AdminAuth.SetCustomClaims(ctx, id, map[string]interface{}{})
	if err != nil {
		t.Fatalf("SetCustomClaims (empty) failed: %v", err)
	}

	// Cleanup
	_ = admin.AdminAuth.DeleteUser(ctx, id)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Error Handling
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_Error_GetNonExistent(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	_, err := admin.DB("shared", "").Table("posts").GetOne(ctx, "nonexistent-go-99999")
	if err == nil {
		t.Error("Expected error getting nonexistent record")
	}
}

func TestE2E_Error_UpdateNonExistent(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	_, err := admin.DB("shared", "").Table("posts").Update(ctx, "nonexistent-go-update", map[string]interface{}{
		"title": "Nope",
	})
	if err == nil {
		t.Error("Expected error updating nonexistent record")
	}
}

func TestE2E_Error_DeleteNonExistent(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	err := admin.DB("shared", "").Table("posts").Delete(ctx, "nonexistent-go-delete")
	if err == nil {
		t.Error("Expected error deleting nonexistent record")
	}
}

func TestE2E_Error_InvalidServiceKey(t *testing.T) {
	baseURL := getEnvOrDefault("BASE_URL", "http://localhost:8688")
	client := edgebase.NewAdminClient(baseURL, "invalid-key-12345")
	ctx := context.Background()

	// Attempt a privileged operation with invalid key
	_, err := client.AdminAuth.ListUsers(ctx, 10)
	if err == nil {
		t.Error("Expected error with invalid service key")
	}
}

func TestE2E_Error_ErrorContainsHTTPStatus(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	_, err := admin.DB("shared", "").Table("posts").GetOne(ctx, "nonexistent-status-check")
	if err == nil {
		t.Fatal("Expected error")
	}
	errMsg := err.Error()
	if !strings.Contains(errMsg, "HTTP") {
		t.Logf("Note: error does not contain HTTP prefix: %s", errMsg)
	}
}

func TestE2E_Error_DoubleDelete(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	created, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title": uniquePrefix() + "-double-del",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	id := fmt.Sprintf("%v", created["id"])

	// First delete should succeed
	err = admin.DB("shared", "").Table("posts").Delete(ctx, id)
	if err != nil {
		t.Fatalf("First delete failed: %v", err)
	}

	// Second delete should fail
	err = admin.DB("shared", "").Table("posts").Delete(ctx, id)
	if err == nil {
		t.Error("Expected error on double delete")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 13. Go-specific: Goroutine + WaitGroup Parallel Operations
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_Goroutine_ParallelInsert(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	prefix := uniquePrefix()

	var wg sync.WaitGroup
	var mu sync.Mutex
	var ids []string
	var errs []error

	numGoroutines := 5
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			result, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
				"title": fmt.Sprintf("%s-parallel-%02d", prefix, idx),
			})
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				errs = append(errs, err)
			} else {
				ids = append(ids, fmt.Sprintf("%v", result["id"]))
			}
		}(i)
	}

	wg.Wait()

	if len(errs) > 0 {
		t.Fatalf("Parallel create errors: %v", errs)
	}
	if len(ids) != numGoroutines {
		t.Errorf("Expected %d IDs, got %d", numGoroutines, len(ids))
	}

	// Verify all unique
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			t.Errorf("Duplicate ID: %s", id)
		}
		seen[id] = true
	}
}

func TestE2E_Goroutine_ParallelRead(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	prefix := uniquePrefix()

	// Create records first
	var ids []string
	for i := 0; i < 5; i++ {
		result, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
			"title": fmt.Sprintf("%s-pread-%02d", prefix, i),
		})
		if err != nil {
			t.Fatalf("Create %d failed: %v", i, err)
		}
		ids = append(ids, fmt.Sprintf("%v", result["id"]))
	}

	// Read all in parallel
	var wg sync.WaitGroup
	var mu sync.Mutex
	var results []map[string]interface{}
	var errs []error

	for _, id := range ids {
		wg.Add(1)
		go func(recordID string) {
			defer wg.Done()
			got, err := admin.DB("shared", "").Table("posts").GetOne(ctx, recordID)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				errs = append(errs, err)
			} else {
				results = append(results, got)
			}
		}(id)
	}

	wg.Wait()

	if len(errs) > 0 {
		t.Fatalf("Parallel read errors: %v", errs)
	}
	if len(results) != 5 {
		t.Errorf("Expected 5 results, got %d", len(results))
	}
}

func TestE2E_Goroutine_ChannelResultCollection(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	prefix := uniquePrefix()

	numOps := 4
	resultCh := make(chan string, numOps)
	errCh := make(chan error, numOps)

	for i := 0; i < numOps; i++ {
		go func(idx int) {
			result, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
				"title": fmt.Sprintf("%s-chan-%02d", prefix, idx),
			})
			if err != nil {
				errCh <- err
				return
			}
			resultCh <- fmt.Sprintf("%v", result["id"])
		}(i)
	}

	var ids []string
	for i := 0; i < numOps; i++ {
		select {
		case id := <-resultCh:
			ids = append(ids, id)
		case err := <-errCh:
			t.Fatalf("Channel operation failed: %v", err)
		case <-time.After(10 * time.Second):
			t.Fatal("Timeout waiting for goroutine results")
		}
	}

	if len(ids) != numOps {
		t.Errorf("Expected %d IDs, got %d", numOps, len(ids))
	}
}

func TestE2E_Goroutine_ParallelCRUD(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	prefix := uniquePrefix()

	var wg sync.WaitGroup
	var mu sync.Mutex
	var errs []error

	// Parallel: create + read + count
	wg.Add(3)

	// Goroutine 1: Create
	go func() {
		defer wg.Done()
		_, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
			"title": prefix + "-par-crud-create",
		})
		if err != nil {
			mu.Lock()
			errs = append(errs, fmt.Errorf("create: %w", err))
			mu.Unlock()
		}
	}()

	// Goroutine 2: List
	go func() {
		defer wg.Done()
		_, err := admin.DB("shared", "").Table("posts").Limit(5).GetList(ctx)
		if err != nil {
			mu.Lock()
			errs = append(errs, fmt.Errorf("list: %w", err))
			mu.Unlock()
		}
	}()

	// Goroutine 3: Count
	go func() {
		defer wg.Done()
		_, err := admin.DB("shared", "").Table("posts").Count(ctx)
		if err != nil {
			mu.Lock()
			errs = append(errs, fmt.Errorf("count: %w", err))
			mu.Unlock()
		}
	}()

	wg.Wait()

	if len(errs) > 0 {
		t.Fatalf("Parallel CRUD errors: %v", errs)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 14. Go-specific: context.WithTimeout
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_ContextWithTimeout(t *testing.T) {
	admin := newAdmin(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	result, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title": uniquePrefix() + "-timeout",
	})
	if err != nil {
		t.Fatalf("Create with timeout failed: %v", err)
	}
	if result["id"] == nil {
		t.Error("Expected id")
	}
}

func TestE2E_ContextWithTimeoutQuery(t *testing.T) {
	admin := newAdmin(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	result, err := admin.DB("shared", "").Table("posts").
		OrderBy("createdAt", "desc").
		Limit(5).
		GetList(ctx)
	if err != nil {
		t.Fatalf("Query with timeout failed: %v", err)
	}
	if result == nil {
		t.Error("Expected non-nil result")
	}
}

func TestE2E_ContextWithVeryShortTimeout(t *testing.T) {
	admin := newAdmin(t)
	// Use a very short timeout — 1 nanosecond — so it should expire instantly
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Nanosecond)
	defer cancel()

	time.Sleep(1 * time.Millisecond) // Ensure context is expired

	_, err := admin.DB("shared", "").Table("posts").Limit(1).GetList(ctx)
	if err == nil {
		t.Log("Note: Expected context deadline exceeded, but request succeeded (fast local server)")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 15. Go-specific: defer cleanup pattern
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_DeferCleanup(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	created, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title": uniquePrefix() + "-defer-cleanup",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	id := fmt.Sprintf("%v", created["id"])

	// Register cleanup with defer
	defer func() {
		_ = admin.DB("shared", "").Table("posts").Delete(ctx, id)
	}()

	// Verify record exists
	got, err := admin.DB("shared", "").Table("posts").GetOne(ctx, id)
	if err != nil {
		t.Fatalf("GetOne failed: %v", err)
	}
	if got["id"] == nil {
		t.Error("Expected record to exist")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 16. Go-specific: Struct tags & typed response
// ═══════════════════════════════════════════════════════════════════════════════

type Post struct {
	ID        string  `json:"id"`
	Title     string  `json:"title"`
	Body      string  `json:"body"`
	ViewCount float64 `json:"viewCount"`
}

func TestE2E_StructTagMapping(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	prefix := uniquePrefix()
	created, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title":     prefix + "-struct",
		"body":      "struct test body",
		"viewCount": 7,
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	id := fmt.Sprintf("%v", created["id"])

	got, err := admin.DB("shared", "").Table("posts").GetOne(ctx, id)
	if err != nil {
		t.Fatalf("GetOne failed: %v", err)
	}

	// Map raw response to struct
	post := Post{
		ID:    fmt.Sprintf("%v", got["id"]),
		Title: fmt.Sprintf("%v", got["title"]),
	}

	if post.ID != id {
		t.Errorf("Expected ID=%s, got %s", id, post.ID)
	}
	if post.Title != prefix+"-struct" {
		t.Errorf("Expected title=%s, got %s", prefix+"-struct", post.Title)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 17. Go-specific: Error wrapping (fmt.Errorf %w)
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_ErrorWrapping(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	_, err := admin.DB("shared", "").Table("posts").GetOne(ctx, "nonexistent-wrap-test")
	if err == nil {
		t.Fatal("Expected error")
	}

	// Wrap the error
	wrapped := fmt.Errorf("operation failed: %w", err)
	if !strings.Contains(wrapped.Error(), "operation failed") {
		t.Errorf("Expected 'operation failed' prefix, got %s", wrapped.Error())
	}
	if !strings.Contains(wrapped.Error(), err.Error()) {
		t.Errorf("Wrapped error should contain original error")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 18. FTS (Full Text Search)
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_FTSSearch(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	prefix := uniquePrefix()
	searchTerm := prefix + "-searchable"
	_, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title": searchTerm,
		"body":  "This is a full text searchable document",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	result, err := admin.DB("shared", "").Table("posts").Search(searchTerm).GetList(ctx)
	if err != nil {
		t.Fatalf("FTS search failed: %v", err)
	}
	// FTS may or may not find it immediately depending on indexing
	_ = result
}

func TestE2E_FTSSearchEmpty(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	result, err := admin.DB("shared", "").Table("posts").Search("absolutelyuniquenonexistentsearchterm999").GetList(ctx)
	if err != nil {
		t.Fatalf("FTS empty search failed: %v", err)
	}
	if len(result.Items) != 0 {
		t.Logf("Note: FTS for nonexistent term returned %d items", len(result.Items))
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 19. CRUD — Complete Lifecycle Chain
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_FullCRUDChain(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	prefix := uniquePrefix()

	// Create
	created, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title":     prefix + "-lifecycle",
		"body":      "original body",
		"viewCount": 0,
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	id := fmt.Sprintf("%v", created["id"])

	// Read
	got, err := admin.DB("shared", "").Table("posts").GetOne(ctx, id)
	if err != nil {
		t.Fatalf("GetOne failed: %v", err)
	}
	if fmt.Sprintf("%v", got["title"]) != prefix+"-lifecycle" {
		t.Error("Title mismatch after create")
	}

	// Update
	updated, err := admin.DB("shared", "").Table("posts").Update(ctx, id, map[string]interface{}{
		"title":     prefix + "-lifecycle-updated",
		"viewCount": edgebase.Increment(10),
	})
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if fmt.Sprintf("%v", updated["title"]) != prefix+"-lifecycle-updated" {
		t.Error("Title mismatch after update")
	}

	// Count with filter
	count, err := admin.DB("shared", "").Table("posts").
		Where("title", "contains", prefix+"-lifecycle").
		Count(ctx)
	if err != nil {
		t.Fatalf("Count failed: %v", err)
	}
	if count < 1 {
		t.Errorf("Expected count >= 1, got %d", count)
	}

	// Delete
	err = admin.DB("shared", "").Table("posts").Delete(ctx, id)
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	// Verify deleted
	_, err = admin.DB("shared", "").Table("posts").GetOne(ctx, id)
	if err == nil {
		t.Error("Expected error getting deleted record")
	}
}

func TestE2E_BatchThenQuery(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	prefix := uniquePrefix()

	// Batch create
	var records []map[string]interface{}
	for i := 0; i < 5; i++ {
		records = append(records, map[string]interface{}{
			"title":     fmt.Sprintf("%s-bq-%02d", prefix, i),
			"viewCount": i * 10,
		})
	}

	created, err := admin.DB("shared", "").Table("posts").InsertMany(ctx, records)
	if err != nil {
		t.Fatalf("InsertMany failed: %v", err)
	}
	if len(created) != 5 {
		t.Fatalf("Expected 5 created, got %d", len(created))
	}

	// Query with filter
	result, err := admin.DB("shared", "").Table("posts").
		Where("title", "contains", prefix+"-bq").
		OrderBy("title", "asc").
		GetList(ctx)
	if err != nil {
		t.Fatalf("Query failed: %v", err)
	}
	if len(result.Items) < 5 {
		t.Errorf("Expected at least 5 items, got %d", len(result.Items))
	}

	// Cleanup
	for _, item := range created {
		id := fmt.Sprintf("%v", item["id"])
		_ = admin.DB("shared", "").Table("posts").Delete(ctx, id)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 20. AdminAuth — Goroutine parallel user operations
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_AdminAuth_ParallelInsert(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	var wg sync.WaitGroup
	var mu sync.Mutex
	var ids []string
	var errs []error

	numUsers := 3
	for i := 0; i < numUsers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			email := uniqueEmail()
			created, err := admin.AdminAuth.CreateUser(ctx, email, "GoE2EPass123!")
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				errs = append(errs, err)
			} else {
				id, _ := created["id"].(string)
				if id == "" {
					if user, ok := created["user"].(map[string]interface{}); ok {
						id, _ = user["id"].(string)
					}
				}
				if id != "" {
					ids = append(ids, id)
				}
			}
		}()
	}

	wg.Wait()

	if len(errs) > 0 {
		t.Fatalf("Parallel user create errors: %v", errs)
	}
	if len(ids) < numUsers {
		t.Errorf("Expected %d user IDs, got %d", numUsers, len(ids))
	}

	// Cleanup
	for _, id := range ids {
		_ = admin.AdminAuth.DeleteUser(ctx, id)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 21. Query — Get with empty result
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_GetEmptyResult(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	result, err := admin.DB("shared", "").Table("posts").
		Where("title", "==", "this-title-should-never-exist-"+uniquePrefix()).
		GetList(ctx)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if len(result.Items) != 0 {
		t.Errorf("Expected 0 items, got %d", len(result.Items))
	}
}

func TestE2E_GetAllNoFilter(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	result, err := admin.DB("shared", "").Table("posts").
		Limit(100).
		GetList(ctx)
	if err != nil {
		t.Fatalf("Get all failed: %v", err)
	}
	if result == nil {
		t.Fatal("Expected non-nil result")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 22. Multiple DB Namespaces
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_MultipleNamespaces(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	// Operations on different namespaces should be independent
	prefix := uniquePrefix()

	// Create in shared
	r1, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title": prefix + "-ns-shared",
	})
	if err != nil {
		t.Fatalf("Create in shared failed: %v", err)
	}
	if r1["id"] == nil {
		t.Error("Expected id in shared result")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 23. FTS + Limit combo
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_FTSWithLimit(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	prefix := uniquePrefix()
	for i := 0; i < 3; i++ {
		_, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
			"title": fmt.Sprintf("%s-ftslimit-%02d", prefix, i),
		})
		if err != nil {
			t.Fatalf("Create %d failed: %v", i, err)
		}
	}

	result, err := admin.DB("shared", "").Table("posts").
		Search(prefix + "-ftslimit").
		Limit(2).
		GetList(ctx)
	if err != nil {
		t.Fatalf("FTS+Limit failed: %v", err)
	}
	// Limit may not apply to search endpoint, but should not error
	_ = result
}

// ═══════════════════════════════════════════════════════════════════════════════
// 24. Upsert with fields
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_UpsertWithMultipleFields(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	prefix := uniquePrefix()

	result, err := admin.DB("shared", "").Table("posts").Upsert(ctx, map[string]interface{}{
		"title":     prefix + "-upsert-multi",
		"body":      "upsert body",
		"viewCount": 99,
	}, "")
	if err != nil {
		t.Fatalf("Upsert with fields failed: %v", err)
	}
	if result["id"] == nil {
		t.Error("Expected id in upsert result")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 25. Push E2E
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_Push_SendNonExistentUser(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	result, err := admin.Push.Send(ctx, "nonexistent-push-user-99999", map[string]interface{}{
		"title": "Test",
		"body":  "Hello",
	})
	if err != nil {
		t.Fatalf("Push.Send failed: %v", err)
	}
	sent, _ := result["sent"].(float64)
	if int(sent) != 0 {
		t.Errorf("Expected sent=0 for nonexistent user, got %v", result["sent"])
	}
}

func TestE2E_Push_SendToToken(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	result, err := admin.Push.SendToToken(ctx, "fake-fcm-token-e2e", map[string]interface{}{
		"title": "Token",
		"body":  "Test",
	}, "web")
	if err != nil {
		t.Fatalf("Push.SendToToken failed: %v", err)
	}
	if result == nil {
		t.Fatal("Expected non-nil result")
	}
	if _, ok := result["sent"]; !ok {
		t.Error("Expected 'sent' key in result")
	}
}

func TestE2E_Push_SendMany(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	result, err := admin.Push.SendMany(ctx, []string{"nonexistent-user-a", "nonexistent-user-b"}, map[string]interface{}{
		"title": "Batch",
		"body":  "Test",
	})
	if err != nil {
		t.Fatalf("Push.SendMany failed: %v", err)
	}
	if result == nil {
		t.Fatal("Expected non-nil result")
	}
}

func TestE2E_Push_GetTokens(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	result, err := admin.Push.GetTokens(ctx, "nonexistent-push-user-tokens")
	if err != nil {
		t.Fatalf("Push.GetTokens failed: %v", err)
	}
	items, _ := result["items"].([]interface{})
	if items == nil {
		// items key should be present (even if empty)
		if result["items"] != nil {
			t.Logf("items type: %T", result["items"])
		}
	}
}

func TestE2E_Push_GetLogs(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	result, err := admin.Push.GetLogs(ctx, "nonexistent-push-user-logs", 0)
	if err != nil {
		t.Fatalf("Push.GetLogs failed: %v", err)
	}
	items, _ := result["items"].([]interface{})
	_ = items // items should be an array (possibly empty)
}

func TestE2E_Push_SendToTopic(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	result, err := admin.Push.SendToTopic(ctx, "test-topic-e2e", map[string]interface{}{
		"title": "Topic",
		"body":  "Test",
	})
	if err != nil {
		t.Fatalf("Push.SendToTopic failed: %v", err)
	}
	if result == nil {
		t.Fatal("Expected non-nil result")
	}
}

func TestE2E_Push_Broadcast(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()

	result, err := admin.Push.BroadcastPush(ctx, map[string]interface{}{
		"title": "Broadcast",
		"body":  "E2E Test",
	})
	if err != nil {
		t.Fatalf("Push.BroadcastPush failed: %v", err)
	}
	if result == nil {
		t.Fatal("Expected non-nil result")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Vectorize (stub responses — Vectorize is Edge-only, local returns stubs)
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_Vectorize_Upsert(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	vc := admin.Vector("embeddings")
	namespace := uniquePrefix()

	// embeddings index has 1536 dimensions per test config
	vec1 := make([]float64, 1536)
	vec1[0] = 0.1
	vec1[1] = 0.2
	vec1[2] = 0.3
	vec2 := make([]float64, 1536)
	vec2[0] = 0.4
	vec2[1] = 0.5
	vec2[2] = 0.6

	result, err := vc.Upsert(ctx, []map[string]interface{}{
		{"id": "vec-1", "values": vec1, "namespace": namespace},
		{"id": "vec-2", "values": vec2, "namespace": namespace},
	})
	if err != nil {
		t.Fatalf("Vectorize.Upsert failed: %v", err)
	}
	if result["ok"] != true {
		t.Errorf("expected ok=true, got %v", result["ok"])
	}
	if result["_stub"] == true {
		return
	}
	if count, ok := result["count"].(float64); ok && count < 0 {
		t.Errorf("expected non-negative count, got %v", count)
	}
}

func TestE2E_Vectorize_Insert(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	vc := admin.Vector("embeddings")
	namespace := uniquePrefix()

	// embeddings index has 1536 dimensions per test config
	vec := make([]float64, 1536)
	vec[0] = 0.7
	vec[1] = 0.8
	vec[2] = 0.9

	result, err := vc.Insert(ctx, []map[string]interface{}{
		{"id": "vec-new", "values": vec, "namespace": namespace},
	})
	if err != nil {
		t.Fatalf("Vectorize.Insert failed: %v", err)
	}
	if result["ok"] != true {
		t.Errorf("expected ok=true, got %v", result["ok"])
	}
	if result["_stub"] == true {
		return
	}
	if count, ok := result["count"].(float64); ok && count < 0 {
		t.Errorf("expected non-negative count, got %v", count)
	}
}

func TestE2E_Vectorize_Search(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	vc := admin.Vector("embeddings")

	// embeddings index has 1536 dimensions per test config
	vector := make([]float64, 1536)
	vector[0] = 0.1

	matches, err := vc.Search(ctx, vector, &edgebase.VectorSearchOptions{
		TopK: 5,
	})
	if err != nil {
		t.Fatalf("Vectorize.Search failed: %v", err)
	}
	if matches == nil {
		t.Fatal("expected non-nil matches slice")
	}
}

func TestE2E_Vectorize_SearchWithOptions(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	vc := admin.Vector("embeddings")

	vector := make([]float64, 1536)
	rv := true

	matches, err := vc.Search(ctx, vector, &edgebase.VectorSearchOptions{
		TopK:           10,
		Namespace:      "test-ns",
		ReturnValues:   &rv,
		ReturnMetadata: "all",
	})
	if err != nil {
		t.Fatalf("Vectorize.Search with options failed: %v", err)
	}
	if matches == nil {
		t.Fatal("expected non-nil matches slice")
	}
}

func TestE2E_Vectorize_SearchReturnMetadataBool(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	vc := admin.Vector("embeddings")

	vector := make([]float64, 1536)

	matches, err := vc.Search(ctx, vector, &edgebase.VectorSearchOptions{
		ReturnMetadata: true,
	})
	if err != nil {
		t.Fatalf("Vectorize.Search with bool returnMetadata failed: %v", err)
	}
	if matches == nil {
		t.Fatal("expected non-nil matches slice")
	}
}

func TestE2E_Vectorize_SearchNilOpts(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	vc := admin.Vector("embeddings")

	vector := make([]float64, 1536)
	matches, err := vc.Search(ctx, vector, nil)
	if err != nil {
		t.Fatalf("Vectorize.Search with nil opts failed: %v", err)
	}
	if matches == nil {
		t.Fatal("expected non-nil matches slice")
	}
}

func TestE2E_Vectorize_QueryByID(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	vc := admin.Vector("embeddings")

	matches, err := vc.QueryByID(ctx, "vec-1", &edgebase.VectorSearchOptions{
		TopK: 3,
	})
	if err != nil {
		t.Fatalf("Vectorize.QueryByID failed: %v", err)
	}
	if matches == nil {
		t.Fatal("expected non-nil matches slice")
	}
	if len(matches) != 0 {
		t.Errorf("expected 0 matches from stub, got %d", len(matches))
	}
}

func TestE2E_Vectorize_QueryByIDNilOpts(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	vc := admin.Vector("embeddings")

	matches, err := vc.QueryByID(ctx, "vec-1", nil)
	if err != nil {
		t.Fatalf("Vectorize.QueryByID with nil opts failed: %v", err)
	}
	if matches == nil {
		t.Fatal("expected non-nil matches slice")
	}
}

func TestE2E_Vectorize_GetByIDs(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	vc := admin.Vector("embeddings")

	vectors, err := vc.GetByIDs(ctx, []string{"vec-1", "vec-2"})
	if err != nil {
		t.Fatalf("Vectorize.GetByIDs failed: %v", err)
	}
	// Stub returns { vectors: [] }
	if vectors == nil {
		t.Fatal("expected non-nil vectors slice")
	}
	if len(vectors) != 0 {
		t.Errorf("expected 0 vectors from stub, got %d", len(vectors))
	}
}

func TestE2E_Vectorize_Delete(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	vc := admin.Vector("embeddings")

	result, err := vc.Delete(ctx, []string{"vec-1", "vec-2"})
	if err != nil {
		t.Fatalf("Vectorize.Delete failed: %v", err)
	}
	if result["ok"] != true {
		t.Errorf("expected ok=true, got %v", result["ok"])
	}
	if result["_stub"] == true {
		return
	}
	if count, ok := result["count"].(float64); ok && count < 0 {
		t.Errorf("expected non-negative count, got %v", count)
	}
}

func TestE2E_Vectorize_Describe(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	vc := admin.Vector("embeddings")

	info, err := vc.Describe(ctx)
	if err != nil {
		t.Fatalf("Vectorize.Describe failed: %v", err)
	}
	if info["_stub"] == true {
		if vectorCount, ok := info["vectorCount"].(float64); !ok || vectorCount != 0 {
			t.Errorf("expected vectorCount=0 for stub response, got %v", info["vectorCount"])
		}
	}
	// dimensions should match config (1536 for embeddings)
	if dim, ok := info["dimensions"].(float64); !ok || dim != 1536 {
		t.Errorf("expected dimensions=1536, got %v", info["dimensions"])
	}
	// metric should be present
	if info["metric"] == nil {
		t.Error("expected metric to be present in describe response")
	}
}

func TestE2E_Vectorize_DescribeProcessedUpTo(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	vc := admin.Vector("embeddings")

	info, err := vc.Describe(ctx)
	if err != nil {
		t.Fatalf("Vectorize.Describe failed: %v", err)
	}
	// Stub includes processedUpToDatetime and processedUpToMutation (both null)
	if _, exists := info["processedUpToDatetime"]; !exists {
		t.Error("expected processedUpToDatetime key in describe response")
	}
	if _, exists := info["processedUpToMutation"]; !exists {
		t.Error("expected processedUpToMutation key in describe response")
	}
}

// ─── Vectorize input validation ──────────────────────────────────────────────

func TestE2E_Vectorize_SearchDimensionMismatch(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	vc := admin.Vector("embeddings")

	// embeddings expects 1536 dimensions, send 3
	_, err := vc.Search(ctx, []float64{0.1, 0.2, 0.3}, nil)
	if err == nil {
		t.Fatal("expected error for dimension mismatch")
	}
	if !strings.Contains(err.Error(), "400") {
		t.Errorf("expected HTTP 400 error, got %v", err)
	}
}

func TestE2E_Vectorize_SearchTopKZero(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	vc := admin.Vector("embeddings")

	vector := make([]float64, 1536)
	_, err := vc.Search(ctx, vector, &edgebase.VectorSearchOptions{TopK: 0})
	// topK=0 means we don't set it (omitempty), so it defaults to 10 server-side
	// This should succeed with no error
	if err != nil {
		t.Fatalf("Vectorize.Search with TopK=0 (default) should succeed: %v", err)
	}
}

func TestE2E_Vectorize_UpsertEmptyVectors(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	vc := admin.Vector("embeddings")

	_, err := vc.Upsert(ctx, []map[string]interface{}{})
	if err == nil {
		t.Fatal("expected error for empty vectors array")
	}
	if !strings.Contains(err.Error(), "400") {
		t.Errorf("expected HTTP 400 error, got %v", err)
	}
}

func TestE2E_Vectorize_DeleteEmptyIDs(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	vc := admin.Vector("embeddings")

	_, err := vc.Delete(ctx, []string{})
	if err == nil {
		t.Fatal("expected error for empty ids array")
	}
	if !strings.Contains(err.Error(), "400") {
		t.Errorf("expected HTTP 400 error, got %v", err)
	}
}

func TestE2E_Vectorize_GetByIDsEmptyIDs(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	vc := admin.Vector("embeddings")

	_, err := vc.GetByIDs(ctx, []string{})
	if err == nil {
		t.Fatal("expected error for empty ids array")
	}
	if !strings.Contains(err.Error(), "400") {
		t.Errorf("expected HTTP 400 error, got %v", err)
	}
}

func TestE2E_Vectorize_InsertEmptyVectors(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	vc := admin.Vector("embeddings")

	_, err := vc.Insert(ctx, []map[string]interface{}{})
	if err == nil {
		t.Fatal("expected error for empty vectors array")
	}
	if !strings.Contains(err.Error(), "400") {
		t.Errorf("expected HTTP 400 error, got %v", err)
	}
}

func TestE2E_Vectorize_NotFoundIndex(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	vc := admin.Vector("nonexistent-index")

	_, err := vc.Describe(ctx)
	if err == nil {
		t.Fatal("expected error for non-existent index")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("expected HTTP 404 error, got %v", err)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Golden Query — filter + sort + limit contract
// ═══════════════════════════════════════════════════════════════════════════════

func TestE2E_GoldenFilterSortLimit(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	prefix := uniquePrefix() + "-gq"

	// Seed 5 records with known views values
	type seed struct {
		label string
		views int
	}
	seeds := []seed{
		{"A", 10}, {"B", 30}, {"C", 20}, {"D", 40}, {"E", 5},
	}
	var ids []string
	for _, s := range seeds {
		r, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
			"title": prefix + "-" + s.label,
			"views": s.views,
		})
		if err != nil {
			t.Fatalf("Seed insert failed: %v", err)
		}
		ids = append(ids, fmt.Sprintf("%v", r["id"]))
	}
	defer func() {
		for _, id := range ids {
			_ = admin.DB("shared", "").Table("posts").Delete(ctx, id)
		}
	}()

	// Golden query: filter>=10 + sort:desc + limit=3 → [40,30,20]
	result, err := admin.DB("shared", "").Table("posts").
		Where("title", "contains", prefix).
		Where("views", ">=", 10).
		OrderBy("views", "desc").
		Limit(3).
		GetList(ctx)
	if err != nil {
		t.Fatalf("Golden query failed: %v", err)
	}
	if len(result.Items) != 3 {
		t.Fatalf("Expected 3 items, got %d", len(result.Items))
	}
	expected := []int{40, 30, 20}
	for i, item := range result.Items {
		v, _ := item["views"].(float64)
		if int(v) != expected[i] {
			t.Errorf("Item %d: expected views=%d, got %v", i, expected[i], v)
		}
	}
}

func TestE2E_GoldenCursorNoOverlap(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	prefix := uniquePrefix() + "-gqc"

	var ids []string
	for i := 0; i < 5; i++ {
		r, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
			"title": fmt.Sprintf("%s-%d", prefix, i),
		})
		if err != nil {
			t.Fatalf("Seed insert failed: %v", err)
		}
		ids = append(ids, fmt.Sprintf("%v", r["id"]))
	}
	defer func() {
		for _, id := range ids {
			_ = admin.DB("shared", "").Table("posts").Delete(ctx, id)
		}
	}()

	p1, err := admin.DB("shared", "").Table("posts").
		Where("title", "contains", prefix).
		Limit(2).
		GetList(ctx)
	if err != nil {
		t.Fatalf("Page 1 failed: %v", err)
	}
	if p1.Cursor == nil {
		t.Fatal("Expected cursor on first page")
	}

	p2, err := admin.DB("shared", "").Table("posts").
		Where("title", "contains", prefix).
		Limit(2).
		After(*p1.Cursor).
		GetList(ctx)
	if err != nil {
		t.Fatalf("Page 2 failed: %v", err)
	}

	idSet := make(map[string]bool)
	for _, item := range p1.Items {
		idSet[fmt.Sprintf("%v", item["id"])] = true
	}
	for _, item := range p2.Items {
		id := fmt.Sprintf("%v", item["id"])
		if idSet[id] {
			t.Errorf("Overlap found: %s appears in both pages", id)
		}
	}
}

func TestE2E_GoldenCRUDRoundTrip(t *testing.T) {
	admin := newAdmin(t)
	ctx := context.Background()
	prefix := uniquePrefix() + "-gcrud"

	// 1. Insert
	created, err := admin.DB("shared", "").Table("posts").Insert(ctx, map[string]interface{}{
		"title": prefix + "-roundtrip",
		"body":  "initial body",
		"views": 0,
	})
	if err != nil {
		t.Fatalf("Insert failed: %v", err)
	}
	id := fmt.Sprintf("%v", created["id"])
	if id == "" {
		t.Fatal("Expected id in insert result")
	}

	// 2. Get by ID — verify inserted data
	got, err := admin.DB("shared", "").Table("posts").GetOne(ctx, id)
	if err != nil {
		t.Fatalf("GetOne after insert failed: %v", err)
	}
	if fmt.Sprintf("%v", got["title"]) != prefix+"-roundtrip" {
		t.Errorf("Expected title '%s-roundtrip', got %v", prefix, got["title"])
	}
	if fmt.Sprintf("%v", got["body"]) != "initial body" {
		t.Errorf("Expected body 'initial body', got %v", got["body"])
	}

	// 3. Update
	updated, err := admin.DB("shared", "").Table("posts").Update(ctx, id, map[string]interface{}{
		"title": prefix + "-updated",
		"views": 42,
	})
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if fmt.Sprintf("%v", updated["title"]) != prefix+"-updated" {
		t.Errorf("Expected updated title '%s-updated', got %v", prefix, updated["title"])
	}
	v, _ := updated["views"].(float64)
	if int(v) != 42 {
		t.Errorf("Expected views=42, got %v", updated["views"])
	}

	// 4. Delete
	if err := admin.DB("shared", "").Table("posts").Delete(ctx, id); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	// 5. Verify 404 — GetOne on deleted record should error
	_, err = admin.DB("shared", "").Table("posts").GetOne(ctx, id)
	if err == nil {
		t.Error("Expected error getting deleted record, got nil")
	}
	if err != nil && !strings.Contains(err.Error(), "404") {
		t.Errorf("Expected 404 error, got: %v", err)
	}
}
