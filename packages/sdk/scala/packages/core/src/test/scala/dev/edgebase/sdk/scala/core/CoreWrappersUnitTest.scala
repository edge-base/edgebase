package dev.edgebase.sdk.scala.core

import org.junit.jupiter.api.Assertions._
import org.junit.jupiter.api.Test

class CoreWrappersUnitTest {

  @Test
  def convertsNestedJavaCollections(): Unit = {
    val raw = new java.util.LinkedHashMap[String, Object]()
    raw.put("id", "post-1")
    raw.put("views", Int.box(42))
    raw.put("tags", java.util.Arrays.asList("edgebase", "scala"))

    val converted = ScalaConverters.toScalaMap(raw)

    assertEquals("post-1", converted("id"))
    assertEquals(42, converted("views"))
    assertEquals(List("edgebase", "scala"), converted("tags"))
  }

  @Test
  def wrapsJavaListResult(): Unit = {
    val firstItem = new java.util.LinkedHashMap[String, Object]()
    firstItem.put("id", "row-1")
    firstItem.put("title", "hello")
    val items = java.util.List.of(firstItem.asInstanceOf[java.util.Map[String, Object]])
    val javaResult = new dev.edgebase.sdk.core.ListResult(items, Int.box(1), Int.box(1), Int.box(20), null, null)

    val result = ListResult.fromJava(javaResult)

    assertEquals(List(Map("id" -> "row-1", "title" -> "hello")), result.items)
    assertEquals(Some(1), result.total)
    assertEquals(Some(1), result.page)
    assertEquals(Some(20), result.perPage)
  }

  @Test
  def exposesCoreWrapperSurface(): Unit = {
    val tableMethods = classOf[TableRef].getMethods.map(_.getName).toSet
    assertTrue(
      Set(
        "name",
        "where",
        "or",
        "orderBy",
        "limit",
        "offset",
        "page",
        "search",
        "after",
        "before",
        "getList",
        "getOne",
        "getFirst",
        "insert",
        "upsert",
        "count",
        "insertMany",
        "upsertMany",
        "updateMany",
        "deleteMany",
        "doc",
        "onSnapshot",
      ).subsetOf(tableMethods),
    )

    val storageMethods = classOf[StorageBucket].getMethods.map(_.getName).toSet
    assertTrue(
      Set(
        "name",
        "upload",
        "uploadString",
        "download",
        "delete",
        "list",
        "url",
        "metadata",
        "updateMetadata",
        "createSignedUrl",
        "createSignedUploadUrl",
        "initiateResumableUpload",
        "resumeUpload",
      ).subsetOf(storageMethods),
    )

    val docMethods = classOf[DocRef].getMethods.map(_.getName).toSet
    assertTrue(Set("collectionName", "id", "get", "update", "delete", "onSnapshot").subsetOf(docMethods))
  }
}
