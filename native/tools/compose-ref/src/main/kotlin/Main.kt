@file:OptIn(ExperimentalMaterial3ExpressiveApi::class)

package expo.composeref

import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.platform.Font
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import java.io.File
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.system.exitProcess

private const val USAGE = """usage: compose-ref [--density N] [--font-scale N] [--system-font] [--fonts DIR] [--no-touch-target] < input.json

Lays out an @expo/ui jetpack-compose tree with Compose Desktop and prints the
frames as JSON. See README.md."""

private class Options(
  val density: Float = 1f,
  val fontScale: Float = 1f,
  val systemFont: Boolean = false,
  val fontsDir: File? = null,
  val touchTarget: Boolean = true
)

private fun parseArgs(args: Array<String>): Options {
  var density = 1f
  var fontScale = 1f
  var systemFont = false
  var fontsDir: File? = null
  var touchTarget = true
  var i = 0
  fun value(): String = args.getOrNull(++i) ?: throw InputError("${args[i - 1]} needs a value\n$USAGE")
  while (i < args.size) {
    when (val arg = args[i]) {
      "--density" -> density = value().toFloatOrNull()?.takeIf { it > 0 } ?: throw InputError("bad --density")
      "--font-scale" -> fontScale = value().toFloatOrNull()?.takeIf { it > 0 } ?: throw InputError("bad --font-scale")
      "--system-font" -> systemFont = true
      "--fonts" -> fontsDir = File(value())
      "--no-touch-target" -> touchTarget = false
      "-h", "--help" -> {
        println(USAGE)
        exitProcess(0)
      }
      else -> throw InputError("unknown argument $arg\n$USAGE")
    }
    i++
  }
  return Options(density, fontScale, systemFont, fontsDir, touchTarget)
}

/** fonts/ next to build.gradle.kts (the jar is in build/install/compose-ref/lib/). */
private fun defaultFontsDir(): File? {
  val jar = runCatching { File(Options::class.java.protectionDomain.codeSource.location.toURI()) }.getOrNull()
  val candidates = listOfNotNull(
    jar?.parentFile?.parentFile?.parentFile?.parentFile?.parentFile?.let { File(it, "fonts") },
    File("fonts")
  )
  return candidates.firstOrNull { File(it, "Roboto-Regular.ttf").isFile }
}

private val ROBOTO_FACES = listOf(
  "Thin" to FontWeight.W100, "Light" to FontWeight.W300, "Regular" to FontWeight.W400,
  "Medium" to FontWeight.W500, "Bold" to FontWeight.W700, "Black" to FontWeight.W900
)

private fun loadRoboto(dir: File): FontFamily? {
  val fonts = ROBOTO_FACES.flatMap { (name, weight) ->
    listOfNotNull(
      File(dir, "Roboto-$name.ttf").takeIf { it.isFile }?.let { Font(it, weight, FontStyle.Normal) },
      File(dir, if (name == "Regular") "Roboto-Italic.ttf" else "Roboto-${name}Italic.ttf")
        .takeIf { it.isFile }?.let { Font(it, weight, FontStyle.Italic) }
    )
  }
  return if (fonts.isEmpty()) null else FontFamily(fonts)
}

private fun Typography.withFamily(family: FontFamily): Typography {
  fun TextStyle.f() = copy(fontFamily = family)
  return Typography(
    displayLarge.f(), displayMedium.f(), displaySmall.f(),
    headlineLarge.f(), headlineMedium.f(), headlineSmall.f(),
    titleLarge.f(), titleMedium.f(), titleSmall.f(),
    bodyLarge.f(), bodyMedium.f(), bodySmall.f(),
    labelLarge.f(), labelMedium.f(), labelSmall.f()
  )
}

/**
 * The Android `ComposeView` the Host is: MATCH_PARENT (EXACTLY, fixed constraints)
 * on the normal axes; WRAP_CONTENT (UNSPECIFIED, 0..Infinity) on the
 * `matchContents` axes. The content may be larger than the scene; it is placed
 * at (0, 0) anyway.
 */
@Composable
private fun ComposeViewEmulation(host: HostSpec, widthPx: Int, heightPx: Int, onContentSize: (IntSize) -> Unit, content: @Composable () -> Unit) {
  Layout(content = content) { measurables, constraints ->
    val childConstraints = Constraints(
      minWidth = if (host.matchContentsHorizontal) 0 else widthPx,
      maxWidth = if (host.matchContentsHorizontal) Constraints.Infinity else widthPx,
      minHeight = if (host.matchContentsVertical) 0 else heightPx,
      maxHeight = if (host.matchContentsVertical) Constraints.Infinity else heightPx
    )
    val placeables = measurables.map { it.measure(childConstraints) }
    onContentSize(IntSize(placeables.maxOfOrNull { it.width } ?: 0, placeables.maxOfOrNull { it.height } ?: 0))
    layout(constraints.maxWidth, constraints.maxHeight) {
      placeables.forEach { it.place(0, 0) }
    }
  }
}

