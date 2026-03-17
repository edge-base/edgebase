# EdgeBase Scala SDK

Scala-facing SDK modules that wrap the Java core/admin runtime with Scala-native
collections and result models.

Modules:

- `:packages:core` - Scala wrappers for DB, storage, and shared result types
- `:packages:admin` - Server-side admin SDK built on top of the Java admin SDK

The public API favors Scala collections and `Option` while delegating protocol
behavior to the existing Java SDK so the admin feature surface stays aligned.
