// swift-tools-version:5.9
// EdgeBase Kotlin SDK — Swift Package Manager distribution.
//
// Provides KMP-compiled XCFrameworks for iOS and macOS.
// Build with: JAVA_HOME=<JDK 17 home> ./gradlew :client:assembleEdgeBaseClientXCFramework
//: KMP 전환.

import PackageDescription

let package = Package(
    name: "EdgeBaseKotlinSDK",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [
        .library(name: "EdgeBaseClient", targets: ["EdgeBaseClient"]),
    ],
    targets: [
        .binaryTarget(
            name: "EdgeBaseClient",
            path: "client/build/XCFrameworks/release/EdgeBaseClient.xcframework"
        ),
    ]
)
