plugins {
    scala
    `maven-publish`
}

fun dependencyJars(relativeDir: String, vararg includes: String) = fileTree(rootProject.file(relativeDir)) {
    includes.forEach { include(it) }
}

dependencies {
    add(
        "implementation",
        dependencyJars(
            "../java/packages/core/build/libs",
            "edgebase-core-java-*.jar",
            "core-*.jar",
        ),
    )
}

publishing {
    publications {
        create<MavenPublication>("maven") {
            from(components["java"])
            groupId = "dev.edgebase"
            artifactId = "edgebase-core-scala"
        }
    }
}
