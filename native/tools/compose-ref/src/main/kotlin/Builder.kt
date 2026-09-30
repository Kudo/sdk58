@file:OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)

package expo.composeref

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ElevatedButton
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.ColorPainter
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** The scope a child is composed in, like @expo/ui's `UIComposableScope`. */
class ChildScope(
  val row: RowScope? = null,
  val column: ColumnScope? = null,
  val box: BoxScope? = null
)

class Frames {
  /** Outside all modifiers: the node's layout box in its parent. */
  val outer = HashMap<String, Rect>()

  /** Inside all modifiers: the box the component itself is given. */
  val inner = HashMap<String, Rect>()
  val unsupported = LinkedHashMap<String, MutableList<String>>()

  fun unsupported(key: String, path: String) {
    val paths = unsupported.getOrPut(key) { mutableListOf() }
    if (path !in paths) paths += path
  }
}

class Context(
  val frames: Frames,
  /** Roboto when fonts/ has it; null means the platform default font. */
  val defaultFontFamily: FontFamily?
)

private fun record(map: HashMap<String, Rect>, path: String): Modifier =
  Modifier.onGloballyPositioned { coordinates ->
    val position = coordinates.positionInRoot()
    map[path] = Rect(
      position.x,
      position.y,
      position.x + coordinates.size.width,
      position.y + coordinates.size.height
    )
  }

// ---------------------------------------------------------------------------
// Convertibles (@expo/ui android/.../convertibles/Arrangement.kt, Alignment.kt)
// ---------------------------------------------------------------------------

private fun horizontalArrangement(node: Node, key: String, ctx: Context): Arrangement.Horizontal? {
  val value = node.props[key] ?: return null
  (value as? kotlinx.serialization.json.JsonObject)?.let { custom ->
    return custom.intOrNull("spacedBy")?.let { Arrangement.spacedBy(it.dp) } ?: Arrangement.Start
  }
  return when (node.props.str(key)) {
    "start" -> Arrangement.Start
    "end" -> Arrangement.End
    "center" -> Arrangement.Center
    "spaceBetween" -> Arrangement.SpaceBetween
    "spaceAround" -> Arrangement.SpaceAround
    "spaceEvenly" -> Arrangement.SpaceEvenly
    else -> null.also { ctx.frames.unsupported("prop:$key=$value", node.path) }
  }
}

private fun verticalArrangement(node: Node, key: String, ctx: Context): Arrangement.Vertical? {
  val value = node.props[key] ?: return null
  (value as? kotlinx.serialization.json.JsonObject)?.let { custom ->
    return custom.intOrNull("spacedBy")?.let { Arrangement.spacedBy(it.dp) } ?: Arrangement.Top
  }
  return when (node.props.str(key)) {
    "top" -> Arrangement.Top
    "bottom" -> Arrangement.Bottom
    "center" -> Arrangement.Center
    "spaceBetween" -> Arrangement.SpaceBetween
    "spaceAround" -> Arrangement.SpaceAround
    "spaceEvenly" -> Arrangement.SpaceEvenly
    else -> null.also { ctx.frames.unsupported("prop:$key=$value", node.path) }
  }
}

/** `HorizontalAlignment` (Column `horizontalAlignment`). */
private fun layoutHorizontalAlignment(node: Node, ctx: Context): Alignment.Horizontal? =
  when (val value = node.props.str("horizontalAlignment")) {
    null -> null
    "start" -> Alignment.Start
    "end" -> Alignment.End
    "center" -> Alignment.CenterHorizontally
    else -> null.also { ctx.frames.unsupported("prop:horizontalAlignment=$value", node.path) }
  }

/** `VerticalAlignment` (Row `verticalAlignment`). */
private fun layoutVerticalAlignment(node: Node, ctx: Context): Alignment.Vertical? =
  when (val value = node.props.str("verticalAlignment")) {
    null -> null
    "top" -> Alignment.Top
    "bottom" -> Alignment.Bottom
    "center" -> Alignment.CenterVertically
    else -> null.also { ctx.frames.unsupported("prop:verticalAlignment=$value", node.path) }
  }

/** `ContentAlignment` (Box `contentAlignment`) and `AlignmentType.toAlignment()`. */
private fun alignment2d(value: String?): Alignment? = when (value) {
  "topStart" -> Alignment.TopStart
  "topCenter" -> Alignment.TopCenter
  "topEnd" -> Alignment.TopEnd
  "centerStart" -> Alignment.CenterStart
  "center" -> Alignment.Center
  "centerEnd" -> Alignment.CenterEnd
  "bottomStart" -> Alignment.BottomStart
  "bottomCenter" -> Alignment.BottomCenter
  "bottomEnd" -> Alignment.BottomEnd
  else -> null
}

