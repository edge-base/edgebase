// EdgeBase Java SDK — List query result.
package dev.edgebase.sdk.core;

import java.util.List;
import java.util.Map;

/**
 * List query result — unified type for both offset and cursor pagination.
 *
 * <p>
 * Offset mode (default): total/page/perPage are populated, hasMore/cursor are
 * null.
 * <p>
 * Cursor mode (.after/.before): hasMore/cursor are populated,
 * total/page/perPage are null.
 */
public class ListResult {
    private final List<Map<String, Object>> items;
    private final Integer total;
    private final Integer page;
    private final Integer perPage;
    private final Boolean hasMore;
    private final String cursor;

    public ListResult(List<Map<String, Object>> items, Integer total, Integer page,
            Integer perPage, Boolean hasMore, String cursor) {
        this.items = items;
        this.total = total;
        this.page = page;
        this.perPage = perPage;
        this.hasMore = hasMore;
        this.cursor = cursor;
    }

    public List<Map<String, Object>> getItems() {
        return items;
    }

    public Integer getTotal() {
        return total;
    }

    public Integer getPage() {
        return page;
    }

    public Integer getPerPage() {
        return perPage;
    }

    public Boolean getHasMore() {
        return hasMore;
    }

    public String getCursor() {
        return cursor;
    }
}
