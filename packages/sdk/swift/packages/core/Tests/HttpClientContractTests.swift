import Foundation
import XCTest
@testable import EdgeBaseCore

final class HttpClientContractTests: XCTestCase {
    override func tearDown() {
        MockURLProtocol.handler = nil
        super.tearDown()
    }

    func testNoContentSuccessReturnsNullSentinel() async throws {
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 204,
                httpVersion: nil,
                headerFields: [:]
            )!
            return (response, Data())
        }

        let client = HttpClient(
            baseUrl: "https://example.edgebase.fun",
            tokenManager: StubTokenManager(),
            session: makeSession()
        )

        let result = try await client.delete("/functions/no-content")
        XCTAssertTrue(result is NSNull)
    }

    func testPlainTextSuccessRaisesJsonContractError() async {
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "text/plain"]
            )!
            return (response, Data("ok".utf8))
        }

        let client = HttpClient(
            baseUrl: "https://example.edgebase.fun",
            tokenManager: StubTokenManager(),
            session: makeSession()
        )

        do {
            _ = try await client.get("/functions/plain-text")
            XCTFail("Expected invalid JSON response body error")
        } catch let error as EdgeBaseError {
            XCTAssertEqual(error.statusCode, 200)
            XCTAssertEqual(error.message, "Invalid JSON response body")
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testMalformedJsonSuccessRaisesJsonContractError() async {
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data("{\"broken\":[]".utf8))
        }

        let client = HttpClient(
            baseUrl: "https://example.edgebase.fun",
            tokenManager: StubTokenManager(),
            session: makeSession()
        )

        do {
            _ = try await client.get("/functions/malformed")
            XCTFail("Expected invalid JSON response body error")
        } catch let error as EdgeBaseError {
            XCTAssertEqual(error.statusCode, 200)
            XCTAssertEqual(error.message, "Invalid JSON response body")
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    private func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        return URLSession(configuration: configuration)
    }
}

private actor StubTokenManager: TokenManageable {
    func getAccessToken() async throws -> String? { nil }
    func getRefreshToken() async -> String? { nil }
    func clearTokens() async {}
}

private final class MockURLProtocol: URLProtocol, @unchecked Sendable {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = MockURLProtocol.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }

        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