/** `AlignmentType.toVerticalAlignment()`. */
private fun alignmentVertical(value: String?): Alignment.Vertical? = when (value) {
  "top" -> Alignment.Top
  "centerVertically" -> Alignment.CenterVertically
  "bottom" -> Alignment.Bottom
  else -> null
}

/** `AlignmentType.toHorizontalAlignment()`. */
private fun alignmentHorizontal(value: String?): Alignment.Horizontal? = when (value) {
  "start" -> Alignment.Start
  "centerHorizontally" -> Alignment.CenterHorizontally
  "end" -> Alignment.End
  else -> null
}

// ---------------------------------------------------------------------------
// Modifiers (@expo/ui android/.../ModifierRegistry.kt), applied in array order
// ---------------------------------------------------------------------------

/** Modifiers that do not change the layout. They are accepted and skipped. */
private val NON_LAYOUT_MODIFIERS = setOf(
  "background", "shadow", "dropShadow", "innerShadow", "alpha", "blur", "cornerRadius",
  "rotate", "graphicsLayer", "zIndex", "animateContentSize", "testID", "semantics", "clip",
  "onVisibilityChanged", "onSizeChanged", "onGloballyPositioned", "clickable",
  "combinedClickable", "selectable", "selectableGroup", "toggleable", "menuAnchor", "maskClip",
  // No IME is shown here.
  "imePadding"
)

@Composable
private fun applyModifiers(node: Node, scope: ChildScope, ctx: Context): Modifier {
  var result: Modifier = Modifier
  for (params in node.modifiers) {
    val type = params.str("\$type")
    val modifier: Modifier = when (type) {
      "paddingAll" -> Modifier.padding(params.int("all", 0).dp)
      "padding" -> Modifier.padding(
        params.int("start", 0).dp,
        params.int("top", 0).dp,
        params.int("end", 0).dp,
        params.int("bottom", 0).dp
      )
      "size" -> Modifier.size(params.int("width", 0).dp, params.int("height", 0).dp)
      "fillMaxSize" -> Modifier.fillMaxSize(params.float("fraction", 1f))
      "fillMaxWidth" -> Modifier.fillMaxWidth(params.float("fraction", 1f))
      "fillMaxHeight" -> Modifier.fillMaxHeight(params.float("fraction", 1f))
      "width" -> when (params.str("width")) {
        "min" -> Modifier.width(IntrinsicSize.Min)
        "max" -> Modifier.width(IntrinsicSize.Max)
        else -> Modifier.width(params.int("width", 0).dp)
      }
      "height" -> Modifier.height(params.int("height", 0).dp)
      "defaultMinSize" -> Modifier.defaultMinSize(
        minWidth = params.floatOrNull("minWidth")?.dp ?: androidx.compose.ui.unit.Dp.Unspecified,
        minHeight = params.floatOrNull("minHeight")?.dp ?: androidx.compose.ui.unit.Dp.Unspecified
      )
      "wrapContentWidth" -> alignmentHorizontal(params.str("alignment"))
        ?.let { Modifier.wrapContentWidth(align = it) } ?: Modifier.wrapContentWidth()
      "wrapContentHeight" -> alignmentVertical(params.str("alignment"))
        ?.let { Modifier.wrapContentHeight(align = it) } ?: Modifier.wrapContentHeight()
      "offset" -> Modifier.offset(params.int("x", 0).dp, params.int("y", 0).dp)
      "border" -> if (params["borderColor"] != null) {
        Modifier.border(BorderStroke(params.int("borderWidth", 1).dp, Color.Black))
      } else {
        Modifier
      }
      "weight" -> {
        val weight = params.float("weight", 1f)
        scope.row?.run { Modifier.weight(weight) }
          ?: scope.column?.run { Modifier.weight(weight) }
          ?: Modifier.also { ctx.frames.unsupported("modifier:weight(no Row/Column scope)", node.path) }
      }
      "align" -> {
        val alignment = params.str("alignment")
        when {
          scope.box != null -> alignment2d(alignment)?.let { with(scope.box) { Modifier.align(it) } }
          scope.row != null -> alignmentVertical(alignment)?.let { with(scope.row) { Modifier.align(it) } }
          scope.column != null -> alignmentHorizontal(alignment)?.let { with(scope.column) { Modifier.align(it) } }
          else -> null
        } ?: Modifier.also { ctx.frames.unsupported("modifier:align($alignment) ignored", node.path) }
      }
      "matchParentSize" -> scope.box?.run { Modifier.matchParentSize() }
        ?: Modifier.also { ctx.frames.unsupported("modifier:matchParentSize(no Box scope)", node.path) }
      "verticalScroll" -> Modifier.verticalScroll(rememberScrollState())
      "horizontalScroll" -> Modifier.horizontalScroll(rememberScrollState())
      in NON_LAYOUT_MODIFIERS -> Modifier
      else -> Modifier.also { ctx.frames.unsupported("modifier:$type", node.path) }
    }
    result = result.then(modifier)
  }
  return result
}

