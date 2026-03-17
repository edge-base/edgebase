package dev.edgebase.sdk.scala.core

import dev.edgebase.sdk.core.{BatchResult => JavaBatchResult}
import dev.edgebase.sdk.core.{DbChange => JavaDbChange}
import dev.edgebase.sdk.core.{DbRef => JavaDbRef}
import dev.edgebase.sdk.core.{DocRef => JavaDocRef}
import dev.edgebase.sdk.core.{EdgeBaseError => JavaEdgeBaseError}
import dev.edgebase.sdk.core.{FileInfo => JavaFileInfo}
import dev.edgebase.sdk.core.{ListResult => JavaListResult}
import dev.edgebase.sdk.core.{DatabaseLiveClient => JavaDatabaseLiveClient}
import dev.edgebase.sdk.core.{SignedUrlResult => JavaSignedUrlResult}
import dev.edgebase.sdk.core.{StorageBucket => JavaStorageBucket}
import dev.edgebase.sdk.core.{StorageClient => JavaStorageClient}
import dev.edgebase.sdk.core.{TableRef => JavaTableRef}
import dev.edgebase.sdk.core.{UpsertResult => JavaUpsertResult}

import java.util.function.Consumer
import scala.jdk.CollectionConverters._

final case class EdgeBaseError(
    reason: String,
    statusCode: Int,
    details: Map[String, List[String]] = Map.empty,
) extends RuntimeException(reason)

object EdgeBaseError {
  def fromJava(error: JavaEdgeBaseError): EdgeBaseError = {
    val details =
      Option(error.getDetails)
        .map(_.asScala.iterator.map { case (key, value) =>
          key -> value.asScala.toList
        }.toMap)
        .getOrElse(Map.empty)
    EdgeBaseError(error.getMessage, error.getStatusCode, details)
  }
}

final case class ListResult(
    items: List[Map[String, Any]],
    total: Option[Int],
    page: Option[Int],
    perPage: Option[Int],
    hasMore: Option[Boolean],
    cursor: Option[String],
)

object ListResult {
  private[sdk] def fromJava(result: JavaListResult): ListResult =
    ListResult(
      items = Option(result.getItems).map(_.asScala.toList.map(ScalaConverters.toScalaMap)).getOrElse(Nil),
      total = Option(result.getTotal).map(_.intValue()),
      page = Option(result.getPage).map(_.intValue()),
      perPage = Option(result.getPerPage).map(_.intValue()),
      hasMore = Option(result.getHasMore).map(_.booleanValue()),
      cursor = Option(result.getCursor),
    )
}

final case class BatchResult(
    totalProcessed: Int,
    totalSucceeded: Int,
    errors: List[Map[String, Any]],
)

object BatchResult {
  private[sdk] def fromJava(result: JavaBatchResult): BatchResult =
    BatchResult(
      totalProcessed = result.getTotalProcessed,
      totalSucceeded = result.getTotalSucceeded,
      errors = Option(result.getErrors).map(_.asScala.toList.map(ScalaConverters.toScalaMap)).getOrElse(Nil),
    )
}

final case class UpsertResult(record: Map[String, Any], inserted: Boolean)

object UpsertResult {
  private[sdk] def fromJava(result: JavaUpsertResult): UpsertResult =
    UpsertResult(ScalaConverters.toScalaMap(result.getRecord), result.isInserted)
}

final case class DbChange(
    eventType: String,
    table: String,
    id: Option[String],
    record: Option[Map[String, Any]],
    oldRecord: Option[Map[String, Any]],
)

object DbChange {
  private[sdk] def fromJava(change: JavaDbChange): DbChange =
    DbChange(
      eventType = change.getType,
      table = change.getTable,
      id = Option(change.getId),
      record = Option(change.getRecord).map(ScalaConverters.toScalaMap),
      oldRecord = Option(change.getOldRecord).map(ScalaConverters.toScalaMap),
    )
}

final case class FileInfo(
    key: String,
    size: Long,
    contentType: Option[String],
    etag: Option[String],
    lastModified: Option[String],
    customMetadata: Map[String, String],
)

object FileInfo {
  private[sdk] def fromJava(info: JavaFileInfo): FileInfo =
    FileInfo(
      key = info.getKey,
      size = info.getSize,
      contentType = Option(info.getContentType),
      etag = Option(info.getEtag),
      lastModified = Option(info.getLastModified),
      customMetadata = Option(info.getCustomMetadata).map(_.asScala.toMap).getOrElse(Map.empty),
    )
}

final case class SignedUrlResult(url: String, expiresIn: Int)

object SignedUrlResult {
  private[sdk] def fromJava(result: JavaSignedUrlResult): SignedUrlResult =
    SignedUrlResult(result.getUrl, result.getExpiresIn)
}

final class Subscription(private[sdk] val underlying: JavaDatabaseLiveClient.Subscription) {
  def cancel(): Unit = underlying.cancel()
  def close(): Unit = underlying.close()
}

final class StorageClient private[sdk] (private val underlying: JavaStorageClient) {
  def bucket(name: String): StorageBucket = new StorageBucket(underlying.bucket(name))
}

final class StorageBucket private[sdk] (private val underlying: JavaStorageBucket) {
  def name: String = underlying.getName

  def upload(
      key: String,
      data: Array[Byte],
      contentType: Option[String] = None,
      customMetadata: Map[String, String] = Map.empty,
  ): FileInfo = {
    val metadata = if (customMetadata.isEmpty) null else customMetadata.asJava
    FileInfo.fromJava(underlying.upload(key, data, contentType.orNull, metadata))
  }

  def uploadString(key: String, content: String, encoding: String = "raw"): FileInfo =
    FileInfo.fromJava(underlying.uploadString(key, content, encoding))

