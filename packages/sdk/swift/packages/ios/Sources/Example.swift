import EdgeBaseCore
import Foundation

// Example usage — not compiled as-is; see documentation.
#if false

// MARK: - Initialization

let client = EdgeBaseClient("https://your-project.edgebase.fun")

// MARK: - Database CRUD

func collectionExample() async throws {
    let table = client.db("shared").table("posts")
    let _ = try await table.getList()
}

#endif