// ---------------------------------------------------------------------------
// Nodes. Each case follows the @expo/ui view named in its comment.
// ---------------------------------------------------------------------------

@Composable
fun RenderNode(node: Node, scope: ChildScope, ctx: Context) {
  val frames = ctx.frames
  // Outer recorder first, inner recorder last: the modifier chain is
  // outside-in, like SwiftUI's modifiers are inside-out.
  val outer = record(frames.outer, node.path)
  val inner = record(frames.inner, node.path)
  val userModifiers = applyModifiers(node, scope, ctx)
  val modifier = outer.then(userModifiers).then(inner)
  val props = node.props

  when (node.type) {
    // ComposeViews.kt RowContent
    "Row" -> Row(
      horizontalArrangement = horizontalArrangement(node, "horizontalArrangement", ctx) ?: Arrangement.Start,
      verticalAlignment = layoutVerticalAlignment(node, ctx) ?: Alignment.Top,
      modifier = modifier
    ) {
      Children(node, ChildScope(row = this), ctx)
    }

    // ComposeViews.kt ColumnContent
    "Column" -> Column(
      verticalArrangement = verticalArrangement(node, "verticalArrangement", ctx) ?: Arrangement.Top,
      horizontalAlignment = layoutHorizontalAlignment(node, ctx) ?: Alignment.Start,
      modifier = modifier
    ) {
      Children(node, ChildScope(column = this), ctx)
    }

    // ComposeViews.kt BoxContent
    "Box" -> Box(
      contentAlignment = alignment2d(props.str("contentAlignment"))
        ?: Alignment.TopStart.also {
          props.str("contentAlignment")?.let { frames.unsupported("prop:contentAlignment=$it", node.path) }
        },
      modifier = modifier
    ) {
      Children(node, ChildScope(box = this), ctx)
    }

    // ComposeViews.kt FlowRowContent: children get `rowScope = this@FlowRow`
    "FlowRow" -> FlowRow(
      horizontalArrangement = horizontalArrangement(node, "horizontalArrangement", ctx) ?: Arrangement.Start,
      verticalArrangement = verticalArrangement(node, "verticalArrangement", ctx) ?: Arrangement.Top,
      modifier = modifier
    ) {
      Children(node, ChildScope(row = this), ctx)
    }

    // SpacerView.kt
    "Spacer" -> Spacer(modifier)

    // TextView.kt TextContent
    "Text" -> TextNode(node, modifier, ctx)

    // button/Button.kt. The children are composed in the button's RowScope.
    "Button", "FilledTonalButton", "OutlinedButton", "ElevatedButton", "TextButton" -> {
      val isText = node.type == "TextButton"
      val defaultPadding = if (isText) ButtonDefaults.TextButtonContentPadding else ButtonDefaults.ContentPadding
      val contentPadding = props.obj("contentPadding")?.let { record ->
        // ContentPaddingRecord.toPaddingValues() falls back to ButtonDefaults.ContentPadding
        // for each missing edge, also for TextButton.
        val fallback = ButtonDefaults.ContentPadding
        PaddingValues(
          start = record.floatOrNull("start")?.dp ?: fallback.calculateLeftPadding(LayoutDirection.Ltr),
          top = record.floatOrNull("top")?.dp ?: fallback.calculateTopPadding(),
          end = record.floatOrNull("end")?.dp ?: fallback.calculateRightPadding(LayoutDirection.Ltr),
          bottom = record.floatOrNull("bottom")?.dp ?: fallback.calculateBottomPadding()
        )
      } ?: defaultPadding
      val enabled = props.bool("enabled", true)
      val content: @Composable RowScope.() -> Unit = { Children(node, ChildScope(row = this), ctx) }
      when (node.type) {
        "Button" -> Button(onClick = {}, modifier = modifier, enabled = enabled, contentPadding = contentPadding, content = content)
        "FilledTonalButton" -> FilledTonalButton(onClick = {}, modifier = modifier, enabled = enabled, contentPadding = contentPadding, content = content)
        "OutlinedButton" -> OutlinedButton(onClick = {}, modifier = modifier, enabled = enabled, contentPadding = contentPadding, content = content)
        "ElevatedButton" -> ElevatedButton(onClick = {}, modifier = modifier, enabled = enabled, contentPadding = contentPadding, content = content)
        else -> TextButton(onClick = {}, modifier = modifier, enabled = enabled, contentPadding = contentPadding, content = content)
      }
    }

    // SwitchView.kt: onCheckedChange is always set.
    "Switch" -> Switch(
      checked = props.bool("value", false),
      onCheckedChange = {},
      modifier = modifier,
      enabled = props.bool("enabled", true)
    )

    // CheckboxView.kt: onCheckedChange is null when nativeClickable is false.
    "Checkbox" -> Checkbox(
      checked = props.bool("value", false),
      onCheckedChange = if (props.bool("nativeClickable", true)) ({}) else null,
      modifier = modifier,
      enabled = props.bool("enabled", true)
    )

    // SliderView.kt
    "Slider" -> {
      val min = props.float("min", 0f)
      val max = props.float("max", 1f)
      Slider(
        value = props.float("value", 0f),
        onValueChange = {},
        modifier = modifier,
        enabled = props.bool("enabled", true),
        valueRange = min..max,
        steps = props.int("steps", 0)
      )
    }

    // textfield/TextField.kt. `value` is an ObservableState in @expo/ui; a string here.
    "TextField" -> TextFieldNode(node, modifier, ctx)

    // icon/IconView.kt. The painter is empty: its intrinsic size is unspecified, so
    // Icon uses its 24 dp default unless `size` is set. A real vector drawable has
    // its own intrinsic size (24 dp for Material Symbols).
    "Icon" -> Icon(
      painter = ColorPainter(Color.Transparent),
      contentDescription = props.str("contentDescription"),
      modifier = outer
        .then(props.intOrNull("size")?.let { Modifier.size(it.dp) } ?: Modifier)
        .then(userModifiers)
        .then(inner)
    )

    // SlotView.kt: renders its children in a new UIComposableScope.
    "Slot" -> Children(node, ChildScope(), ctx)

    else -> frames.unsupported("type:${node.type}", node.path)
  }
}

