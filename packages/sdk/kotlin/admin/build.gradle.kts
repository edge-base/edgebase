// EdgeBase Kotlin SDK — Admin module (JVM only).
//
// Server-side SDK with Service Key auth, user management, D1, KV, Vectorize.
// Depends on :core (Gradle auto-selects JVM artifact).
//: admin은 코드 변경 0줄, JVM 전용 유지.

plugins {
    kotlin("jvm")
    kotlin("plugin.serialization")
    `java-library`
    `maven-publish`
}

group = rootProject.group
version = rootProject.version

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

dependencies {
    api(project(":core"))
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")

    testImplementation(kotlin("test"))
    testImplementation(kotlin("reflect"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.2")
}

tasks.test {
    useJUnitPlatform()
    testLogging { events("passed", "skipped", "failed") }
}

publishing {
    publications {
        create<MavenPublication>("maven") {
            from(components["java"])
            groupId = project.group.toString()
            artifactId = "edgebase-admin-kotlin"
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
}
