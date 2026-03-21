// EdgeBase Kotlin SDK — Client KMP module.
//
// Client-side SDK with auth, database-live (WebSocket), push notifications.
// Targets: Android, iOS, macOS, JS (Browser IR), JVM (Desktop).
//: KMP 전환.

import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.plugin.mpp.apple.XCFramework
import org.gradle.api.publish.maven.MavenPublication

plugins {
    kotlin("multiplatform")
    kotlin("plugin.serialization")
    id("com.android.library")
    `maven-publish`
}

group = rootProject.group
version = rootProject.version

// Allow overriding build output directory via system property (for sandbox environments).
// Module-specific property name avoids cross-module collisions in multi-project builds.
// Usage: ./gradlew ... -Pkotlin.client.buildDir=/tmp/kotlin-client-build
val customBuildDir = findProperty("kotlin.client.buildDir") as String?
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
        val xcfClient = XCFramework("EdgeBaseClient")
        appleTargets.forEach {
            it.binaries.framework {
                baseName = "EdgeBaseClient"
                export(project(":core"))
                xcfClient.add(this)
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
        testRuns.named("test") {
            executionTask.configure {
                useJUnitPlatform()
            }
        }
    }

    // Suppress expect/actual Beta warning
    targets.configureEach {
        compilations.configureEach {
            compileTaskProvider.get().compilerOptions {
                freeCompilerArgs.add("-Xexpect-actual-classes")
            }
        }
    }

    // Common source set hierarchy
    applyDefaultHierarchyTemplate()

    sourceSets {
        val commonMain by getting {
            dependencies {
                api(project(":core"))
                implementation("io.ktor:ktor-client-core:3.1.0")
                implementation("io.ktor:ktor-client-websockets:3.1.0")
                implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
            }
        }

        val androidMain by getting {
            dependencies {
                implementation("io.ktor:ktor-client-okhttp:3.1.0")
                implementation("com.google.firebase:firebase-messaging:24.1.0")
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")
                implementation("androidx.fragment:fragment:1.6.2")
                implementation("androidx.core:core:1.12.0")
                implementation("com.cloudflare.realtimekit:core:1.5.5")
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
                implementation("org.junit.jupiter:junit-jupiter-api:5.10.2")
                implementation("org.junit.jupiter:junit-jupiter:5.10.2")
                runtimeOnly("org.junit.jupiter:junit-jupiter-engine:5.10.2")
            }
        }

        val androidUnitTest by getting {
            dependencies {
                implementation("junit:junit:4.13.2")
            }
        }
    }
}

android {
    namespace = "dev.edgebase.sdk.client"
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
    testLogging {
        events("passed", "failed", "skipped")
    }
}

publishing {
    val isJitPackBuild = !System.getenv("JITPACK").isNullOrBlank()
    publications.withType<MavenPublication>().configureEach {
        if (name == "kotlinMultiplatform") {
            artifactId = "edgebase-client"
        } else if (name == "jvm") {
            artifactId = if (isJitPackBuild) "edgebase-client" else "edgebase-client-jvm"
        }
        pom {
            licenses {
                license {
                    name.set("MIT License")
                    url.set("https://opensource.org/license/mit")
                    distribution.set("repo")
                }
            }
        }
    }
}
