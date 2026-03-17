package dev.edgebase.sdk.scala.admin

import org.junit.jupiter.api.Assertions._
import org.junit.jupiter.api.{AfterEach, Assumptions, Test}

import java.net.{HttpURLConnection, URL}
import scala.collection.mutable.ListBuffer

class AdminEdgeBaseE2ETest {
  private val baseUrl = sys.env.getOrElse("BASE_URL", "http://localhost:8688")
  private val serviceKey =
    sys.env.getOrElse("SERVICE_KEY", sys.env.getOrElse("EDGEBASE_SERVICE_KEY", "test-service-key-for-admin"))

  private var admin: AdminEdgeBase = _
  private val createdIds = ListBuffer.empty[String]

  @AfterEach
  def cleanup(): Unit = {
    if (admin != null) {
      createdIds.foreach { id =>
        try admin.db("shared").table("posts").doc(id).delete()
        catch { case _: Throwable => () }
      }
      createdIds.clear()
      admin.destroy()
      admin = null
    }
  }

  @Test
  def adminAuthListUsersReturnsUsersArray(): Unit = {
    requireServer()
    val result = admin.adminAuth.listUsers(limit = Some(5))
    assertTrue(result.contains("users"))
  }

  @Test
  def adminAuthCreateAndGetUser(): Unit = {
    requireServer()
    val created = admin.adminAuth.createUser(Map("email" -> uniqueEmail(), "password" -> "ScalaAdmin123!"))
    val userId = extractUserId(created)
    assertNotNull(userId)

    try {
      val fetched = admin.adminAuth.getUser(userId)
      assertEquals(userId, extractUserId(fetched))
    } finally {
      try admin.adminAuth.deleteUser(userId)
      catch { case _: Throwable => () }
    }
  }

  @Test
  def adminAuthUpdateUserChangesDisplayName(): Unit = {
    requireServer()
    val created = admin.adminAuth.createUser(Map("email" -> uniqueEmail(), "password" -> "ScalaAdmin123!"))
    val userId = extractUserId(created)
    assertNotNull(userId)

    try {
      val updated = admin.adminAuth.updateUser(userId, Map("displayName" -> "Scala Admin"))
      assertEquals(userId, extractUserId(updated))
    } finally {
      try admin.adminAuth.deleteUser(userId)
      catch { case _: Throwable => () }
    }
  }

  @Test
  def adminAuthSetCustomClaimsSucceeds(): Unit = {
    requireServer()
    val created = admin.adminAuth.createUser(Map("email" -> uniqueEmail(), "password" -> "ScalaAdmin123!"))
    val userId = extractUserId(created)
    assertNotNull(userId)

    try {
      val result = admin.adminAuth.setCustomClaims(userId, Map("role" -> "admin", "tier" -> "pro"))
      assertNotNull(result)
    } finally {
      try admin.adminAuth.deleteUser(userId)
      catch { case _: Throwable => () }
    }
  }

  @Test
  def adminAuthRevokeAllSessionsSucceeds(): Unit = {
    requireServer()
    val created = admin.adminAuth.createUser(Map("email" -> uniqueEmail(), "password" -> "ScalaAdmin123!"))
    val userId = extractUserId(created)
    assertNotNull(userId)

    try {
      val result = admin.adminAuth.revokeAllSessions(userId)
      assertNotNull(result)
    } finally {
      try admin.adminAuth.deleteUser(userId)
      catch { case _: Throwable => () }
    }
  }

  @Test
  def adminAuthDeleteUserRemovesRecord(): Unit = {
    requireServer()
    val created = admin.adminAuth.createUser(Map("email" -> uniqueEmail(), "password" -> "ScalaAdmin123!"))
    val userId = extractUserId(created)
    assertNotNull(userId)

    admin.adminAuth.deleteUser(userId)
    assertThrows(classOf[Throwable], () => admin.adminAuth.getUser(userId))
  }

  @Test
  def insertAndFetchRecord(): Unit = {
    requireServer()

    val now = System.currentTimeMillis()
    val created = admin.db("shared").table("posts").insert(
      Map(
        "slug" -> s"scala-admin-$now",
        "runId" -> s"scala-admin-$now",
        "title" -> s"scala-admin-$now",
        "notes" -> s"scala admin smoke $now",
        "status" -> "draft",
        "views" -> 1,
        "sequence" -> 1,
        "isPublished" -> false,
        "sdk" -> "scala",
      )
    )
    val id = created("id").asInstanceOf[String]
    createdIds += id

    val fetched = admin.db("shared").table("posts").getOne(id)
    assertEquals(id, fetched("id"))
  }

  @Test
  def sqlReturnsRows(): Unit = {
    requireServer()
    val rows = admin.sql(query = "SELECT 1 AS value")
    assertNotNull(rows)
  }

  private def requireServer(): Unit = {
    val available = isServerAvailable(baseUrl)
    val message =
      s"E2E backend not reachable at $baseUrl. Start `edgebase dev --port 8688` or set BASE_URL. Set EDGEBASE_E2E_REQUIRED=1 to fail instead of skip."

    if (sys.env.get("EDGEBASE_E2E_REQUIRED").contains("1")) {
      assertTrue(available, message)
    } else {
      Assumptions.assumeTrue(available, message)
    }

    admin = AdminEdgeBase(baseUrl, serviceKey)
  }

  private def uniqueEmail(): String =
    s"scala-admin-${System.currentTimeMillis()}-${math.abs(util.Random.nextInt())}@test.com"

  private def extractUserId(value: Map[String, Any]): String =
    value.get("id")
      .orElse(value.get("user").collect { case user: Map[_, _] => user.asInstanceOf[Map[String, Any]].get("id") }.flatten)
      .map(_.toString)
      .getOrElse(throw new AssertionError("Missing user id in admin auth response"))

  private def isServerAvailable(url: String): Boolean =
    try {
      val connection = new URL(s"${url.replaceAll("/+$", "")}/api/health").openConnection().asInstanceOf[HttpURLConnection]
      connection.setRequestMethod("GET")
      connection.setConnectTimeout(1500)
      connection.setReadTimeout(1500)
      val statusCode = connection.getResponseCode
      statusCode >= 200 && statusCode < 500
    } catch {
      case _: Throwable => false
    }
}
