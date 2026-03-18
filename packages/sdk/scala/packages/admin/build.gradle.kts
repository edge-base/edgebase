plugins {
    scala
    `maven-publish`
}

fun dependencyJars(relativeDir: String, vararg includes: String) = fileTree(rootProject.file(relativeDir)) {
    includes.forEach { include(it) }
}

dependencies {
    add("implementation", project(":packages:core"))
    add(
        "implementation",
        dependencyJars(
            "../java/packages/core/build/libs",
            "edgebase-core-java-*.jar",
            "core-*.jar",
        ),
    )
    add(
        "implementation",
        dependencyJars(
            "../java/packages/admin/build/libs",
            "edgebase-admin-java-*.jar",
            "admin-*.jar",
        ),
    )
}

publishing {
    publications {
        create<MavenPublication>("maven") {
            from(components["java"])
            groupId = "dev.edgebase"
            artifactId = "edgebase-admin-scala"
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
