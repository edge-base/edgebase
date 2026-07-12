val edgebaseReleaseVersion = "0.4.3"
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
        "implementation"("org.scala-lang:scala-library:3.8.4")
        "implementation"("com.squareup.okhttp3:okhttp:5.4.0")
        "implementation"("com.google.code.gson:gson:2.14.0")
        "implementation"("org.json:json:20260522")
        "testImplementation"("org.scalatest:scalatest_2.13:3.2.20")
        "testImplementation"("org.junit.jupiter:junit-jupiter:6.1.2")
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
