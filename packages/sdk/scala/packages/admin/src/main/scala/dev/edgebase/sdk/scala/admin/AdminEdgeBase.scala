package dev.edgebase.sdk.scala.admin

import dev.edgebase.sdk.admin.{AdminAuthClient => JavaAdminAuthClient}
import dev.edgebase.sdk.admin.{AnalyticsClient => JavaAnalyticsClient}
import dev.edgebase.sdk.admin.{D1Client => JavaD1Client}
import dev.edgebase.sdk.admin.{FunctionsClient => JavaFunctionsClient}
import dev.edgebase.sdk.admin.{KvClient => JavaKvClient}
import dev.edgebase.sdk.admin.{PushClient => JavaPushClient}
import dev.edgebase.sdk.admin.{VectorizeClient => JavaVectorizeClient}
import dev.edgebase.sdk.admin.generated.GeneratedAdminApi
import dev.edgebase.sdk.core.{ContextManager => JavaContextManager}
import dev.edgebase.sdk.core.{DbRef => JavaDbRef}
import dev.edgebase.sdk.core.{HttpClient => JavaHttpClient}
import dev.edgebase.sdk.core.{StorageClient => JavaStorageClient}
import dev.edgebase.sdk.core.{TokenManager => JavaTokenManager}
import dev.edgebase.sdk.core.generated.GeneratedDbApi
import dev.edgebase.sdk.scala.core._

import scala.jdk.CollectionConverters._

final case class FunctionCallOptions(
    method: String = "POST",
    body: Map[String, Any] = Map.empty,
    query: Map[String, String] = Map.empty,
)

final case class AnalyticsEvent(
    name: String,
    properties: Map[String, Any] = Map.empty,
    timestamp: Option[Long] = None,
    userId: Option[String] = None,
)

final class AdminAuthClient private[admin] (private val underlying: JavaAdminAuthClient) {
  def getUser(userId: String): Map[String, Any] = ScalaConverters.toScalaMap(underlying.getUser(userId))

  def listUsers(limit: Option[Int] = None, cursor: Option[String] = None): Map[String, Any] =
    ScalaConverters.toScalaMap(underlying.listUsers(limit.map(Int.box).orNull, cursor.orNull))

  def createUser(data: Map[String, Any]): Map[String, Any] =
    ScalaConverters.toScalaMap(underlying.createUser(ScalaConverters.toJavaMap(data)))

  def updateUser(userId: String, data: Map[String, Any]): Map[String, Any] =
    ScalaConverters.toScalaMap(underlying.updateUser(userId, ScalaConverters.toJavaMap(data)))

  def deleteUser(userId: String): Unit = underlying.deleteUser(userId)

  def setCustomClaims(userId: String, claims: Map[String, Any]): Map[String, Any] =
    ScalaConverters.toScalaMap(underlying.setCustomClaims(userId, ScalaConverters.toJavaMap(claims)))

  def revokeAllSessions(userId: String): Map[String, Any] =
    ScalaConverters.toScalaMap(underlying.revokeAllSessions(userId))
}

final class KvClient private[admin] (private val underlying: JavaKvClient) {
  def get(key: String): Option[String] = Option(underlying.get(key))
  def set(key: String, value: String, ttlSeconds: Option[Int] = None): Unit =
    ttlSeconds match {
      case Some(ttl) => underlying.set(key, value, ttl)
      case None => underlying.set(key, value)
    }
  def delete(key: String): Unit = underlying.delete(key)
  def list(prefix: String = "", limit: Int = 100, cursor: Option[String] = None): Map[String, Any] =
    ScalaConverters.toScalaMap(underlying.list(prefix, limit, cursor.orNull))
}

final class D1Client private[admin] (private val underlying: JavaD1Client) {
  def exec(query: String, params: Seq[Any] = Seq.empty): List[Any] =
    ScalaConverters.toScalaList(underlying.exec(query, ScalaConverters.toJavaList(params)))
}

final class VectorClient private[admin] (private val underlying: JavaVectorizeClient) {
  def upsert(vectors: Seq[Map[String, Any]]): Map[String, Any] =
    ScalaConverters.toScalaMap(underlying.upsert(vectors.map(ScalaConverters.toJavaMap).asJava))

  def insert(vectors: Seq[Map[String, Any]]): Map[String, Any] =
    ScalaConverters.toScalaMap(underlying.insert(vectors.map(ScalaConverters.toJavaMap).asJava))

  def search(vector: Seq[Double], topK: Int = 10, filter: Map[String, Any] = Map.empty): List[Map[String, Any]] = {
    val javaFilter = if (filter.isEmpty) null else ScalaConverters.toJavaMap(filter)
    underlying.search(vector.map(Double.box).asJava, topK, javaFilter).asScala.toList.map(ScalaConverters.toScalaMap)
  }

  def queryById(vectorId: String, topK: Int = 10, filter: Map[String, Any] = Map.empty): List[Map[String, Any]] = {
    val javaFilter = if (filter.isEmpty) null else ScalaConverters.toJavaMap(filter)
    underlying.queryById(vectorId, topK, javaFilter).asScala.toList.map(ScalaConverters.toScalaMap)
  }

