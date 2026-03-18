// EdgeBase Kotlin SDK — Root build configuration.
//
//: KMP 전환.
// Modules:
//   :core    — KMP library (Android, iOS, JS, JVM)
//   :client  — KMP client SDK (Android, iOS, JS, JVM)
//   :admin   — JVM-only admin SDK (depends on :core JVM artifact)

plugins {
    kotlin("multiplatform") version "2.1.10" apply false
    kotlin("jvm") version "2.1.10" apply false
    kotlin("plugin.serialization") version "2.1.10" apply false
    id("com.android.library") version "8.2.0" apply false
}

allprojects {
    group = "dev.edgebase"
    version = "0.1.3"
}

// Pin JVM toolchain to JDK 17 across all subprojects.
// Prevents Kotlin compiler crash when the host JDK version (e.g. 25.0.1)
// is too new for the compiler's JavaVersion parser.
subprojects {
    plugins.withId("org.jetbrains.kotlin.jvm") {
        extensions.configure<org.jetbrains.kotlin.gradle.dsl.KotlinJvmProjectExtension> {
            jvmToolchain(17)
        }
    }
}