  def download(key: String): Array[Byte] = underlying.download(key)

  def delete(key: String): Unit = underlying.delete(key)

  def list(prefix: Option[String] = None, limit: Option[Int] = None, cursor: Option[String] = None): Map[String, Any] =
    ScalaConverters.toScalaMap(underlying.list(prefix.orNull, limit.map(Int.box).orNull, cursor.orNull))

  def url(key: String): String = underlying.getUrl(key)

  def metadata(key: String): FileInfo = FileInfo.fromJava(underlying.getMetadata(key))

  def updateMetadata(key: String, metadata: Map[String, Any]): FileInfo =
    FileInfo.fromJava(underlying.updateMetadata(key, ScalaConverters.toJavaMap(metadata)))

  def createSignedUrl(key: String, expiresIn: String = "1h"): SignedUrlResult =
    SignedUrlResult.fromJava(underlying.createSignedUrl(key, expiresIn))

  def createSignedUploadUrl(key: String, expiresIn: Int = 3600): SignedUrlResult =
    SignedUrlResult.fromJava(underlying.createSignedUploadUrl(key, expiresIn))

  def initiateResumableUpload(key: String, contentType: Option[String] = None): Map[String, Any] =
    ScalaConverters.toScalaMap(underlying.initiateResumableUpload(key, contentType.orNull))

  def resumeUpload(key: String, uploadId: String, chunk: Array[Byte], offset: Long): Map[String, Any] =
    ScalaConverters.toScalaMap(underlying.resumeUpload(key, uploadId, chunk, offset))
}

final class DbRef private[sdk] (private val underlying: JavaDbRef) {
  def namespace: String = underlying.getNamespace
  def instanceId: Option[String] = Option(underlying.getInstanceId)
  def table(name: String): TableRef = new TableRef(underlying.table(name))
}

final class DocRef private[sdk] (private val underlying: JavaDocRef) {
  def collectionName: String = underlying.getCollectionName
  def id: String = underlying.getId

  def get(): Map[String, Any] = ScalaConverters.toScalaMap(underlying.get())

  def update(data: Map[String, Any]): Map[String, Any] =
    ScalaConverters.toScalaMap(underlying.update(ScalaConverters.toJavaMap(data)))

  def delete(): Map[String, Any] = ScalaConverters.toScalaMap(underlying.delete())

  def onSnapshot(listener: DbChange => Unit): Subscription =
    new Subscription(
      underlying.onSnapshot(
        new Consumer[JavaDbChange] {
          override def accept(change: JavaDbChange): Unit = listener(DbChange.fromJava(change))
        },
      ),
    )
}

final class TableRef private[sdk] (private val underlying: JavaTableRef) {
  def name: String = underlying.getName

  def where(field: String, op: String, value: Any): TableRef =
    new TableRef(underlying.where(field, op, ScalaConverters.toJava(value)))

  def or(filters: (String, String, Any)*): TableRef =
    new TableRef(
      underlying.or(
        new Consumer[JavaTableRef.OrBuilder] {
          override def accept(builder: JavaTableRef.OrBuilder): Unit =
            filters.foreach { case (field, op, value) =>
              builder.where(field, op, ScalaConverters.toJava(value))
            }
        },
      ),
    )

  def orderBy(field: String, direction: String = "asc"): TableRef =
    new TableRef(underlying.orderBy(field, direction))

  def limit(value: Int): TableRef = new TableRef(underlying.limit(value))
  def offset(value: Int): TableRef = new TableRef(underlying.offset(value))
  def page(value: Int): TableRef = new TableRef(underlying.page(value))
  def search(query: String): TableRef = new TableRef(underlying.search(query))
  def after(cursor: String): TableRef = new TableRef(underlying.after(cursor))
  def before(cursor: String): TableRef = new TableRef(underlying.before(cursor))

  def getList(): ListResult = ListResult.fromJava(underlying.getList())
  def getOne(id: String): Map[String, Any] = ScalaConverters.toScalaMap(underlying.getOne(id))
  def getFirst(): Option[Map[String, Any]] = Option(underlying.getFirst()).map(ScalaConverters.toScalaMap)

  def insert(record: Map[String, Any]): Map[String, Any] =
    ScalaConverters.toScalaMap(underlying.insert(ScalaConverters.toJavaMap(record)))

  def upsert(record: Map[String, Any], conflictTarget: Option[String] = None): UpsertResult =
    UpsertResult.fromJava(underlying.upsert(ScalaConverters.toJavaMap(record), conflictTarget.orNull))

  def count(): Int = underlying.count()

  def insertMany(records: Seq[Map[String, Any]]): List[Map[String, Any]] =
    underlying.insertMany(records.map(ScalaConverters.toJavaMap).asJava).asScala.toList.map(ScalaConverters.toScalaMap)

  def upsertMany(records: Seq[Map[String, Any]], conflictTarget: Option[String] = None): List[Map[String, Any]] =
    underlying
      .upsertMany(records.map(ScalaConverters.toJavaMap).asJava, conflictTarget.orNull)
      .asScala
      .toList
      .map(ScalaConverters.toScalaMap)

  def updateMany(update: Map[String, Any]): BatchResult =
    BatchResult.fromJava(underlying.updateMany(ScalaConverters.toJavaMap(update)))

  def deleteMany(): BatchResult = BatchResult.fromJava(underlying.deleteMany())

  def doc(id: String): DocRef = new DocRef(underlying.doc(id))

  def onSnapshot(listener: DbChange => Unit): Subscription =
    new Subscription(
      underlying.onSnapshot(
        new Consumer[JavaDbChange] {
          override def accept(change: JavaDbChange): Unit = listener(DbChange.fromJava(change))
        },
      ),
    )
}
