// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "EdgeBaseCore",
    platforms: [.iOS(.v15), .macOS(.v12), .tvOS(.v15), .watchOS(.v8)],
    products: [
        .library(name: "EdgeBaseCore", targets: ["EdgeBaseCore"]),
    ],
    targets: [
        .target(name: "EdgeBaseCore", path: "Sources"),
        .testTarget(name: "EdgeBaseCoreTests", dependencies: ["EdgeBaseCore"], path: "Tests"),
    ]
)
