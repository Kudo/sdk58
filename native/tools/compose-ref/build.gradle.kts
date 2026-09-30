// Compose Multiplatform Desktop ground truth for the @expo/ui Jetpack Compose
// layout emulator. See README.md.
plugins {
  kotlin("jvm") version "2.3.21"
  kotlin("plugin.compose") version "2.3.21"
  id("org.jetbrains.compose") version "1.10.3"
  application
}

kotlin {
  jvmToolchain(17)
}

dependencies {
  implementation(compose.desktop.currentOs)
  // CMP material3 1.10.0-alpha05 is the desktop build of androidx material3
  // 1.5.0-alpha*, the line @expo/ui sdk-58 uses (material3 1.5.0-alpha17).
  implementation("org.jetbrains.compose.material3:material3:1.10.0-alpha05")
  implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
}

application {
  mainClass.set("expo.composeref.MainKt")
  applicationDefaultJvmArgs = listOf("-Djava.awt.headless=true", "-Xss8m")
}

tasks.named<JavaExec>("run") {
  standardInput = System.`in`
  workingDir = projectDir
}
