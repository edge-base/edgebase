// EdgeBase Kotlin SDK — Core KMP module.
//
// Provides shared types, HTTP client (Ktor), query builder, storage, errors.
// Targets: Android, iOS, macOS, JS (Browser IR), JVM (Desktop/Server).
//: KMP 전환.

import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.plugin.mpp.apple.XCFramework

plugins {
    kotlin("multiplatform")
    kotlin("plugin.serialization")
    id("com.android.library")
}

// Allow overriding build output directory via system property (for sandbox environments).
// Module-specific property name avoids cross-module collisions in multi-project builds.
// Usage: ./gradlew ... -Pkotlin.core.buildDir=/tmp/kotlin-core-build
val customBuildDir = findProperty("kotlin.core.buildDir") as String?
if (customBuildDir != null) {
    layout.buildDirectory.set(file(customBuildDir))
}

val enableAppleFrameworks = (findProperty("kotlin.apple.frameworks") as String?)
    ?.toBooleanStrictOrNull()
    ?: gradle.startParameter.taskNames.any { task ->
        val lower = task.lowercase()
        lower.contains("xcframework") || lower.contains("framework") || lower.contains("ios") || lower.contains("macos")
    }

kotlin {
    // Android
    androidTarget {
        compilerOptions {
            jvmTarget.set(JvmTarget.JVM_17)
        }
    }

    // iOS + macOS targets are always declared, but XCFramework artifacts are optional.
    val appleTargets = listOf(iosArm64(), iosSimulatorArm64(), iosX64(), macosArm64(), macosX64())
    if (enableAppleFrameworks) {
        val xcfCore = XCFramework("EdgeBaseCore")
        appleTargets.forEach {
            it.binaries.framework {
                baseName = "EdgeBaseCore"
                xcfCore.add(this)
            }
        }
    }

    // JS (Browser)
    js(IR) {
        browser()
    }

    // JVM (Desktop / Server)
    jvm {
        compilerOptions {
            jvmTarget.set(JvmTarget.JVM_17)
        }
    }

    // Common source set hierarchy
    applyDefaultHierarchyTemplate()

    sourceSets {
        val commonMain by getting {
            dependencies {
                api("io.ktor:ktor-client-core:3.1.0")
                implementation("io.ktor:ktor-client-content-negotiation:3.1.0")
                implementation("io.ktor:ktor-serialization-kotlinx-json:3.1.0")
                implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
            }
        }

        val androidMain by getting {
            dependencies {
                implementation("io.ktor:ktor-client-okhttp:3.1.0")
            }
        }

        val appleMain by getting {
            dependencies {
                implementation("io.ktor:ktor-client-darwin:3.1.0")
            }
        }

        val jsMain by getting {
            dependencies {
                implementation("io.ktor:ktor-client-js:3.1.0")
            }
        }

        val jvmMain by getting {
            dependencies {
                implementation("io.ktor:ktor-client-cio:3.1.0")
            }
        }

        val commonTest by getting {
            dependencies {
                implementation(kotlin("test"))
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
            }
        }

        val jvmTest by getting {
            dependencies {
                implementation("org.junit.jupiter:junit-jupiter-api:5.10.1")
                implementation("org.junit.jupiter:junit-jupiter-params:5.10.1")
                implementation("io.ktor:ktor-client-mock:3.1.0")
                runtimeOnly("org.junit.jupiter:junit-jupiter-engine:5.10.1")
            }
        }

        val androidUnitTest by getting {
            dependencies {
                implementation("junit:junit:4.13.2")
                // Provide real org.json implementation to replace Android stubs in unit tests.
                // Android SDK's org.json.JSONObject throws RuntimeException when not mocked.
                implementation("org.json:json:20240303")
            }
        }
    }
}

android {
    namespace = "dev.edgebase.sdk.core"
    compileSdk = 34
    defaultConfig {
        minSdk = 26
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    testOptions {
        unitTests.all {
            it.jvmArgs("-Djava.io.tmpdir=/tmp")
        }
        unitTests.isReturnDefaultValues = true
    }
}

// 테스트 결과를 콘솔에 출력 (run-all-sdk-tests.sh 파서용)
tasks.withType<Test> {
    useJUnitPlatform()
    testLogging {
        events("passed", "failed", "skipped")
    }
}
