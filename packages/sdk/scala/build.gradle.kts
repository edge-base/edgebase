val edgebaseReleaseVersion = "0.1.5"
val edgebaseGroup = if (System.getenv("JITPACK").isNullOrBlank()) {
    "dev.edgebase"
} else {
    "com.github.edge-base.edgebase"
}
val edgebaseVersion = if (System.getenv("JITPACK").isNullOrBlank()) {
    edgebaseReleaseVersion
} else {
    System.getenv("VERSION") ?: "v$edgebaseReleaseVersion"
}

allprojects {
    group = edgebaseGroup
    version = edgebaseVersion
}

subprojects {
    apply(plugin = "scala")
    apply(plugin = "maven-publish")

    repositories {
        mavenLocal()
        mavenCentral()
    }

    extensions.configure<JavaPluginExtension> {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    dependencies {
        "implementation"("org.scala-lang:scala-library:2.13.16")
        "implementation"("com.squareup.okhttp3:okhttp:4.12.0")
        "implementation"("com.google.code.gson:gson:2.11.0")
        "implementation"("org.json:json:20231013")
        "testImplementation"("org.scalatest:scalatest_2.13:3.2.19")
        "testImplementation"("org.junit.jupiter:junit-jupiter:5.11.0")
        "testRuntimeOnly"("org.junit.platform:junit-platform-launcher")
    }

    tasks.withType<ScalaCompile>().configureEach {
        scalaCompileOptions.additionalParameters = listOf("-deprecation", "-feature")
    }

    tasks.withType<Test>().configureEach {
        useJUnitPlatform()
        testLogging {
            events("passed", "skipped", "failed")
        }
    }
}
