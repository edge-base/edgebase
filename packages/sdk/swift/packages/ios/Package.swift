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
    ],
    targets: [
        .target(name: "EdgeBase", dependencies: [
            .product(name: "EdgeBaseCore", package: "core"),
        ], path: "Sources", resources: [
            .process("Resources"),
        ]),
        .testTarget(name: "EdgeBaseTests", dependencies: ["EdgeBase"], path: "Tests"),
    ]
)
