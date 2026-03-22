// EdgeBase Kotlin SDK — Client KMP module.
//
// Client-side SDK with auth, database-live (WebSocket), push notifications.
// Targets: Android, iOS, macOS, JS (Browser IR), JVM (Desktop).
//: KMP 전환.

import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.plugin.mpp.apple.XCFramework
import org.jetbrains.kotlin.konan.target.Family
import org.gradle.api.publish.maven.MavenPublication
import java.io.File
import java.net.URL
import java.security.MessageDigest

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

val kotlinIosFrameworksRoot = layout.buildDirectory.dir("realtimekit-ios-frameworks")

data class KotlinIosBinaryArtifact(
    val name: String,
    val url: String,
    val checksum: String,
)

val kotlinIosBinaryArtifacts = listOf(
    KotlinIosBinaryArtifact(
        name = "RTKWebRTC-v125.6422.07.zip",
        url = "https://sdk-assets.realtime.cloudflare.com/RTKWebRTC-v125.6422.07.zip",
        checksum = "114cb3ea15c5709f2c35d2b1c7a64e742a6902d375d54895984263bb79d75ce3",
    ),
    KotlinIosBinaryArtifact(
        name = "RealtimeKit-1.5.0.zip",
        url = "https://sdk-assets.realtime.cloudflare.com/RealtimeKit-1.5.0-4a3c5a2a-d75a-4973-816e-be10c81494d6.xcframework.zip",
        checksum = "f609f6365e70325da04dd59ba9f6b49d5593c030eb51022d2bcfb9e32d4b85d3",
    ),
)

fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            digest.update(buffer, 0, read)
        }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
}

val prepareKotlinIosBinaryFrameworks = tasks.register("prepareKotlinIosBinaryFrameworks") {
    outputs.dir(kotlinIosFrameworksRoot)
    doLast {
        val root = kotlinIosFrameworksRoot.get().asFile
        root.mkdirs()

        kotlinIosBinaryArtifacts.forEach { artifact ->
            val zipFile = root.resolve(artifact.name)
            if (!zipFile.exists() || sha256(zipFile) != artifact.checksum) {
                zipFile.outputStream().use { output ->
                    URL(artifact.url).openStream().use { input -> input.copyTo(output) }
                }
                val actualChecksum = sha256(zipFile)
                check(actualChecksum == artifact.checksum) {
                    "Checksum mismatch for ${artifact.name}: expected ${artifact.checksum}, got $actualChecksum"
                }
            }

            copy {
                from(zipTree(zipFile))
                into(root)
            }
        }
    }
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

    targets.configureEach {
        if (this is org.jetbrains.kotlin.gradle.plugin.mpp.KotlinNativeTarget && konanTarget.family == Family.IOS) {
            val isSimulator = name.contains("Simulator", ignoreCase = true) || name.endsWith("X64")
            val frameworksRoot = kotlinIosFrameworksRoot.get().asFile
            val webrtcFrameworkDir = frameworksRoot.resolve(
                "RTKWebRTC.xcframework/${if (isSimulator) "ios-arm64_x86_64-simulator" else "ios-arm64"}",
            )
            val realtimeKitFrameworkDir = frameworksRoot.resolve(
                "RealtimeKit.xcframework/${if (isSimulator) "ios-arm64_x86_64-simulator" else "ios-arm64"}",
            )
            val swiftLibDir = File(
                if (isSimulator) {
                    "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/iphonesimulator"
                } else {
                    "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/iphoneos"
                },
            )

            binaries.configureEach {
                linkTaskProvider.configure {
                    dependsOn(prepareKotlinIosBinaryFrameworks)
                }
                linkerOpts(
                    "-F${webrtcFrameworkDir.absolutePath}",
                    "-F${realtimeKitFrameworkDir.absolutePath}",
                    "-L${swiftLibDir.absolutePath}",
                    "-rpath",
                    webrtcFrameworkDir.absolutePath,
                    "-rpath",
                    realtimeKitFrameworkDir.absolutePath,
                )
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
                implementation("com.cloudflare.realtimekit:webrtc-kmp-android:0.125.13")
            }
        }

        val appleMain by getting {
            dependencies {
                implementation("io.ktor:ktor-client-darwin:3.1.0")
            }
        }

        val iosMain by getting {
            dependencies {
                implementation("com.cloudflare.realtimekit:core:1.5.0")
                implementation("com.cloudflare.realtimekit:webrtc-kmp:0.125.8")
            }
        }

        val jsMain by getting {
            dependencies {
                implementation("io.ktor:ktor-client-js:3.1.0")
                implementation(npm("@cloudflare/realtimekit", "1.2.5"))
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
