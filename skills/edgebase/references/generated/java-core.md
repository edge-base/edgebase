<!-- Generated from packages/sdk/java/packages/core/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase Core Java SDK

Use this file as a quick-reference contract for AI coding assistants working with the
Java core runtime package.

## Package Boundary

Use `edgebase-core-java` only in trusted JVM-side code that needs the shared runtime.

This package does not provide the app-facing client or server-facing admin factory.
It supplies the shared primitives used by both higher-level Java SDKs.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/java/packages/core/README.md
- Root README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/java/README.md
- SDK Overview: https://edgebase.fun/docs/sdks

## Public Artifact

- `com.github.edge-base.edgebase:edgebase-core-java:v0.2.6`

## Canonical Examples

### Field operations

```java
import java.util.Map;

Map<String, Object> op = EdgeBaseFieldOps.increment(1);
Map<String, Object> delete = EdgeBaseFieldOps.deleteField();
```

### Error handling

```java
try {
    // core call
} catch (EdgeBaseError error) {
    System.out.println(error.getStatusCode());
}
```

## Hard Rules

- do not use this package as the top-level app entrypoint
- keep client and admin factory methods in the higher-level packages
- use `EdgeBaseFieldOps` for atomic field updates instead of hand-rolling `$op` maps

## Quick Reference

```text
EdgeBaseFieldOps.increment(value)  -> Map<String, Object>
EdgeBaseFieldOps.deleteField()     -> Map<String, Object>
EdgeBaseError                      -> RuntimeException
```
