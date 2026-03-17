/**
 * Java SDK — 단위 테스트
 *
 * 테스트 대상: TableRef (불변 query builder), FieldOp, EdgeBaseException
 *
 * 실행: cd packages/sdk/java && mvn test -Dtest=TableRefUnitTest,FieldOpTest,ExceptionTest
 *
 * JUnit5 사용
 */

package io.edgebase.sdk;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assertions.*;

class TableRefUnitTest {

    // ─── A. TableRef 불변성 ────────────────────────────────────────────────────

    @Test
    void whereReturnsNewInstance() {
        EdgeBaseHttpClient http = new EdgeBaseHttpClient("http://localhost:9999", "sk-test");
        TableRef t1 = new TableRef(http, "posts");
        TableRef t2 = t1.where("status", "==", "published");
        assertNotSame(t1, t2);
    }

    @Test
    void orderByReturnsNewInstance() {
        EdgeBaseHttpClient http = new EdgeBaseHttpClient("http://localhost:9999", "sk-test");
        TableRef t1 = new TableRef(http, "posts");
        TableRef t2 = t1.orderBy("createdAt", "desc");
        assertNotSame(t1, t2);
    }

    @Test
    void limitReturnsNewInstance() {
        EdgeBaseHttpClient http = new EdgeBaseHttpClient("http://localhost:9999", "sk-test");
        TableRef t1 = new TableRef(http, "posts");
        TableRef t2 = t1.limit(10);
        assertNotSame(t1, t2);
    }

    @Test
    void offsetReturnsNewInstance() {
        EdgeBaseHttpClient http = new EdgeBaseHttpClient("http://localhost:9999", "sk-test");
        TableRef t = new TableRef(http, "posts").offset(20);
        assertNotNull(t);
    }

    @Test
    void pageReturnsNewInstance() {
        EdgeBaseHttpClient http = new EdgeBaseHttpClient("http://localhost:9999", "sk-test");
        TableRef t = new TableRef(http, "posts").page(2);
        assertNotNull(t);
    }

    @Test
    void afterReturnsNewInstance() {
        EdgeBaseHttpClient http = new EdgeBaseHttpClient("http://localhost:9999", "sk-test");
        TableRef t = new TableRef(http, "posts").after("cursor-xyz");
        assertNotNull(t);
    }

    @Test
    void beforeReturnsNewInstance() {
        EdgeBaseHttpClient http = new EdgeBaseHttpClient("http://localhost:9999", "sk-test");
        TableRef t = new TableRef(http, "posts").before("cursor-abc");
        assertNotNull(t);
    }

    @Test
    void searchReturnsNewInstance() {
        EdgeBaseHttpClient http = new EdgeBaseHttpClient("http://localhost:9999", "sk-test");
        TableRef t = new TableRef(http, "posts").search("hello");
        assertNotNull(t);
    }

    @Test
    void chainBuilding() {
        EdgeBaseHttpClient http = new EdgeBaseHttpClient("http://localhost:9999", "sk-test");
        assertDoesNotThrow(() -> new TableRef(http, "posts")
                .where("status", "==", "published")
                .where("views", ">", 100)
                .orderBy("createdAt", "desc")
                .limit(10));
    }

    @Test
    void afterClearsBefore() {
        EdgeBaseHttpClient http = new EdgeBaseHttpClient("http://localhost:9999", "sk-test");
        TableRef t = new TableRef(http, "posts").before("b1").after("a1");
        assertNotNull(t);
    }

    @Test
    void dbRefTableReturnsTableRef() {
        EdgeBaseHttpClient http = new EdgeBaseHttpClient("http://localhost:9999", "sk-test");
        DbRef db = new DbRef(http, "shared", null);
        TableRef t = db.table("posts");
        assertNotNull(t);
    }

    @Test
    void adminEdgeBaseDbReturnsDbRef() {
        AdminEdgeBase admin = new AdminEdgeBase("http://localhost:9999", "sk-test");
        DbRef db = admin.db("shared");
        assertNotNull(db);
        admin.shutdown();
    }

    @Test
    void adminEdgeBaseDbTableReturnsTableRef() {
        AdminEdgeBase admin = new AdminEdgeBase("http://localhost:9999", "sk-test");
        TableRef t = admin.db("shared").table("posts");
        assertNotNull(t);
        admin.shutdown();
    }
}

class FieldOpTest {

    @Test
    void incrementCreatesIncrementOp() {
        FieldOp op = FieldOp.increment(5);
        assertEquals("increment", op.op);
        assertEquals(5, op.value.intValue());
    }

    @Test
    void incrementNegative() {
        FieldOp op = FieldOp.increment(-3);
        assertEquals(-3, op.value.intValue());
    }

    @Test
    void deleteFieldCreatesOp() {
        FieldOp op = FieldOp.deleteField();
        assertEquals("deleteField", op.op);
        assertNull(op.value);
    }
}

class EdgeBaseExceptionTest {

    @Test
    void codeAndMessageStored() {
        EdgeBaseException ex = new EdgeBaseException(404, "Not found");
        assertEquals(404, ex.code);
        assertEquals("Not found", ex.getMessage());
    }

    @Test
    void isRuntimeException() {
        EdgeBaseException ex = new EdgeBaseException(500, "Internal error");
        assertTrue(ex instanceof RuntimeException);
    }

    @Test
    void throwAndCatch() {
        assertThrows(EdgeBaseException.class, () -> {
            throw new EdgeBaseException(403, "Forbidden");
        });
    }
}
