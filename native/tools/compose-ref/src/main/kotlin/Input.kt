package expo.composeref

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

class InputError(message: String) : Exception(message)

class Node(
  val type: String,
  val props: JsonObject,
  val modifiers: List<JsonObject>,
  val children: List<Node>,
  val path: String
)

class HostSpec(
  val width: Float,
  val height: Float,
  val matchContentsHorizontal: Boolean,
  val matchContentsVertical: Boolean,
  val rightToLeft: Boolean
)

class Input(val host: HostSpec, val root: Node)

fun parseInput(json: JsonElement): Input {
  val obj = json as? JsonObject ?: throw InputError("input must be a JSON object")
  val host = obj["host"] as? JsonObject ?: JsonObject(emptyMap())
  val matchContents = host["matchContents"]
  val (matchW, matchH) = when (matchContents) {
    null, JsonNull -> false to false
    is JsonPrimitive -> (matchContents.booleanOrNull ?: false).let { it to it }
    is JsonObject -> matchContents.bool("horizontal", false) to matchContents.bool("vertical", false)
    else -> throw InputError("host.matchContents must be a boolean or {horizontal, vertical}")
  }
  val spec = HostSpec(
    width = host.float("width", 390f),
    height = host.float("height", 844f),
    matchContentsHorizontal = matchW,
    matchContentsVertical = matchH,
    rightToLeft = host.str("layoutDirection") == "rightToLeft"
  )
  val root = obj["root"] as? JsonObject ?: throw InputError("input.root is missing")
  return Input(spec, parseNode(root, "0"))
}

private fun parseNode(obj: JsonObject, path: String): Node {
  val type = obj.str("type") ?: throw InputError("node $path has no type")
  val props = obj["props"] as? JsonObject ?: JsonObject(emptyMap())
  val modifiers = (obj["modifiers"] as? JsonArray)?.map {
    it as? JsonObject ?: throw InputError("node $path: modifiers must be objects")
  } ?: emptyList()
  val children = (obj["children"] as? JsonArray)?.mapIndexed { index, child ->
    parseNode(child as? JsonObject ?: throw InputError("node $path: children must be objects"), "$path/$index")
  } ?: emptyList()
  return Node(type, props, modifiers, children, path)
}

fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

fun JsonObject.num(key: String): Double? = (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull

fun JsonObject.float(key: String, default: Float): Float = num(key)?.toFloat() ?: default

fun JsonObject.floatOrNull(key: String): Float? = num(key)?.toFloat()

// Kotlin `Int` record fields: expo-modules-core converts the JS number with
// Double.toInt(), which truncates (12.5 -> 12).
fun JsonObject.int(key: String, default: Int): Int = num(key)?.toInt() ?: default

fun JsonObject.intOrNull(key: String): Int? = num(key)?.toInt()

fun JsonObject.bool(key: String, default: Boolean): Boolean =
  (this[key] as? JsonPrimitive)?.booleanOrNull ?: default

fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject

@Suppress("unused")
private fun JsonElement.asObjectList(): List<JsonObject> = jsonArray.map { it.jsonObject }