  def getByIds(ids: Seq[String]): List[Map[String, Any]] =
    underlying.getByIds(ids.asJava).asScala.toList.map(ScalaConverters.toScalaMap)

  def delete(ids: Seq[String]): Map[String, Any] =
    ScalaConverters.toScalaMap(underlying.delete(ids.asJava))

  def describe(): Map[String, Any] = ScalaConverters.toScalaMap(underlying.describe())
}

final class FunctionsClient private[admin] (private val underlying: JavaFunctionsClient) {
  def call(path: String, options: FunctionCallOptions = FunctionCallOptions()): Any =
    ScalaConverters.toScala(
      underlying.call(
        path,
        new JavaFunctionsClient.FunctionCallOptions(
          options.method,
          if (options.body.isEmpty) null else ScalaConverters.toJavaMap(options.body),
          if (options.query.isEmpty) null else ScalaConverters.toJavaStringMap(options.query),
        ),
      ),
    )

  def get(path: String, query: Map[String, String] = Map.empty): Any =
    ScalaConverters.toScala(underlying.get(path, if (query.isEmpty) null else ScalaConverters.toJavaStringMap(query)))

  def post(path: String, body: Map[String, Any] = Map.empty): Any =
    ScalaConverters.toScala(underlying.post(path, ScalaConverters.toJavaMap(body)))

  def put(path: String, body: Map[String, Any]): Any =
    ScalaConverters.toScala(underlying.put(path, ScalaConverters.toJavaMap(body)))

  def patch(path: String, body: Map[String, Any]): Any =
    ScalaConverters.toScala(underlying.patch(path, ScalaConverters.toJavaMap(body)))

  def delete(path: String): Any =
    ScalaConverters.toScala(underlying.delete(path))
}

final class AnalyticsClient private[admin] (private val underlying: JavaAnalyticsClient) {
  def overview(options: Map[String, String] = Map.empty): Map[String, Any] =
    ScalaConverters.toScalaMap(
      if (options.isEmpty) underlying.overview()
      else underlying.overview(ScalaConverters.toJavaStringMap(options)),
    )

  def timeSeries(options: Map[String, String] = Map.empty): List[Map[String, Any]] =
    (if (options.isEmpty) underlying.timeSeries() else underlying.timeSeries(ScalaConverters.toJavaStringMap(options)))
      .asScala
      .toList
      .map(ScalaConverters.toScalaMap)

  def breakdown(options: Map[String, String] = Map.empty): List[Map[String, Any]] =
    (if (options.isEmpty) underlying.breakdown() else underlying.breakdown(ScalaConverters.toJavaStringMap(options)))
      .asScala
      .toList
      .map(ScalaConverters.toScalaMap)

  def topEndpoints(options: Map[String, String] = Map.empty): List[Map[String, Any]] =
    (if (options.isEmpty) underlying.topEndpoints() else underlying.topEndpoints(ScalaConverters.toJavaStringMap(options)))
      .asScala
      .toList
      .map(ScalaConverters.toScalaMap)

  def track(name: String, properties: Map[String, Any] = Map.empty, userId: Option[String] = None): Unit =
    underlying.track(name, ScalaConverters.toJavaMap(properties), userId.orNull)

  def trackBatch(events: Seq[AnalyticsEvent]): Unit =
    underlying.trackBatch(
      events.map(event =>
        new JavaAnalyticsClient.AnalyticsEvent(
          event.name,
          ScalaConverters.toJavaMap(event.properties),
          event.timestamp.map(Long.box).orNull,
          event.userId.orNull,
        ),
      ).asJava,
    )

  def queryEvents(options: Map[String, String] = Map.empty): Any =
    ScalaConverters.toScala(
      if (options.isEmpty) underlying.queryEvents()
      else underlying.queryEvents(ScalaConverters.toJavaStringMap(options)),
    )
}

final class PushClient private[admin] (private val underlying: JavaPushClient) {
  def send(userId: String, payload: Map[String, Any]): Map[String, Any] =
    ScalaConverters.toScalaMap(underlying.send(userId, ScalaConverters.toJavaMap(payload)))

  def sendMany(userIds: Seq[String], payload: Map[String, Any]): Map[String, Any] =
    ScalaConverters.toScalaMap(underlying.sendMany(userIds.asJava, ScalaConverters.toJavaMap(payload)))

  def sendToToken(token: String, payload: Map[String, Any], platform: String = "web"): Map[String, Any] =
    ScalaConverters.toScalaMap(underlying.sendToToken(token, ScalaConverters.toJavaMap(payload), platform))

  def getTokens(userId: String): List[Map[String, Any]] =
    underlying.getTokens(userId).asScala.toList.map(ScalaConverters.toScalaMap)

  def getLogs(userId: String, limit: Option[Int] = None): List[Map[String, Any]] =
    (limit match {
      case Some(value) => underlying.getLogs(userId, value)
      case None => underlying.getLogs(userId)
    }).asScala.toList.map(ScalaConverters.toScalaMap)

