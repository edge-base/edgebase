pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "edgebase-kotlin-sdk"

//: KMP 전환 — core(KMP) + client(KMP) + admin(JVM)
include(":core")
include(":client")
include(":admin")