/** HostView.kt MaybeMatchContentsLayout (useViewportSizeMeasurement not copied). */
@Composable
private fun MaybeMatchContentsLayout(host: HostSpec, content: @Composable () -> Unit) {
  Layout(
    modifier = Modifier
      .then(if (host.matchContentsHorizontal) Modifier.wrapContentWidth() else Modifier)
      .then(if (host.matchContentsVertical) Modifier.wrapContentHeight() else Modifier),
    content = content
  ) { measurables, constraints ->
    val placeables = measurables.map { it.measure(constraints) }
    val contentWidthPx = placeables.maxOfOrNull { it.width } ?: 0
    val contentHeightPx = placeables.maxOfOrNull { it.height } ?: 0
    layout(contentWidthPx, contentHeightPx) {
      placeables.forEach { it.placeRelative(0, 0) }
    }
  }
}

private fun round3(v: Float): Double = (v * 1000.0).roundToInt() / 1000.0

private fun JsonObjectBuilder.putRect(key: String, rect: Rect, scale: Float) {
  putJsonObject(key) {
    put("x", round3(rect.left / scale))
    put("y", round3(rect.top / scale))
    put("width", round3(rect.width / scale))
    put("height", round3(rect.height / scale))
  }
}

private fun union(rects: List<Rect>): Rect? =
  rects.reduceOrNull { a, b -> Rect(minOf(a.left, b.left), minOf(a.top, b.top), max(a.right, b.right), max(a.bottom, b.bottom)) }

fun main(args: Array<String>) {
  try {
    run(args)
  } catch (e: InputError) {
    System.err.println("compose-ref: ${e.message}")
    exitProcess(1)
  } catch (e: kotlinx.serialization.SerializationException) {
    System.err.println("compose-ref: bad JSON: ${e.message}")
    exitProcess(1)
  }
}

private fun run(args: Array<String>) {
  val options = parseArgs(args)
  val input = parseInput(Json.parseToJsonElement(System.`in`.readBytes().decodeToString()))
  val host = input.host
  val density = options.density

  val fontsDir = if (options.systemFont) null else options.fontsDir ?: defaultFontsDir()
  val roboto = fontsDir?.let { loadRoboto(it) }
  val typography = roboto?.let { Typography().withFamily(it) } ?: Typography()

  // RN converts the Host's Yoga size to px with PixelUtil.toPixelFromDIP + rounding.
  val widthPx = (host.width * density).roundToInt()
  val heightPx = (host.height * density).roundToInt()
  val frames = Frames()
  val ctx = Context(frames, roboto)
  var contentSize = IntSize.Zero

  val scene = ImageComposeScene(
    width = max(widthPx, 1),
    height = max(heightPx, 1),
    density = Density(density, options.fontScale)
  ) {
    val colorScheme = lightColorScheme()
    // HostView.kt Content: layout direction and content color, then the theme.
    CompositionLocalProvider(
      LocalLayoutDirection provides if (host.rightToLeft) LayoutDirection.Rtl else LayoutDirection.Ltr,
      LocalContentColor provides colorScheme.onSurface
    ) {
      MaterialExpressiveTheme(colorScheme = colorScheme, typography = typography) {
        // --no-touch-target: controls without the 48 dp minimum touch target, to
        // read their visual size.
        CompositionLocalProvider(
          LocalMinimumInteractiveComponentSize provides
            if (options.touchTarget) LocalMinimumInteractiveComponentSize.current else Dp.Unspecified
        ) {
          ComposeViewEmulation(host, widthPx, heightPx, { contentSize = it }) {
            MaybeMatchContentsLayout(host) {
              RenderNode(input.root, ChildScope(), ctx)
            }
          }
        }
      }
    }
  }
  // Several frames so that first-frame effects (for example text field
  // decoration) settle. Animations start at their target value here.
  for (t in listOf(0L, 16_000_000L, 1_000_000_000L, 5_000_000_000L)) {
    scene.render(t)
  }
  scene.close()

  val output = buildJsonObject {
    putJsonObject("host") {
      put("width", round3(if (host.matchContentsHorizontal) contentSize.width / density else host.width))
      put("height", round3(if (host.matchContentsVertical) contentSize.height / density else host.height))
    }
    putJsonObject("fittingSize") {
      put("width", round3(contentSize.width / density))
      put("height", round3(contentSize.height / density))
    }
    put("density", density.toDouble())
    put("font", if (roboto != null) "Roboto 2.138" else "system default")
    if (!options.touchTarget) put("touchTarget", false)
    putJsonArray("nodes") {
      fun visit(node: Node) {
        val outer = frames.outer[node.path]
        val inner = frames.inner[node.path]
        val virtual = node.type == "Slot"
        val rendered = outer != null || virtual
        if (rendered) {
          add(buildJsonObject {
            put("path", node.path)
            put("type", node.type)
            val frame = outer ?: union(node.children.mapNotNull { frames.outer[it.path] })
            if (frame != null) putRect("frame", frame, density) else put("frame", kotlinx.serialization.json.JsonNull)
            if (inner != null && inner != outer) putRect("contentFrame", inner, density)
            if (density != 1f && frame != null) putRect("framePx", frame, 1f)
            if (node.type == "Text") node.props.str("text")?.let { put("text", it) }
            node.modifiers.firstOrNull { it.str("\$type") == "testID" }?.str("testID")?.let { put("testID", it) }
            if (virtual) put("virtual", true)
          })
        }
        node.children.forEach { visit(it) }
      }
      visit(input.root)
    }
    putJsonObject("unsupported") {
      frames.unsupported.forEach { (key, paths) ->
        put(key, buildJsonArray { paths.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } })
      }
    }
  }
  println(Json { prettyPrint = true; prettyPrintIndent = "  " }.encodeToString(JsonObject.serializer(), output))
}
