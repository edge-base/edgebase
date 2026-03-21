// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "EdgeBase",
    platforms: [.iOS(.v15), .macOS(.v12), .tvOS(.v15), .watchOS(.v8)],
    products: [
        .library(name: "EdgeBase", targets: ["EdgeBase"]),
    ],
    dependencies: [
        .package(path: "../core"),
        .package(url: "https://github.com/dyte-in/RealtimeKitCoreiOS.git", from: "1.6.1"),
    ],
    targets: [
        .target(name: "EdgeBase", dependencies: [
            .product(name: "EdgeBaseCore", package: "core"),
            .product(name: "RealtimeKit", package: "RealtimeKitCoreiOS", condition: .when(platforms: [.iOS])),
        ], path: "Sources", resources: [
            .process("Resources"),
        ]),
        .testTarget(name: "EdgeBaseTests", dependencies: ["EdgeBase"], path: "Tests"),
    ]
)
