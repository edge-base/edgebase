package dev.edgebase.sdk.scala.core

import scala.jdk.CollectionConverters._

private[sdk] object ScalaConverters {
  type JsonMap = Map[String, Any]

  def toScala(value: Any): Any = value match {
    case null => null
    case map: java.util.Map[_, _] =>
      map.asScala.iterator.map { case (key, item) =>
        String.valueOf(key) -> toScala(item)
      }.toMap
    case list: java.util.List[_] =>
      list.asScala.iterator.map(toScala).toList
    case set: java.util.Set[_] =>
      set.asScala.iterator.map(toScala).toSet
    case bytes: Array[Byte] => bytes
    case array: Array[_] =>
      array.iterator.map(toScala).toList
    case other => other
  }

  def toScalaMap(value: java.util.Map[_, _]): JsonMap =
    toScala(value).asInstanceOf[JsonMap]

  def toScalaList(value: java.util.List[_]): List[Any] =
    toScala(value).asInstanceOf[List[Any]]

  def toJava(value: Any): Object = value match {
    case null => null
    case bytes: Array[Byte] => bytes
    case option: Option[_] => option.map(toJava).orNull
    case map: Map[_, _] =>
      map.iterator.map { case (key, item) =>
        String.valueOf(key) -> toJava(item)
      }.toMap.asJava.asInstanceOf[Object]
    case iterable: Iterable[_] =>
      iterable.iterator.map(toJava).toList.asJava.asInstanceOf[Object]
    case array: Array[_] =>
      array.iterator.map(toJava).toList.asJava.asInstanceOf[Object]
    case other => other.asInstanceOf[Object]
  }

  def toJavaMap(value: JsonMap): java.util.Map[String, Object] =
    value.iterator.map { case (key, item) => key -> toJava(item) }.toMap.asJava

  def toJavaList(values: Iterable[Any]): java.util.List[Object] =
    values.iterator.map(toJava).toList.asJava

  def toJavaStringMap(values: Map[String, String]): java.util.Map[String, String] =
    values.asJava

  def nullableMap(value: Any): JsonMap = value match {
    case null => Map.empty
    case map: java.util.Map[_, _] => toScalaMap(map)
    case map: Map[_, _] => map.asInstanceOf[JsonMap]
    case other => Map("value" -> toScala(other))
  }

  def nullableList(value: Any): List[Any] = value match {
    case null => List.empty
    case list: java.util.List[_] => toScalaList(list)
    case list: Iterable[_] => list.toList.map(toScala)
    case other => List(toScala(other))
  }
}