  def sendToTopic(topic: String, payload: Map[String, Any]): Map[String, Any] =
    ScalaConverters.toScalaMap(underlying.sendToTopic(topic, ScalaConverters.toJavaMap(payload)))

  def broadcast(payload: Map[String, Any]): Map[String, Any] =
    ScalaConverters.toScalaMap(underlying.broadcast(ScalaConverters.toJavaMap(payload)))
}

final class AdminEdgeBase private (
    val baseUrl: String,
    private val serviceKey: String,
    private val projectId: Option[String],
) {
  private val contextManager = new JavaContextManager()
  private val noOpTokenManager = new JavaTokenManager {
    override def getAccessToken(): String = null
    override def getRefreshToken(): String = null
    override def setTokens(access: String, refresh: String): Unit = ()
    override def clearTokens(): Unit = ()
  }

  private val httpClient = new JavaHttpClient(baseUrl, noOpTokenManager, contextManager, serviceKey, projectId.orNull)
  private val core = new GeneratedDbApi(httpClient)
  private val adminCore = new GeneratedAdminApi(httpClient)

  lazy val adminAuth: AdminAuthClient = new AdminAuthClient(new JavaAdminAuthClient(httpClient, serviceKey))
  lazy val auth: AdminAuthClient = adminAuth
  lazy val storage: StorageClient = new StorageClient(new JavaStorageClient(httpClient))
  lazy val functions: FunctionsClient = new FunctionsClient(new JavaFunctionsClient(httpClient))
  lazy val analytics: AnalyticsClient = new AnalyticsClient(new JavaAnalyticsClient(core, adminCore))

  def table(name: String): TableRef = db().table(name)

  def db(namespace: String = "shared"): DbRef =
    new DbRef(new JavaDbRef(core, namespace, null, null))

  def db(namespace: String, instanceId: String): DbRef =
    new DbRef(new JavaDbRef(core, namespace, instanceId, null))

  def sql(query: String): List[Any] =
    executeSql("shared", None, query, Seq.empty)

  def sql(namespace: String, query: String): List[Any] =
    executeSql(namespace, None, query, Seq.empty)

  def sql(namespace: String, query: String, params: Seq[Any]): List[Any] =
    executeSql(namespace, None, query, params)

  def sql(namespace: String, instanceId: String, query: String): List[Any] =
    executeSql(namespace, Some(instanceId), query, Seq.empty)

  def sql(namespace: String, instanceId: String, query: String, params: Seq[Any]): List[Any] =
    executeSql(namespace, Some(instanceId), query, params)

  def broadcast(channel: String, event: String): Unit =
    broadcast(channel, event, Map.empty)

  def broadcast(channel: String, event: String, payload: Map[String, Any]): Unit =
    adminCore.databaseLiveBroadcast(
      ScalaConverters.toJavaMap(
        Map(
          "channel" -> channel,
          "event" -> event,
          "payload" -> payload,
        ),
      ),
    )

  def setContext(context: Map[String, Any]): Unit =
    contextManager.setContext(ScalaConverters.toJavaMap(context))

  def context: Map[String, Any] = ScalaConverters.toScalaMap(contextManager.getContext())
  def getContext(): Map[String, Any] = context

  def kv(namespace: String): KvClient = new KvClient(new JavaKvClient(httpClient, namespace))
  def d1(database: String): D1Client = new D1Client(new JavaD1Client(httpClient, database))
  def vector(index: String): VectorClient = new VectorClient(new JavaVectorizeClient(httpClient, index))
  def vectorize(index: String): VectorClient = vector(index)
  def push(): PushClient = new PushClient(new JavaPushClient(httpClient))
  def destroy(): Unit = ()

  private def executeSql(namespace: String, instanceId: Option[String], query: String, params: Seq[Any]): List[Any] = {
    val body =
      Map(
        "namespace" -> namespace,
        "sql" -> query,
        "params" -> params.toList,
      ) ++ instanceId.map(id => "id" -> id)

    val result = adminCore.executeSql(ScalaConverters.toJavaMap(body))
    result match {
      case map: java.util.Map[_, _] =>
        ScalaConverters.toScalaMap(map).get("rows") match {
          case Some(rows: List[_]) => rows.asInstanceOf[List[Any]]
          case Some(items: Iterable[_]) => items.toList.asInstanceOf[List[Any]]
          case _ => List.empty
        }
      case list: java.util.List[_] =>
        ScalaConverters.toScalaList(list)
      case _ => List.empty
    }
  }
}

object AdminEdgeBase {
  def apply(url: String, serviceKey: String, projectId: Option[String] = None): AdminEdgeBase =
    new AdminEdgeBase(url.trim.stripSuffix("/"), serviceKey, projectId)
}

object EdgeBase {
  def admin(url: String, serviceKey: String, projectId: Option[String] = None): AdminEdgeBase =
    AdminEdgeBase(url, serviceKey, projectId)
}
