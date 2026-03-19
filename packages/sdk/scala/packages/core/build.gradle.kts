plugins {
    scala
    `maven-publish`
}

version = rootProject.version

fun dependencyJars(relativeDir: String, vararg includes: String) = fileTree(rootProject.file(relativeDir)) {
    includes.forEach { include(it) }
}

val isJitPackBuild = !System.getenv("JITPACK").isNullOrBlank()

dependencies {
    if (isJitPackBuild) {
        add("implementation", "com.github.edge-base.edgebase:edgebase-core-java:${rootProject.version}")
    } else {
        add(
            "implementation",
            dependencyJars(
                "../java/packages/core/build/libs",
                "edgebase-core-java-*.jar",
                "core-*.jar",
            ),
        )
    }
}

publishing {
    publications {
        create<MavenPublication>("maven") {
            from(components["java"])
            groupId = project.group.toString()
            artifactId = "edgebase-core-scala"
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