@Composable
private fun Children(node: Node, scope: ChildScope, ctx: Context) {
  for (child in node.children) {
    if (node.type in SLOT_PARENTS && child.type == "Slot") continue
    RenderNode(child, scope, ctx)
  }
}

/** Parents that take their Slot children by name instead of as content. */
private val SLOT_PARENTS = setOf("TextField")

private fun fontWeight(value: String?): FontWeight? = when (value) {
  "normal" -> FontWeight.Normal
  "bold" -> FontWeight.Bold
  "100" -> FontWeight.W100
  "200" -> FontWeight.W200
  "300" -> FontWeight.W300
  "400" -> FontWeight.W400
  "500" -> FontWeight.W500
  "600" -> FontWeight.W600
  "700" -> FontWeight.W700
  "800" -> FontWeight.W800
  "900" -> FontWeight.W900
  else -> null
}

/** TextView.kt resolveFontFamily. Custom families are not loaded here. */
private fun fontFamily(node: Node, ctx: Context): FontFamily? = when (val name = node.props.str("fontFamily")) {
  null, "default", "sansSerif" -> ctx.defaultFontFamily
  "serif" -> FontFamily.Serif
  "monospace" -> FontFamily.Monospace
  "cursive" -> FontFamily.Cursive
  else -> ctx.defaultFontFamily.also { ctx.frames.unsupported("prop:fontFamily=$name", node.path) }
}

@Composable
private fun typographyStyle(value: String?): TextStyle? {
  val t = MaterialTheme.typography
  return when (value) {
    "displayLarge" -> t.displayLarge
    "displayMedium" -> t.displayMedium
    "displaySmall" -> t.displaySmall
    "headlineLarge" -> t.headlineLarge
    "headlineMedium" -> t.headlineMedium
    "headlineSmall" -> t.headlineSmall
    "titleLarge" -> t.titleLarge
    "titleMedium" -> t.titleMedium
    "titleSmall" -> t.titleSmall
    "bodyLarge" -> t.bodyLarge
    "bodyMedium" -> t.bodyMedium
    "bodySmall" -> t.bodySmall
    "labelLarge" -> t.labelLarge
    "labelMedium" -> t.labelMedium
    "labelSmall" -> t.labelSmall
    else -> null
  }
}

