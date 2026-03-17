package dev.edgebase.sdk.scala.admin

import org.junit.jupiter.api.Assertions._
import org.junit.jupiter.api.Test

import scala.jdk.CollectionConverters._

class AdminEdgeBaseUnitTest {

  @Test
  def exposesAdminSurface(): Unit = {
    val admin = AdminEdgeBase("https://dummy.edgebase.fun/", "sk-test")

    assertNotNull(admin.adminAuth)
    assertNotNull(admin.storage)
    assertNotNull(admin.functions)
    assertNotNull(admin.analytics)
    assertNotNull(admin.kv("cache"))
    assertNotNull(admin.d1("analytics"))
    assertNotNull(admin.vector("embeddings"))
    assertNotNull(admin.push())
    assertEquals("shared", admin.db().namespace)

    admin.destroy()
  }

  @Test
  def tableBuilderRemainsImmutable(): Unit = {
    val admin = AdminEdgeBase("https://dummy.edgebase.fun", "sk-test")
    val original = admin.table("posts")
    val filtered = original.where("status", "==", "published")
    val sorted = filtered.orderBy("createdAt", "desc")

    assertNotSame(original, filtered)
    assertNotSame(filtered, sorted)
    assertEquals("posts", original.name)

    admin.destroy()
  }

  @Test
  def contextRoundTrips(): Unit = {
    val admin = AdminEdgeBase("https://dummy.edgebase.fun", "sk-test")

    admin.setContext(Map("tenantId" -> "tenant-1", "role" -> "admin"))

    assertEquals(Some("tenant-1"), admin.context.get("tenantId"))
    assertEquals(Some("admin"), admin.context.get("role"))

    admin.destroy()
  }

  @Test
  def exposesExpectedPublicMethods(): Unit = {
    val methodNames = classOf[AdminEdgeBase].getMethods.map(_.getName).toSet
    val expected = Set(
      "adminAuth",
      "auth",
      "storage",
      "functions",
      "analytics",
      "table",
      "db",
      "sql",
      "broadcast",
      "setContext",
      "getContext",
      "kv",
      "d1",
      "vector",
      "vectorize",
      "push",
      "destroy",
    )

    assertTrue(expected.subsetOf(methodNames), s"Missing methods: ${(expected -- methodNames).mkString(", ")}")
  }

  @Test
  def helperClientsExposeCompleteSurface(): Unit = {
    val functionMethods = classOf[FunctionsClient].getMethods.map(_.getName).toSet
    assertTrue(Set("call", "get", "post", "put", "patch", "delete").subsetOf(functionMethods))

    val analyticsMethods = classOf[AnalyticsClient].getMethods.map(_.getName).toSet
    assertTrue(Set("overview", "timeSeries", "breakdown", "topEndpoints", "track", "trackBatch", "queryEvents").subsetOf(analyticsMethods))

    val vectorMethods = classOf[VectorClient].getMethods.map(_.getName).toSet
    assertTrue(Set("upsert", "insert", "search", "queryById", "getByIds", "delete", "describe").subsetOf(vectorMethods))

    val pushMethods = classOf[PushClient].getMethods.map(_.getName).toSet
    assertTrue(Set("send", "sendMany", "sendToToken", "getTokens", "getLogs", "sendToTopic", "broadcast").subsetOf(pushMethods))
  }
}
