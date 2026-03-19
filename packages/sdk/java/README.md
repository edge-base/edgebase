# EdgeBase Java SDK

Official Java SDK for EdgeBase, published for Gradle and Maven consumers through
JitPack as three installable artifacts:

- `com.github.edge-base.edgebase:edgebase-core-java:v0.1.4`
- `com.github.edge-base.edgebase:edgebase-android-java:v0.1.4`
- `com.github.edge-base.edgebase:edgebase-admin-java:v0.1.4`

The monorepo root `edgebase-sdk-java` artifact is intentionally not part of the
public JitPack install path. Depend on the split artifacts below.

## Installation

### Gradle

```groovy
repositories {
    maven { url 'https://jitpack.io' }
}

dependencies {
    implementation 'com.github.edge-base.edgebase:edgebase-core-java:v0.1.4'
    implementation 'com.github.edge-base.edgebase:edgebase-android-java:v0.1.4'
    implementation 'com.github.edge-base.edgebase:edgebase-admin-java:v0.1.4'
}
```

### Maven

```xml
<repositories>
    <repository>
        <id>jitpack.io</id>
        <url>https://jitpack.io</url>
    </repository>
</repositories>

<dependency>
    <groupId>com.github.edge-base.edgebase</groupId>
    <artifactId>edgebase-core-java</artifactId>
    <version>v0.1.4</version>
</dependency>
<dependency>
    <groupId>com.github.edge-base.edgebase</groupId>
    <artifactId>edgebase-android-java</artifactId>
    <version>v0.1.4</version>
</dependency>
<dependency>
    <groupId>com.github.edge-base.edgebase</groupId>
    <artifactId>edgebase-admin-java</artifactId>
    <version>v0.1.4</version>
</dependency>
```

## Package Map

| Artifact | Use it for | Main entry points |
| --- | --- | --- |
| `edgebase-core-java` | shared primitives | `EdgeBaseFieldOps`, `EdgeBaseError`, `DbRef` |
| `edgebase-android-java` | client SDK | `dev.edgebase.sdk.client.EdgeBase`, `ClientEdgeBase` |
| `edgebase-admin-java` | server/admin SDK | `dev.edgebase.sdk.admin.AdminEdgeBase`, `EdgeBase.admin(...)` |

## Quick Start

### Client SDK (Android / Desktop)

```java
import dev.edgebase.sdk.client.ClientEdgeBase;
import dev.edgebase.sdk.client.EdgeBase;
import dev.edgebase.sdk.core.EdgeBaseFieldOps;
import dev.edgebase.sdk.core.ListResult;
import java.util.Map;

ClientEdgeBase client = EdgeBase.client("https://my-app.edgebase.fun");

client.auth().signUp("user@example.com", "password123!");
client.auth().signIn("user@example.com", "password123!");

Map<String, Object> post = client.db("shared").table("posts").insert(Map.of(
    "title", "Hello World",
    "content", "First post from Java SDK"
));

ListResult results = client.db("shared").table("posts")
    .where("status", "==", "published")
    .orderBy("createdAt", "desc")
    .limit(20)
    .getList();

client.functions().post("welcome-email", Map.of("to", "user@example.com"));
client.analytics().track("java_example_opened");

client.storage().bucket("avatars").upload("profile.png", imageBytes, "image/png");
String url = client.storage().bucket("avatars").getUrl("profile.png");

client.destroy();
```

### Server SDK (Spring / Ktor / Backend)

```java
import dev.edgebase.sdk.admin.AdminEdgeBase;
import dev.edgebase.sdk.client.EdgeBase;
import java.util.List;
import java.util.Map;

AdminEdgeBase admin = EdgeBase.admin(
    "https://my-app.edgebase.fun",
    System.getenv("EDGEBASE_SERVICE_KEY")
);

admin.adminAuth().createUser(Map.of("email", "admin@example.com", "password", "pass123!"));
Map<String, Object> user = admin.adminAuth().getUser("user-id");

List<Object> rows = admin.sql("posts", "SELECT id, title FROM posts WHERE published = 1");

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
