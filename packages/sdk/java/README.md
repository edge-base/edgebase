# EdgeBase Java SDK

The **official Java SDK** for [EdgeBase](https://github.com/edge-base/edgebase) — Open source backend in one command.

## Installation

### Gradle
```groovy
implementation 'dev.edgebase:edgebase-sdk-java:0.1.0'
```

### Maven
```xml
<dependency>
    <groupId>dev.edgebase</groupId>
    <artifactId>edgebase-sdk-java</artifactId>
    <version>0.1.0</version>
</dependency>
```

## Quick Start

### Client SDK (Android / Desktop)

```java
import dev.edgebase.sdk.client.ClientEdgeBase;
import dev.edgebase.sdk.client.EdgeBase;
import dev.edgebase.sdk.core.EdgeBaseFieldOps;
import dev.edgebase.sdk.core.ListResult;
import java.util.Map;

// Initialize
ClientEdgeBase client = EdgeBase.client("https://my-app.edgebase.fun");

// Auth
client.auth().signUp("user@example.com", "password123!");
client.auth().signIn("user@example.com", "password123!");

// CRUD
Map<String, Object> post = client.db("shared").table("posts").insert(Map.of(
    "title", "Hello World",
    "content", "First post from Java SDK"
));

// Query
ListResult results = client.db("shared").table("posts")
    .where("status", "==", "published")
    .orderBy("createdAt", "desc")
    .limit(20)
    .getList();

// Functions + Analytics
client.functions().post("welcome-email", Map.of("to", "user@example.com"));
client.analytics().track("java_example_opened");

// Storage
client.storage().bucket("avatars").upload("profile.png", imageBytes, "image/png");
String url = client.storage().bucket("avatars").getUrl("profile.png");

// Cleanup
client.destroy();
```

### Server SDK (Spring / Ktor / Backend)

```java
import dev.edgebase.sdk.*;

AdminEdgeBase admin = EdgeBase.admin(
    "https://my-app.edgebase.fun",
    System.getenv("EDGEBASE_SERVICE_KEY")
);

// Admin Auth
admin.adminAuth().createUser(Map.of("email", "admin@example.com", "password", "pass123!"));
Map<String, Object> user = admin.adminAuth().getUser("user-id");

// Raw SQL
List<Object> rows = admin.sql("posts", "SELECT id, title FROM posts WHERE published = 1");

// Server-side Broadcast
admin.broadcast("game:room1", "player_joined", Map.of("name", "Alice"));
```

## API Reference

### Auth (`client.auth()`)
| Method | Description |
|--------|-------------|
| `signUp(email, password)` | Create account |
| `signUp(email, password, data)` | Create account with extra data |
| `signIn(email, password)` | Sign in with email |
| `signInAnonymously()` | Anonymous sign in |
| `signOut()` | Sign out (clears tokens) |
| `currentUser()` | Get current user from JWT |
| `changePassword(current, new)` | Change password |
| `linkWithEmail(email, password)` | Link anonymous → email |
| `updateProfile(data)` | Update user profile |
| `listSessions()` | List active sessions |
| `revokeSession(sessionId)` | Revoke a session |
| `onAuthStateChange(listener)` | Auth state change callback |

### Database (`client.db("shared").table("name")`)
| Method | Description |
|--------|-------------|
| `.where(field, op, value)` | Filter (returns new ref) |
| `.orderBy(field, direction)` | Sort |
| `.limit(n)` | Limit results |
| `.offset(n)` | Offset pagination |
| `.search(query)` | Full-text search |
| `.getList()` | Execute query → `ListResult` |
| `.count()` | Count matching records |
| `.insert(record)` | Insert record |
| `.upsert(record)` | Upsert record |
| `.insertMany(records)` | Batch insert |
| `.updateMany(update)` | Batch update by filter |
| `.deleteMany()` | Batch delete by filter |

### Storage (`client.storage().bucket("name")`)
| Method | Description |
|--------|-------------|
| `.upload(key, data, contentType)` | Upload binary |
| `.uploadString(key, content, encoding)` | Upload string |
| `.download(key)` | Download as byte[] |
| `.delete(key)` | Delete file |
| `.list(prefix)` | List files |
| `.getUrl(key)` | Get public URL |
| `.getMetadata(key)` | Get file metadata |
| `.createSignedUrl(key, expiresIn)` | Create signed URL |

### Field Operations
```java
// Atomic increment
client.db("shared").table("posts").update("id", Map.of(
    "views", EdgeBaseFieldOps.increment(1)
));

// Delete field (set to NULL)
client.db("shared").table("posts").update("id", Map.of(
    "content", EdgeBaseFieldOps.deleteField()
));
```

## Requirements

- Java 17+
- Dependencies: OkHttp 4.x, Gson 2.x

## Testing

```bash
# Start local server
cd packages/server
TMPDIR=/tmp XDG_CONFIG_HOME=/tmp npx wrangler dev --config wrangler.test.toml --port 8688

# Run tests
cd packages/sdk/java
export EDGEBASE_SERVICE_KEY=test-service-key-for-admin
gradle test --no-daemon
```

## License

Apache-2.0