/** TextStyle.Default with the default family; on Android that family is Roboto. */
private fun defaultTextStyle(ctx: Context): TextStyle =
  ctx.defaultFontFamily?.let { TextStyle.Default.copy(fontFamily = it) } ?: TextStyle.Default

@Composable
private fun TextNode(node: Node, modifier: Modifier, ctx: Context) {
  val props = node.props
  val baseStyle = typographyStyle(props.str("typography")) ?: defaultTextStyle(ctx)
  val mergedStyle = baseStyle.merge(
    TextStyle(
      fontSize = props.floatOrNull("fontSize")?.sp ?: androidx.compose.ui.unit.TextUnit.Unspecified,
      fontWeight = fontWeight(props.str("fontWeight")),
      fontStyle = when (props.str("fontStyle")) {
        "italic" -> FontStyle.Italic
        "normal" -> FontStyle.Normal
        else -> null
      },
      fontFamily = if (props.str("fontFamily") != null) fontFamily(node, ctx) else null,
      letterSpacing = props.floatOrNull("letterSpacing")?.sp ?: androidx.compose.ui.unit.TextUnit.Unspecified,
      lineHeight = props.floatOrNull("lineHeight")?.sp ?: androidx.compose.ui.unit.TextUnit.Unspecified
    )
  )
  Text(
    text = AnnotatedString(props.str("text") ?: ""),
    modifier = modifier,
    textAlign = when (props.str("textAlign")) {
      "left" -> TextAlign.Left
      "right" -> TextAlign.Right
      "center" -> TextAlign.Center
      "justify" -> TextAlign.Justify
      "start" -> TextAlign.Start
      "end" -> TextAlign.End
      else -> null
    },
    overflow = when (props.str("overflow")) {
      "ellipsis" -> TextOverflow.Ellipsis
      "visible" -> TextOverflow.Visible
      else -> TextOverflow.Clip
    },
    softWrap = props.bool("softWrap", true),
    maxLines = props.intOrNull("maxLines") ?: Int.MAX_VALUE,
    minLines = props.intOrNull("minLines") ?: 1,
    style = mergedStyle
  )
}

@Composable
private fun TextFieldNode(node: Node, modifier: Modifier, ctx: Context) {
  val props = node.props
  fun slot(name: String): (@Composable () -> Unit)? =
    node.children.firstOrNull { it.type == "Slot" && it.props.str("name") == name }?.let { slot ->
      { RenderNode(slot, ChildScope(), ctx) }
    }
  val singleLine = props.bool("singleLine", false)
  val maxLines = props.intOrNull("maxLines") ?: if (singleLine) 1 else Int.MAX_VALUE
  val minLines = props.intOrNull("minLines") ?: 1
  val value = props.str("value") ?: ""
  val enabled = props.bool("enabled", true)
  val readOnly = props.bool("readOnly", false)
  val isError = props.bool("isError", false)
  // TextFieldTextStyleRecord?.toTextStyle() returns TextStyle.Default when unset.
  val textStyle = defaultTextStyle(ctx)
  if (props.str("variant") == "outlined") {
    OutlinedTextField(
      value = value, onValueChange = {}, modifier = modifier,
      enabled = enabled, readOnly = readOnly, textStyle = textStyle,
      label = slot("label"), placeholder = slot("placeholder"),
      leadingIcon = slot("leadingIcon"), trailingIcon = slot("trailingIcon"),
      prefix = slot("prefix"), suffix = slot("suffix"), supportingText = slot("supportingText"),
      isError = isError, singleLine = singleLine, maxLines = maxLines, minLines = minLines
    )
  } else {
    TextField(
      value = value, onValueChange = {}, modifier = modifier,
      enabled = enabled, readOnly = readOnly, textStyle = textStyle,
      label = slot("label"), placeholder = slot("placeholder"),
      leadingIcon = slot("leadingIcon"), trailingIcon = slot("trailingIcon"),
      prefix = slot("prefix"), suffix = slot("suffix"), supportingText = slot("supportingText"),
      isError = isError, singleLine = singleLine, maxLines = maxLines, minLines = minLines
    )
  }
}
